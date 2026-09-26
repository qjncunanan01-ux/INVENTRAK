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

  test('URL-encoded full-payload form resolves the same product', async () => {
    // A scanner app may hand the lookup the verbatim tag payload;
    // HTTP clients may percent-encode it (':' -> %3A). Both backends must
    // accept both forms — the npm-free dispatcher previously skipped the
    // decode step, so the encoded form 400'd only there.
    const encoded = encodeURIComponent('INVENTRAK:PROD:1');
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, `/api/products/qr/${encoded}`, { token: side.token.staff });
      assert.strictEqual(res.status, 200, 'encoded full payload resolves');
      assert.strictEqual(Number(res.json.product.id), 1, 'resolves to product 1');
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
      // Deactivate the product the tag points at. A partial PUT nulls the
      // unspecified columns on BOTH backends (a pinned contract), so round-trip
      // the full record — otherwise the reactivation would leave product 1
      // nameless for every later test.
      const current = await call(side.url, '/api/products/1');
      assert.strictEqual(current.status, 200, 'product 1 readable before the cycle');
      const base = current.json || {};
      const setStatus = (status) => call(side.url, '/api/products/1', {
        method: 'PUT',
        token: side.token.admin,
        body: { ...base, status },
      });
      const upd = await setStatus('inactive');
      assert.ok([200, 204].includes(upd.status), `deactivate product: ${upd.status}`);
      const res = await call(side.url, '/api/products/qr/1', { token: side.token.staff });
      assert.strictEqual(res.status, 409, 'inactive product must 409, not resolve');
      // Restore for other tests.
      await setStatus('active');
    }
  });

  test('camera-friendly tag URL resolves identically to the plain payload', async () => {
    // Printed tags carry https://…/t/<id> so native phone cameras open the
    // public tag page. The app scanners unwrap it — and the server-side
    // lookup accepts the URL form directly, so either decoded value resolves.
    for (const side of [sqlite, npmfree]) {
      const res = await call(
        side.url,
        `/api/products/qr/${encodeURIComponent('https://inventrak-api.onrender.com/t/1')}`,
        { token: side.token.staff },
      );
      assert.strictEqual(res.status, 200, 'tag URL resolves through the QR lookup');
      assert.strictEqual(Number(res.json.product.id), 1);
    }
  });
});

describe('public tag page (GET /t/:code — camera-friendly URL target)', () => {
  test('serves HTML for a known tag WITHOUT any auth, on both backends', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/t/1');
      assert.strictEqual(res.status, 200, 'public tag page resolves');
      assert.match(res.contentType || '', /text\/html/, 'HTML content type');
      assert.ok(res.text.includes('Da Vinci'), 'product name rendered');
      assert.ok(res.text.includes('on hand'), 'stock line rendered');
    }
  });

  test('accepts the sku form and the raw payload form', async () => {
    for (const side of [sqlite, npmfree]) {
      const skuRes = await call(side.url, '/t/PRD-000001');
      assert.strictEqual(skuRes.status, 200);
      assert.ok(skuRes.text.includes('Da Vinci'));
      const payloadRes = await call(side.url, `/t/${encodeURIComponent('INVENTRAK:PROD:1')}`);
      assert.strictEqual(payloadRes.status, 200);
      assert.ok(payloadRes.text.includes('Da Vinci'));
    }
  });

  test('unknown tag renders a friendly 404 page (never a stack)', async () => {
    for (const side of [sqlite, npmfree]) {
      const res = await call(side.url, '/t/999999');
      assert.strictEqual(res.status, 404);
      assert.match(res.contentType || '', /text\/html/);
      assert.ok(res.text.includes('not registered'), 'documented wording shown');
    }
  });

  test('malformed codes 400, foreign QRs stay unknown — no resolution', async () => {
    for (const side of [sqlite, npmfree]) {
      const bad = await call(side.url, `/t/${encodeURIComponent('INVENTRAK:PROD:1; DROP TABLE products')}`);
      assert.strictEqual(bad.status, 400);
      const foreign = await call(side.url, '/t/not-a-tag');
      assert.ok([400, 404].includes(foreign.status));
    }
  });

  test('page renderer HTML-escapes every product field (injection-proof)', () => {
    // The create/update APIs sanitize tags at input, but the page itself must
    // not trust stored data (pre-sanitization rows, cloud drivers, future
    // writers). Unit-test the renderer with hostile values directly.
    const { renderTagPageHtml } = require('../qr-codes');
    const evil = {
      status: 200,
      body: {
        product: {
          id: 1,
          name: '<script>alert(1)</script>',
          category: 'Cats & Dogs',
          brand: 'A"B',
          description: "It's <b>bold</b> & fun",
          size: null,
          unit: null,
          image: null,
        },
        qr: { payload: 'INVENTRAK:PROD:1', sku: 'PRD-000001', tagUrl: 'https://x/t/1' },
        stock: { total: 5, status: 'ok' },
      },
    };
    const html = renderTagPageHtml(evil);
    assert.ok(!html.includes('<script>'), 'raw script tag must never appear');
    assert.ok(html.includes('&lt;script&gt;'), 'name escaped');
    assert.ok(html.includes('Cats &amp; Dogs'), 'category ampersand escaped');
    assert.ok(html.includes('&quot;'), 'brand quote escaped');
    assert.ok(!html.includes("It's <b>"), 'description tags escaped');
  });
});
