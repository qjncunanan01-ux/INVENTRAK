// OCR unit tests: the fuzzy matcher and the shared handler's validation paths
// run without the tesseract engine (which downloads traineddata at first use
// and is only exercised live / via the deployed server).
const { test } = require('node:test');
const assert = require('node:assert');
const { matchProducts, normalize, matchScore, handleOcr, handleOcrStock, attachStock, filterOcrText, matchByFilename, basenameOf, stemOf } = require('../ocr');

const PRODUCTS = [
  { id: 1, name: 'Butterscotch Sauce', price: 1070, image: '/images/a.jpg' },
  { id: 2, name: 'Classic Caramel Sauce', price: 950, image: '/images/b.jpg' },
  { id: 3, name: 'Full Cream Milk 1L', price: 220, image: '/images/c.jpg' },
  { id: 4, name: 'Matcha Green Tea Powder', price: 1400, image: '/images/d.jpg' },
];

// Catalog whose names contain the brand + flavors used in the filter tests.
const LABEL_PRODUCTS = [
  { id: 1, name: 'Torani Vanilla Syrup (750 ML)' },
  { id: 2, name: 'Vanilla Syrup 1 L' },
  { id: 3, name: 'Butterscotch Sauce' },
];

test('normalize strips punctuation, lowercases and drops size/unit tokens', () => {
  assert.deepStrictEqual(normalize('Butterscotch 2-L Sauce!!!'), ['butterscotch', 'sauce']);
  assert.deepStrictEqual(normalize('Vanilla Syrup 750 ML'), ['vanilla', 'syrup']);
  assert.deepStrictEqual(normalize('1000g'), []); // glued digits+unit drops out
  assert.deepStrictEqual(normalize('750ml'), []);
  assert.deepStrictEqual(normalize('1L'), []);
});

test('matchScore returns token overlap ratio', () => {
  assert.strictEqual(matchScore(['butterscotch', 'sauce'], 'Butterscotch Sauce'), 1);
  assert.strictEqual(matchScore(['caramel'], 'Classic Caramel Sauce'), 1 / 3);
  assert.strictEqual(matchScore(['unrelated'], 'Butterscotch Sauce'), 0);
});

test('matchScore tolerates a single typo on 5+ letter words but not short ones', () => {
  assert.strictEqual(matchScore(['carmel', 'sauce'], 'Classic Caramel Sauce'), 2 / 3);
  // Size tokens are dropped, so reading the exact product name scores 1.0.
  assert.strictEqual(matchScore(['vanila', 'syrup'], 'Vanilla Syrup 1 L'), 1);
  assert.strictEqual(matchScore(['caraml'], 'Classic Caramel Sauce'), 1 / 3);
  assert.strictEqual(matchScore(['sac'], 'Butterscotch Sauce'), 0); // 3-letter: exact only
  // A size-only scan has no distinctive tokens -> no match.
  assert.strictEqual(matchScore(['750', 'ml'], 'Vanilla Syrup 1 L'), 0);
});

test('house-brand tokens are non-discriminating (logo-only scans never match)', () => {
  const BRANDED = [
    { id: 1, name: 'Brew with Sylver', price: 300 },
    { id: 2, name: 'Sylver Arabica Coffee Beans', price: 1400 },
    { id: 3, name: 'Vanilla Syrup 1 L', price: 460 },
  ];
  // A scan that only reads the SYLVER watermark must NOT float up the
  // brand-named products — it reports no match instead.
  assert.deepStrictEqual(matchProducts('SYLVER', BRANDED), []);
  assert.strictEqual(matchScore(['sylver'], 'Brew with Sylver'), 0);
  // A real read still matches, with the brand token ignored on both sides;
  // size tokens ("1 L") are dropped so a full name read scores 1.0.
  const matches = matchProducts('TORANI VANILLA SYRUP SYLVER', BRANDED);
  assert.strictEqual(matches[0].id, 3);
  assert.strictEqual(matches[0].score, 1);
  assert.ok(!matches.some((m) => m.id === 1 || m.id === 2));
});

test('a typo in a real label still finds the right product', () => {
  const matches = matchProducts('CARAMEL SAUSE', PRODUCTS); // sause -> sauce
  assert.strictEqual(matches[0].id, 2);
  assert.strictEqual(matches[0].score, 2 / 3);
});

test('matchProducts ranks best matches first and filters below threshold', () => {
  const matches = matchProducts('CARAMEL SAUCE', PRODUCTS);
  assert.ok(matches.length >= 1);
  assert.strictEqual(matches[0].id, 2);
  assert.strictEqual(matches[0].score, 2 / 3);
});

