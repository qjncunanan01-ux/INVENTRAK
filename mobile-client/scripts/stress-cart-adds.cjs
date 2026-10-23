const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addCartItem } = require('../src/cart-item.cjs');

test('rapid repeated taps stop exactly at available stock without throwing', () => {
  const product = { id: 17, name: 'Test item', price: 24.5 };
  let cart = [];
  let accepted = 0;
  for (let tap = 0; tap < 1000; tap += 1) {
    const next = addCartItem({ previous: cart, product, available: 125 });
    if (next) {
      accepted += 1;
      cart = next;
    }
  }
  assert.equal(accepted, 125);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 125);
});

test('per-product and per-order limits reject additions without mutating the prior cart', () => {
  const product = { id: 1, name: 'Bulk item', price: 1 };
  let cart = addCartItem({ previous: [], product, qty: 10000 });
  assert.ok(cart);
  assert.equal(addCartItem({ previous: cart, product, qty: 1 }), null);
  assert.equal(cart[0].qty, 10000);

  for (let id = 2; id <= 500; id += 1) {
    cart = addCartItem({ previous: cart, product: { id, name: `Item ${id}`, price: 1 } });
    assert.ok(cart, `line ${id} should fit`);
  }
  assert.equal(cart.length, 500);
  assert.equal(addCartItem({ previous: cart, product: { id: 501, name: 'Over limit', price: 1 } }), null);
});

test('missing or malformed products fail safely instead of crashing the app', () => {
  assert.equal(addCartItem({ previous: [], product: null }), null);
  assert.equal(addCartItem({ previous: [], product: { id: 0 } }), null);
  assert.equal(addCartItem({ previous: [], product: { id: 1 }, qty: Number.MAX_SAFE_INTEGER + 1 }), null);
});
