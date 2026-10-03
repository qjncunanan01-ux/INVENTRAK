// Bulk cost-of-goods entry (POST /api/products/bulk-costs).
//
// Why this needs its own suite: `cost` is the only field in the catalog that
// decides whether the business is profitable, and it is stripped from every
// public read (product-visibility.js). So the admin console has to be able to
// SET it — and at 205 products, one product at a time is not a feature, it is a
// chore nobody completes. The bulk sheet is the only realistic path to a
// costed catalog, which makes its edge cases load-bearing rather than cosmetic.
//
// The subtlety locked down here is the three-state cost. A bulk sheet needs
// "set this", "clear this back to not-costed" and "ignore this row", and they
// must not collapse into each other — most dangerously, a blank cell silently
// becoming a no-op that still reports success, which would leave the catalog
// quietly uncosted while the admin believes it is done.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { parseCostEntry } = require('../costing');
const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

const FIXTURES = [
  'bulk-cost-alpha',
  'bulk-cost-clear',
  'bulk-cost-untouched',
  'bulk-cost-blank',
  'bulk-cost-case',
  'bulk-cost-mix-set',
  'bulk-cost-mix-clear',
];

before(async () => {
  await bootBoth();
  // Dedicated fixture products rather than seeded catalog rows: each test needs
  // a name it can cost freely without disturbing the shared 205-row catalog the
  // other suites assert against, and a name that no other test writes to.
  for (const side of [sqlite, npmfree]) {
    for (const name of FIXTURES) {
      const res = await call(side.url, '/api/products', {
        method: 'POST',
        token: side.token.admin,
        body: { name, category: 'Test Fixture', price: 500, cost: null },
      });
      assert.strictEqual(res.status, 201, `fixture ${name} should be creatable on ${side.url}`);
    }
  }
});

after(() => {
  teardown();
});

// A row each side can cost independently, so a test that writes cannot leak
// into the next. Names are chosen to be unique across the whole suite.
const costOne = async (side, name, cost) =>
  call(side.url, '/api/products/bulk-costs', {
    method: 'POST',
    token: side.token.admin,
    body: { costs: [{ name, cost }] },
  });

describe('parseCostEntry — the three states of a cost cell', () => {
  test('a number sets the cost', () => {
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: 12.5 }), { value: 12.5 });
    // A numeric string is what a CSV actually produces, so it must work.
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: '12.50' }), { value: 12.5 });
  });

  test('null and the empty string CLEAR the cost, they are not zero', () => {
    // The trap: Number('') is 0 and Number(null) is 0, so a naive parser
    // writes a genuine zero cost — which reads as a 100% margin product, not
    // as "unknown". Clearing must stay distinguishable from costing at zero.
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: null }), { clear: true });
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: '' }), { clear: true });
    // A real zero is a real value and is preserved.
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: 0 }), { value: 0 });
  });

  test('an absent cost key skips rather than clears', () => {
    assert.deepStrictEqual(parseCostEntry({ name: 'X' }), { skip: true });
  });

  test('a genuine zero is kept, and negative / unparseable values are rejected', () => {
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: 0 }), { value: 0 });
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: -1 }).error, 'invalid cost');
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: 'abc' }).error, 'invalid cost');
    assert.deepStrictEqual(parseCostEntry({ name: 'X', cost: {} }).error, 'invalid cost');
    assert.deepStrictEqual(parseCostEntry(null).error, 'invalid entry');
  });
});

