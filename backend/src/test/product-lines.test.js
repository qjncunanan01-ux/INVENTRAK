// Tests for product-lines.js line summarization — locks the customer-facing
// notification fix: stored line OBJECTS used to render as "[object Object]"
// in "Your order inquiry (...)" emails. Every raw storage shape must render
// as a readable product list.
const { test } = require('node:test');
const assert = require('node:assert');

const { summarizeProducts, normalizeLines, priceLinesFromCatalog, summarizeLines } = require('../catalog-orders/product-lines');

test('summarizeProducts renders canonical line objects readably (the [object Object] regression)', () => {
  // Exactly what POST /api/order-inquiries stores today.
  const raw = [
    { id: null, name: 'Da Vinci Butterscotch Sauce', qty: 2, unit_price: 1070, original_price: null, subtotal: 2140 },
    { id: null, name: 'MATCHA POWDER', qty: 1, unit_price: 350, original_price: 420, subtotal: 350 },
  ];
  assert.strictEqual(summarizeProducts(raw), 'Da Vinci Butterscotch Sauce x2, MATCHA POWDER');
});

test('summarizeProducts handles the JSON-string storage shape', () => {
  assert.strictEqual(
    summarizeProducts('[{"name":"Widget","qty":3}]'),
    'Widget x3'
  );
});

test('summarizeProducts handles legacy plain-string rows', () => {
  assert.strictEqual(summarizeProducts(['Butterscotch x2', 'Syrup']), 'Butterscotch x2, Syrup');
  // A JSON string of legacy strings is parsed and rendered canonically:
  // qty 1 omits the x-suffix ("Legacy x1" ≡ "Legacy"), qty>1 keeps it.
  assert.strictEqual(summarizeProducts(JSON.stringify(['Legacy x1'])), 'Legacy');
  assert.strictEqual(summarizeProducts(JSON.stringify(['Legacy x3'])), 'Legacy x3');
});

test('summarizeProducts never returns an empty summary', () => {
  assert.strictEqual(summarizeProducts([]), 'your items');
  assert.strictEqual(summarizeProducts(undefined), 'your items');
  assert.strictEqual(summarizeProducts('not json'), 'not json');
});

test('normalizeLines derives totals only from priced lines (locked contract)', () => {
  const { lines, total, hasPrices } = normalizeLines([
    { name: 'A', qty: 2, price: 10 },
    { name: 'B', qty: 1, price: 5 },
  ]);
  assert.strictEqual(hasPrices, true);
  assert.strictEqual(total, 25);
  assert.strictEqual(lines[0].subtotal, 20);
  const unpriced = normalizeLines(['Legacy x2']);
  assert.strictEqual(unpriced.hasPrices, false);
  assert.strictEqual(unpriced.total, null);
});

test('QR Ph prices every line from the active server catalog, not client fields', () => {
  const priced = priceLinesFromCatalog([
    { id: 7, name: 'Edited name', qty: 2, unit_price: 0.01, subtotal: 0.02, original_price: 0.01 },
  ], [
    { id: 7, name: 'Server product name', price: 125.5, status: 'active' },
  ]);
  assert.equal(priced.error, undefined);
  assert.equal(priced.total, 251);
  assert.deepEqual(priced.lines[0], {
    id: 7,
    name: 'Server product name',
    qty: 2,
    unit_price: 125.5,
    original_price: null,
    subtotal: 251,
  });
});

test('QR Ph refuses free-text, stale, and inactive items before charging', () => {
  assert.match(priceLinesFromCatalog([{ id: null, name: 'Widget', qty: 1 }], []).error, /refresh the catalog/i);
  assert.match(priceLinesFromCatalog([{ id: 2, name: 'Widget', qty: 1 }], []).error, /unavailable/i);
  assert.match(priceLinesFromCatalog([{ id: 2, name: 'Widget', qty: 1 }], [
    { id: 2, name: 'Widget', price: 10, status: 'inactive' },
  ]).error, /unavailable/i);
});

test('summarizeLines maps qty>1 to name xN (mobile + admin rendering contract)', () => {
  assert.strictEqual(summarizeLines([{ name: 'A', qty: 2 }, { name: 'B', qty: 1 }]), 'A x2, B');
});