test('a one-word scan never matches a product (only specific names do)', () => {
  // "SYRUP" describes a category, not a product — with no second distinctive
  // token it must be an honest miss instead of a confident wrong pick.
  assert.deepStrictEqual(matchProducts('SYRUP', [
    { id: 1, name: 'Vanilla Syrup 1 L' },
    { id: 2, name: 'Chocolate Syrup 1 L' },
  ]), []);
  assert.deepStrictEqual(matchProducts('VANILLA', [
    { id: 1, name: 'Vanilla Syrup 1 L' },
  ]), []);
  // A logo/brand-only read is also a miss.
  assert.deepStrictEqual(matchProducts('TORANI', [
    { id: 1, name: 'Torani Vanilla Syrup' },
  ]), []);
});

test('two distinctive tokens are enough to identify a specific product', () => {
  const matches = matchProducts('TORANI VANILLA SYRUP', [
    { id: 1, name: 'Torani Vanilla Syrup' },
    { id: 2, name: 'Torani Caramel Syrup' },
  ]);
  // The exact product tops the list at 1.0; the caramel sibling still clears
  // the bar (2 shared distinctive tokens: torani + syrup) at 2/3.
  assert.strictEqual(matches[0].id, 1);
  assert.strictEqual(matches[0].score, 1);
  assert.ok(matches.length >= 2);
  assert.strictEqual(matches[1].id, 2);
  assert.strictEqual(matches[1].score, 2 / 3);
});

test('matchProducts handles empty text', () => {
  assert.deepStrictEqual(matchProducts('', PRODUCTS), []);
  assert.deepStrictEqual(matchProducts('!!!', PRODUCTS), []);
});

// ============= Filename matching (admin catalog-image uploads) =============

const IMG_PRODUCTS = [
  { id: 1, name: 'Acc Caramel Syrup', image: '/images/achievers--acc-caramel-syrup-1kg.jpg' },
  { id: 2, name: 'Torani Vanilla Syrup', image: '/images/torani--vanilla-syrup-750ml.jpg' },
  { id: 3, name: 'Matcha Green Tea Powder', image: '/images/matcha-powder.jpg' },
];

test('basenameOf / stemOf strip folders and extensions', () => {
  assert.strictEqual(basenameOf('/images/a.jpg'), 'a.jpg');
  assert.strictEqual(basenameOf('C:\\x\\b.png'), 'b.png');
  assert.strictEqual(stemOf('/images/torani--vanilla-syrup-750ml.jpg'), 'torani--vanilla-syrup-750ml');
});

test('matchByFilename resolves the exact product image by file name', () => {
  const m = matchByFilename('achievers--acc-caramel-syrup-1kg.jpg', IMG_PRODUCTS);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, 1);
  assert.strictEqual(m[0].name, 'Acc Caramel Syrup');
  assert.strictEqual(m[0].score, 1);
  assert.strictEqual(m[0].matchedBy, 'filename');
});

test('matchByFilename is case- and folder-insensitive', () => {
  const m = matchByFilename('C:\\Users\\me\\Downloads\\MATCHA-POWDER.PNG', IMG_PRODUCTS);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].name, 'Matcha Green Tea Powder');
  assert.strictEqual(m[0].score, 1);
});

test('matchByFilename falls back to fuzzy token matching for renamed files', () => {
  // "caramel syrup" (renamed/cropped) still resolves to the Acc Caramel Syrup
  // product via the same typo-tolerant token scoring as OCR reads.
  const m = matchByFilename('caramel-syrup.jpg', IMG_PRODUCTS);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].name, 'Acc Caramel Syrup');
  assert.strictEqual(m[0].matchedBy, 'filename');
});

