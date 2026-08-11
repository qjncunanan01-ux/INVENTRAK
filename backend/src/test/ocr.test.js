// OCR unit tests: the fuzzy matcher and the shared handler's validation paths
// run without the tesseract engine (which downloads traineddata at first use
// and is only exercised live / via the deployed server).
const { test } = require('node:test');
const assert = require('node:assert');
const { matchProducts, normalize, matchScore, handleOcr } = require('../ocr');

const PRODUCTS = [
  { id: 1, name: 'Butterscotch Sauce', price: 1070, image: '/images/a.jpg' },
  { id: 2, name: 'Classic Caramel Sauce', price: 950, image: '/images/b.jpg' },
  { id: 3, name: 'Full Cream Milk 1L', price: 220, image: '/images/c.jpg' },
  { id: 4, name: 'Matcha Green Tea Powder', price: 1400, image: '/images/d.jpg' },
];

test('normalize strips punctuation and lowercases', () => {
  assert.deepStrictEqual(normalize('Butterscotch 2-L Sauce!!!'), ['butterscotch', '2', 'l', 'sauce']);
});

test('matchScore returns token overlap ratio', () => {
  assert.strictEqual(matchScore(['butterscotch', 'sauce'], 'Butterscotch Sauce'), 1);
  assert.strictEqual(matchScore(['caramel'], 'Classic Caramel Sauce'), 1 / 3);
  assert.strictEqual(matchScore(['unrelated'], 'Butterscotch Sauce'), 0);
});

test('matchProducts ranks best matches first and filters below threshold', () => {
  const matches = matchProducts('CARAMEL SAUCE', PRODUCTS);
  assert.ok(matches.length >= 1);
  assert.strictEqual(matches[0].id, 2);
  assert.strictEqual(matches[0].score, 2 / 3);
});

test('matchProducts handles empty text', () => {
  assert.deepStrictEqual(matchProducts('', PRODUCTS), []);
  assert.deepStrictEqual(matchProducts('!!!', PRODUCTS), []);
});

test('matchProducts reads price from both raw (capitalized) and normalized rows', () => {
  // Raw catalog rows (npm-free / Firestore path) use `Price`; SQLite
  // normalization uses `price`. Match cards must show P<price> on both.
  const raw = matchProducts('CARAMEL SAUCE', [
    { id: 9, 'Product Name': 'Classic Caramel Sauce', Price: 950, Image: '/images/x.jpg' },
  ]);
  assert.strictEqual(raw[0].price, 950);
  assert.strictEqual(raw[0].image, '/images/x.jpg');
  const norm = matchProducts('CARAMEL SAUCE', [
    { id: 10, name: 'Classic Caramel Sauce', price: 950, image: '/images/y.jpg' },
  ]);
  assert.strictEqual(norm[0].price, 950);
  assert.strictEqual(norm[0].image, '/images/y.jpg');
});

test('matchProducts assigns positional ids to id-less raw rows (list keys + deep-link)', () => {
  // Raw rows have no id; the match must still carry one (idx+1, matching the
  // ids /api/products exposes) so React list keys are unique and the
  // "View product" deep-link finds the right item on the Firestore path.
  const matches = matchProducts('CARAMEL SAUCE', [
    { 'Product Name': 'Classic Caramel Sauce', Price: 950 },
    { 'Product Name': 'Other Sauce', Price: 100 },
  ]);
  assert.ok(matches.length >= 1);
  for (const m of matches) {
    assert.strictEqual(typeof m.id, 'number');
    assert.ok(m.id >= 1);
  }
  assert.strictEqual(matches[0].id, 1, 'top match keeps its positional id');
});

test('matchProducts respects limit and minScore', () => {
  const all = matchProducts('sauce', PRODUCTS, { limit: 10, minScore: 0 });
  assert.ok(all.length >= 2);
  const capped = matchProducts('sauce', PRODUCTS, { limit: 1, minScore: 0 });
  assert.strictEqual(capped.length, 1);
});

test('handleOcr validates the payload before touching the engine', async () => {
  const fakeRes = { status: 0, body: null };
  const sendJson = (res, status, body) => { res.status = status; res.body = body; };

  // Missing image -> 400.
  await handleOcr({ body: {} }, fakeRes, sendJson, PRODUCTS);
  assert.strictEqual(fakeRes.status, 400);
  assert.match(fakeRes.body.details[0], /image/);

  // Non-base64 -> 400.
  await handleOcr({ body: { image: 'not base64 !!!' } }, fakeRes, sendJson, PRODUCTS);
  assert.strictEqual(fakeRes.status, 400);

  // Oversized -> 400.
  const huge = 'A'.repeat(13 * 1024 * 1024);
  await handleOcr({ body: { image: huge } }, fakeRes, sendJson, PRODUCTS);
  assert.strictEqual(fakeRes.status, 400);
});
