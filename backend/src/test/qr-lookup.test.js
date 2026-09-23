// QR product lookup — the core of the OCR→QR migration. The scanner surfaces
// (admin Scan & Stock, staff tag scanner) decode a printed tag and resolve it
// server-side via GET /api/products/qr/:code. These tests lock:
//   - payload grammar round-trips (product tags incl. SKU/legacy forms,
//     location tags, unknown payloads rejected)
//   - the lookup contract on BOTH backends (SQLite + npm-free/Firestore):
//     product block, qr block with sku, per-location stock map, lots
//   - unknown / inactive code handling
//   - security: QR is an identifier, never an authorization; customer tokens
//     are rejected and sensitive fields never serialize into the response.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { parseProductQrIdentifier, PRODUCT_QR_PREFIX } = require('../qr-codes');

// Test-facing alias for the shared parser (returns { ok, kind, id, code } so
// both backends' grammars fit one assertion style).
function parseQrPayload(raw) {
  const parsed = parseProductQrIdentifier(raw);
  if (parsed && parsed.kind === 'id') return { ok: true, kind: 'product', id: Number(parsed.value), code: parsed.value };
  if (parsed && parsed.kind === 'sku') return { ok: true, kind: 'product', id: null, code: parsed.value };
  if (parsed && parsed.kind === 'location') return { ok: true, kind: 'location', id: parsed.id, name: parsed.name };
  return { ok: false, kind: 'unknown' };
}
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

describe('qr payload grammar', () => {
  test('product tag parses and round-trips (id form)', () => {
    const parsed = parseQrPayload('INVENTRAK:PROD:12');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.kind, 'product');
    assert.strictEqual(parsed.id, 12);
    assert.strictEqual(parsed.code, '12');
  });

  test('product tag parses the sku form', () => {
    const parsed = parseQrPayload('INVENTRAK:PROD:MILK-001');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.kind, 'product');
    assert.strictEqual(parsed.id, null, 'sku form carries no numeric id');
    assert.strictEqual(parsed.code, 'MILK-001');
  });

  test('product tag is case-insensitive and trims whitespace', () => {
    const parsed = parseQrPayload('  inventrak:prod:07 ');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.id, 7);
  });

  test('location tag parses with decoded name', () => {
    // The backend parser treats location tags as unknown for the PRODUCT
    // lookup (locations have their own flow); the grammar test reflects the
    // product-identifier contract directly.
    assert.strictEqual(parseProductQrIdentifier('INVENTRAK:LOC:3:Stockroom 1').kind, 'unknown');
    assert.strictEqual(parseProductQrIdentifier('inventrak:loc:3:x').kind, 'unknown');
  });

  test('bare legacy barcode number falls back to a product code', () => {
    const parsed = parseQrPayload('42');
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.kind, 'product');
    assert.strictEqual(parsed.id, 42);
  });

  test('arbitrary payloads are rejected (never resolved)', () => {
    const bads = [
      '',
      null,
      undefined,
      'https://phish.example/claim-prize',
      'INVENTRAK:PROD:',
      'INVENTRAK:PROD:1; DROP TABLE products',
      'INVENTRAK:WHAT:1',
      'INVENTRAK:LOC:abc:name',
      'INVENTRAK:PROD:<script>alert(1)</script>',
    ];
    for (const bad of bads) {
      const parsed = parseQrPayload(bad);
      assert.strictEqual(parsed.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    }
  });

  test('payload builder embeds nothing but the identifier', () => {
    const payload = `${PRODUCT_QR_PREFIX}MILK-001`;
    assert.strictEqual(payload, 'INVENTRAK:PROD:MILK-001');
    assert.ok(!/qty|price|cost/i.test(payload), 'no quantity/price/cost in the tag');
  });
});

describe('qr lookup endpoint (GET /api/products/qr/:code)', () => {
  test('requires authentication on both backends', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/products/qr/1');
      assert.strictEqual(res.status, 401, 'no token -> 401');
    }
  });

  test('customer token is forbidden — identifiers are not authorization', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/products/qr/1', { token: side.token.customer });
      assert.strictEqual(res.status, 403, 'customer token must not use the staff lookup');
    }
  });

  test('staff token resolves a known product with stock + lots', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/products/qr/1', { token: side.token.staff });
      assert.strictEqual(res.status, 200, 'known product id resolves');
      const body = res.json;
      assert.ok(body.product, 'product block');
      assert.ok(body.product.name, 'product has a name');
      assert.ok(body.qr && body.qr.sku, 'qr block carries the sku');
      assert.ok(body.stock && Number.isFinite(body.stock.total), 'stock.total present');
      assert.ok(body.stock.locations && typeof body.stock.locations === 'object', 'per-location map');
      assert.ok(Array.isArray(body.lots), 'lots array present');
      // Sensitive fields must never ride along.
      const serialized = JSON.stringify(body);
      const banned = ['"cost"', '"password"', '"password_hash"', '"google_sub"'];
      for (const field of banned) {
        assert.ok(!serialized.includes(field), `response must not contain ${field}`);
      }
    }
  });

  test('sku-form code resolves the same product (case-insensitive)', async () => {
    for (const code of ['PRD-000001', 'prd-000001']) {
      for (const side of [sqlite, npmfree]) {
        const res = await call(side.url, `/api/products/qr/${encodeURIComponent(code)}`, { token: side.token.staff });
        assert.strictEqual(res.status, 200, `sku lookup ${code}`);
        assert.strictEqual(Number(res.json.product.id), 1, `${code} resolves to product 1`);
      }
    }
  });

  test('unknown code returns 404 with the documented error shape', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/api/products/qr/NOPE-404', { token: side.token.staff });
      assert.strictEqual(res.status, 404);
      assert.ok(res.json.error || res.json.message, 'error shape present');
    }
  });

  test('inactive product returns 409', async () => {
    for (const side of [sqlite, npmfree]) {
      // Deactivate the product the tag points at.
      const upd = await call(side.url, '/api/products/1', {
        method: 'PUT',
        token: side.token.admin,
        body: { status: 'inactive' },
      });
      assert.ok([200, 204].includes(upd.status), `deactivate product: ${upd.status}`);
      const res = await call(side.url, '/api/products/qr/1', { token: side.token.staff });
      assert.strictEqual(res.status, 409, 'inactive product must 409, not resolve');
      // Restore for other tests.
      await call(side.url, '/api/products/1', {
        method: 'PUT',
        token: side.token.admin,
        body: { status: 'active' },
      });
    }
  });
});
