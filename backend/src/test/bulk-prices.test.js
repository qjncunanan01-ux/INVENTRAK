// Bulk price entry (POST /api/products/bulk-prices) and the audit trail it
// leaves behind.
//
// Why this needs its own suite: /bulk-prices was the ONLY catalog write that
// was not audited. The bulk COST sheet logs every product it touches (so the
// admin "Recent cost changes" panel is real), but the price sheet — which
// decides the number every margin, quote and profit figure is derived from —
// left nothing behind. That gap is invisible until the admin console grows a
// one-click reprice button that can rewrite prices across the catalog without
// asking anyone.
//
// Two shapes of bug are locked down here, matching the cost suite:
//   - an audit summary that never says WHICH products changed (not a change log)
//   - the payload nesting. audit() spreads details at the TOP level of the
//     entry, so a reader that reaches for entry.details.updated renders a
//     permanent "0 updated".
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

const { sqlite, npmfree, bootBoth, teardown, call, both } = require('./harness');

const FIXTURES = ['bulk-price-audit-a', 'bulk-price-audit-b', 'bulk-price-audit-c'];

before(async () => {
  await bootBoth();
  // Dedicated fixtures rather than seeded catalog rows: the reprice action
  // rewrites prices, and a shared seeded row would leak into other suites that
  // assert against the catalog's price column.
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

const priceOne = async (side, name, price) =>
  call(side.url, '/api/products/bulk-prices', {
    method: 'POST',
    token: side.token.admin,
    body: { prices: [{ name, price }] },
  });

describe('bulk price audit', () => {
  test('a bulk reprice is audited, and names the products it changed', async () => {
    const logPath = process.env.AUDIT_LOG_FILE;
    for (const side of [sqlite, npmfree]) {
      fs.writeFileSync(logPath, '');
      await priceOne(side, 'bulk-price-audit-a', 610);
      await priceOne(side, 'bulk-price-audit-b', 620);
      const entries = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      const ev = entries.find(e => e.event === 'product.price.bulk_update');
      assert.ok(ev, `${side.url}: a bulk price change is audited`);
      assert.strictEqual(ev.updated, 1, 'counts sit at the top level of the entry');
      assert.ok(Array.isArray(ev.products), 'the entry names the products it changed');
      assert.ok(ev.products.some(n => String(n).includes('bulk-price-audit-a')));
      assert.ok(ev.actor, 'the actor is recorded');
    }
  });

  test('one audit entry covers a multi-product reprice', async () => {
    // The one-click action sends every suggested price in ONE request, so the
    // audit entry has to summarise the batch rather than one row per product.
    const logPath = process.env.AUDIT_LOG_FILE;
    for (const side of [sqlite, npmfree]) {
      fs.writeFileSync(logPath, '');
      await call(side.url, '/api/products/bulk-prices', {
        method: 'POST',
        token: side.token.admin,
        body: {
          prices: [
            { name: 'bulk-price-audit-a', price: 611 },
            { name: 'bulk-price-audit-b', price: 622 },
            { name: 'bulk-price-audit-c', price: 633 },
          ],
        },
      });
      const entries = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      const evs = entries.filter(e => e.event === 'product.price.bulk_update');
      assert.strictEqual(evs.length, 1, 'one request, one entry');
      assert.strictEqual(evs[0].updated, 3);
      assert.strictEqual(evs[0].products.length, 3, 'all three are named');
      assert.strictEqual(evs[0].total, 3);
    }
  });

  test('the named list is capped so a full-catalog reprice cannot bloat a row', async () => {
    const logPath = process.env.AUDIT_LOG_FILE;
    for (const side of [sqlite, npmfree]) {
      fs.writeFileSync(logPath, '');
      // 30 distinct seeded products, which is over the 25-name cap.
      const catalog = JSON.parse((await call(side.url, '/api/products')).text);
      const prices = catalog.slice(0, 30).map(p => ({ name: p.name, price: 777 }));
      await call(side.url, '/api/products/bulk-prices', {
        method: 'POST',
        token: side.token.admin,
        body: { prices },
      });
      const entries = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      const ev = entries.find(e => e.event === 'product.price.bulk_update');
      assert.ok(ev, `${side.url}: the batch is still audited`);
      assert.strictEqual(ev.updated, 30, 'the COUNT is not capped, only the name list');
      assert.strictEqual(ev.products.length, 25, 'the name list stops at the cap');
    }
  });

  test('a reprice that changes nothing writes no audit entry', async () => {
    // A no-op request should not manufacture a change-log line; otherwise the
    // history fills with entries describing nothing.
    const logPath = process.env.AUDIT_LOG_FILE;
    for (const side of [sqlite, npmfree]) {
      fs.writeFileSync(logPath, '');
      const res = await call(side.url, '/api/products/bulk-prices', {
        method: 'POST',
        token: side.token.admin,
        body: { prices: [{ name: 'no such product at all', price: 100 }] },
      });
      assert.strictEqual(JSON.parse(res.text).updated, 0);
      const entries = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      assert.strictEqual(
        entries.filter(e => e.event === 'product.price.bulk_update').length,
        0,
        `${side.url}: nothing changed, so nothing should be logged`
      );
    }
  });

  test('the price change actually landed, and stayed out of the public cost path', async () => {
    for (const side of [sqlite, npmfree]) {
      await priceOne(side, 'bulk-price-audit-c', 640);
      const res = await call(side.url, '/api/products');
      const row = JSON.parse(res.text).find(p => p.name === 'bulk-price-audit-c');
      assert.strictEqual(row.price, 640, `${side.url}: the reprice is readable on the public catalog`);
      assert.ok(!('cost' in row), 'and the cost column stays private');
    }
  });

  test('both backends agree on the response shape', async () => {
    await both('bulk-prices', '/api/products/bulk-prices', {
      method: 'POST',
      auth: 'admin',
      body: {
        prices: [
          { name: 'bulk-price-audit-a', price: 700 },
          { name: 'ghost product', price: 1 },
          { name: 'bulk-price-audit-a', price: -5 },
        ],
      },
    });
  });
});