describe('POST /api/products/bulk-costs — both backends', () => {
  test('admin sets a cost and it is readable on the admin cost sheet', async () => {
    for (const side of [sqlite, npmfree]) {
      await costOne(side, 'bulk-cost-alpha', 300);
      const res = await call(side.url, '/api/products/costs', { token: side.token.admin });
      const row = res.json.find(r => r.name === 'bulk-cost-alpha');
      assert.ok(row, 'costed product should appear on the admin cost sheet');
      assert.strictEqual(row.cost, 300);
    }
  });

  test('a null cost clears the product back to "not costed"', async () => {
    for (const side of [sqlite, npmfree]) {
      await costOne(side, 'bulk-cost-clear', 250);
      const cleared = await costOne(side, 'bulk-cost-clear', null);
      assert.strictEqual(cleared.status, 200);
      assert.strictEqual(cleared.json.cleared, 1);
      assert.strictEqual(cleared.json.updated, 0);

      const res = await call(side.url, '/api/products/costs', { token: side.token.admin });
      const row = res.json.find(r => r.name === 'bulk-cost-clear');
      assert.strictEqual(row.cost, null, 'cleared cost must be null, never 0');
    }
  });

  test('an entry with no cost key is skipped and leaves the product untouched', async () => {
    for (const side of [sqlite, npmfree]) {
      await costOne(side, 'bulk-cost-untouched', 175);
      const res = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: { costs: [{ name: 'bulk-cost-untouched' }] },
      });
      assert.strictEqual(res.json.updated, 0);
      assert.strictEqual(res.json.cleared, 0);
      assert.strictEqual(res.json.skipped[0].reason, 'no cost given');

      const sheet = await call(side.url, '/api/products/costs', { token: side.token.admin });
      assert.strictEqual(sheet.json.find(r => r.name === 'bulk-cost-untouched').cost, 175);
    }
  });

  test('a blank cost cell CLEARS, unlike a blank price cell which is rejected', async () => {
    // The deliberate asymmetry: for prices a blank is a parsing accident, for
    // costs it is an instruction. Assert both so the difference cannot drift.
    for (const side of [sqlite, npmfree]) {
      await costOne(side, 'bulk-cost-blank', 99);
      const res = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: { costs: [{ name: 'bulk-cost-blank', cost: '' }] },
      });
      assert.strictEqual(res.json.cleared, 1);

      const priceRes = await call(side.url, '/api/products/bulk-prices', {
        method: 'POST',
        token: side.token.admin,
        body: { prices: [{ name: 'bulk-cost-blank', price: '' }] },
      });
      assert.strictEqual(priceRes.json.skipped[0].reason, 'invalid price');
    }
  });

  test('matches by id first, then by case-insensitive name', async () => {
    for (const side of [sqlite, npmfree]) {
      const sheet = await call(side.url, '/api/products/costs', { token: side.token.admin });
      const target = sheet.json[0];
      const byId = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: { costs: [{ id: target.id, name: 'a name that does not exist', cost: 7 }] },
      });
      assert.strictEqual(byId.json.updated, 1, 'a valid id should win over a bad name');

      await costOne(side, 'bulk-cost-case', 10);
      const byName = await costOne(side, 'BULK-COST-CASE', 20);
      assert.strictEqual(byName.json.updated, 1, 'name matching should ignore case');
    }
  });

  test('reports unknown products and bad values as skipped, never silently', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: {
          costs: [
            { name: 'no such product anywhere', cost: 50 },
            { name: 'bulk-cost-untouched', cost: 'not a number' },
            { name: 'bulk-cost-untouched', cost: -5 },
          ],
        },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.json.updated, 0);
      assert.strictEqual(res.json.cleared, 0);
      assert.strictEqual(res.json.total, 3);
      assert.deepStrictEqual(
        res.json.skipped.map(s => s.reason).sort(),
        ['invalid cost', 'invalid cost', 'not found'],
      );
    }
  });

  test('a mixed sheet sets and clears in one call and reports both counts', async () => {
    for (const side of [sqlite, npmfree]) {
      await costOne(side, 'bulk-cost-mix-set', 400);
      await costOne(side, 'bulk-cost-mix-clear', 400);
      const res = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: {
          costs: [
            { name: 'bulk-cost-mix-set', cost: 425 },
            { name: 'bulk-cost-mix-clear', cost: null },
          ],
        },
      });
      assert.strictEqual(res.json.updated, 1);
      assert.strictEqual(res.json.cleared, 1);
      assert.strictEqual(res.json.total, 2);
    }
  });

  test('rejects an empty or oversized sheet', async () => {
    for (const side of [sqlite, npmfree]) {
      const empty = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: { costs: [] },
      });
      assert.strictEqual(empty.status, 400);

      const notArray = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: { costs: 'nope' },
      });
      assert.strictEqual(notArray.status, 400);

      const huge = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: side.token.admin,
        body: { costs: new Array(2001).fill({ name: 'x', cost: 1 }) },
      });
      assert.strictEqual(huge.status, 400);
    }
  });

  test('is admin-only — staff and customers are refused, the admin tier is not', async () => {
    // Cost is business-confidential, so the bulk sheet must be exactly as
    // locked down as the read endpoint. `adminOnly` is the ADMIN_TIER gate
    // (admin, super_admin, owner), so the Business Owner and Super Admin are
    // ALLOWED here by design — asserting they are refused would be asserting
    // the wrong policy. What matters is that the two operational roles cannot.
    for (const auth of ['staff', 'customer']) {
      for (const side of [sqlite, npmfree]) {
        const res = await call(side.url, '/api/products/bulk-costs', {
          method: 'POST',
          token: side.token[auth],
          body: { costs: [{ name: 'bulk-cost-alpha', cost: 1 }] },
        });
        assert.strictEqual(res.status, 403, `${auth} must not be able to set costs`);
      }
    }
    for (const auth of ['owner', 'superadmin']) {
      const res = await call(sqlite.url, '/api/products/bulk-costs', {
        method: 'POST',
        token: sqlite.token[auth],
        body: { costs: [{ name: 'bulk-cost-alpha', cost: 1 }] },
      });
      assert.strictEqual(res.status, 200, `${auth} is in ADMIN_TIER and should be allowed`);
    }
    for (const side of [sqlite, npmfree]) {
      const guest = await call(side.url, '/api/products/bulk-costs', {
        method: 'POST',
        body: { costs: [{ name: 'bulk-cost-alpha', cost: 1 }] },
      });
      assert.strictEqual(guest.status, 401);
    }
  });

  test('setting a cost does not leak it onto the public catalog', async () => {
    // The point of pairing costing with product-visibility.js: making cost
    // writable must not make it readable. The public catalog is unauthenticated
    // and cacheable, so this is checked as an anonymous caller.
    await costOne(sqlite, 'bulk-cost-alpha', 12345);
    await costOne(npmfree, 'bulk-cost-alpha', 12345);
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/products');
      const row = JSON.parse(res.text).find(p => p.name === 'bulk-cost-alpha');
      assert.ok(row, 'the fixture should be on the public catalog');
      assert.ok(!('cost' in row), 'a costed product must not expose its cost publicly');
    }
  });

  test('both backends agree on the response shape', async () => {
    // Contract parity: the admin console calls this endpoint against whichever
    // driver is deployed, so the two must not drift.
    const body = {
      costs: [
        { name: 'bulk-cost-alpha', cost: 55 },
        { name: 'bulk-cost-clear', cost: '' },
        { name: 'bulk-cost-untouched' },
        { name: 'ghost product', cost: 1 },
        { name: 'bulk-cost-alpha', cost: -2 },
      ],
    };
    await both('bulk-costs', '/api/products/bulk-costs', { method: 'POST', auth: 'admin', body });
  });
});