test('matchByFilename returns nothing for unknown file names', () => {
  assert.deepStrictEqual(matchByFilename('random-photo.jpg', IMG_PRODUCTS), []);
  assert.deepStrictEqual(matchByFilename('', IMG_PRODUCTS), []);
  assert.deepStrictEqual(matchByFilename(null, IMG_PRODUCTS), []);
  // A one-token name is not a specific product (same rule as OCR reads).
  assert.deepStrictEqual(matchByFilename('syrup.jpg', IMG_PRODUCTS), []);
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

test('filterOcrText keeps only the lines that can match the catalog', () => {
  const label = [
    'TORANI',
    'Vanilla Syrup 750 ml',
    'Ingredients: sugar, water, natural and artificial flavor',
    'Net Content: 750 ml',
    '4801234567890',
    'Manufactured in the Philippines for Torani Inc.',
    'www.torani.com',
    '1 L',
  ].join('\n');
  const filtered = filterOcrText(label, LABEL_PRODUCTS);
  // Kept: brand + product lines — the "needed" text. Size-only lines
  // ("1 L") are dropped since they carry no matching signal.
  assert.ok(filtered.includes('TORANI'), 'brand line kept');
  assert.ok(filtered.includes('Vanilla Syrup 750 ml'), 'name line kept');
  assert.ok(!filtered.includes('1 L'), 'size-only line dropped');
  // Dropped: ingredient paragraph, logistics, barcode, URL.
  assert.ok(!filtered.includes('Ingredient'), 'ingredients dropped');
  assert.ok(!filtered.includes('Net Content'), 'net-content dropped');
  assert.ok(!filtered.includes('4801'), 'barcode dropped');
  assert.ok(!filtered.includes('Manufactured'), 'manufacturer dropped');
  assert.ok(!filtered.includes('www.'), 'URL dropped');
});

test('filterOcrText drops pure-digit lines and long paragraphs', () => {
  assert.strictEqual(filterOcrText('\n\n750\n\n'), '');
  assert.strictEqual(filterOcrText('A'.repeat(90) + '\nBarcode 123456789012'), '');
});

test('filterOcrText drops glued nutrition rows and hallucinated barcode runs', () => {
  // tesseract often glues the value to the label ("Total Fat0 g") and reads
  // barcode bars as vowel-less alphanumeric noise ("AQNN1929AER720N").
  const filtered = filterOcrText('TORANI\nTotal Fat0 g\nSodium5mg\nAQNN1929AER720N\nVanilla Syrup 750 ml', LABEL_PRODUCTS);
  assert.strictEqual(filtered, 'TORANI\nVanilla Syrup 750 ml');
});

test('filterOcrText hides lines whose words match no catalog product', () => {
  // "TNR" and the barcode run have no catalog words; "TORANI" does.
  const filtered = filterOcrText('TORANI\nTNR\nAQNN1929AER720N\nVanilla Syrup 750 ml', LABEL_PRODUCTS);
  assert.strictEqual(filtered, 'TORANI\nVanilla Syrup 750 ml');
});

test('filterOcrText output still drives matching (composition)', () => {
  const label = [
    'CLASSIC CARAMEL SAUCE',
    'Net Content: 950 g',
    '4801234567890',
    'Ingredients: caramel, sugar, water',
  ].join('\n');
  const filtered = filterOcrText(label, PRODUCTS);
  assert.strictEqual(filtered, 'CLASSIC CARAMEL SAUCE');
  const matches = matchProducts(filtered, PRODUCTS);
  assert.strictEqual(matches[0].id, 2);
  assert.strictEqual(matches[0].score, 1);
});

test('matchProducts respects limit and minScore', () => {
  // Two distinctive tokens -> several products can legitimately match;
  // the limit then caps the list (explicit minScore: 0 stays overridable
  // for callers that want a looser net).
  const all = matchProducts('sauce caramel', PRODUCTS, { limit: 10, minScore: 0 });
  assert.ok(all.length >= 1);
  const capped = matchProducts('sauce caramel', PRODUCTS, { limit: 1, minScore: 0 });
  assert.strictEqual(capped.length, 1);
  assert.strictEqual(capped[0].id, 2);
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

test('attachStock adds per-location stock, total and low/out status', () => {
  const matches = [
    { id: 1, name: 'Full Cream Milk 1L', score: 1 },
    { id: 2, name: 'Classic Caramel Sauce', score: 0.8 },
    { id: 3, name: 'Matcha Green Tea Powder', score: 0.6 },
  ];
  const lookup = (id) => ({
    1: { locations: { Main: 120, Branch: 40 }, total: 160 },
    2: { locations: { Main: 30 }, total: 30 },
  }[id] || { locations: {}, total: 0 });
  const withStock = attachStock(matches, lookup);
  assert.deepStrictEqual(withStock[0].stock, { locations: { Main: 120, Branch: 40 }, total: 160, status: 'ok' });
  assert.deepStrictEqual(withStock[1].stock, { locations: { Main: 30 }, total: 30, status: 'low' });
  assert.deepStrictEqual(withStock[2].stock, { locations: {}, total: 0, status: 'out' });
});

test('handleOcrStock validates the payload before touching the engine', async () => {
  const fakeRes = { status: 0, body: null };
  const sendJson = (res, status, body) => { res.status = status; res.body = body; };
  const lookup = () => ({ locations: {}, total: 0 });

  await handleOcrStock({ body: {} }, fakeRes, sendJson, PRODUCTS, lookup);
  assert.strictEqual(fakeRes.status, 400);
  assert.match(fakeRes.body.details[0], /image/);

  await handleOcrStock({ body: { image: 'not base64 !!!' } }, fakeRes, sendJson, PRODUCTS, lookup);
  assert.strictEqual(fakeRes.status, 400);

  const huge = 'A'.repeat(13 * 1024 * 1024);
  await handleOcrStock({ body: { image: huge } }, fakeRes, sendJson, PRODUCTS, lookup);
  assert.strictEqual(fakeRes.status, 400);
});
