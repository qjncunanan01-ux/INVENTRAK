// Payment QR contract tests — the payment_qr must be a locally generated
// data URL (private, works offline), NEVER a third-party QR web service URL,
// which would leak the amount + reference as URL parameters.
const { test } = require('node:test');
const assert = require('node:assert');

const { buildPaymentStep, qrImageUrl, qrPayload } = require('../payments');

test('COD produces no payment step', async() => {
  const step = await buildPaymentStep({ id: 1, amount: 100, paymentMethod: 'cod' });
  assert.strictEqual(step, null);
});

test('gcash demo fallback: QR is a local data URL containing the payload', async() => {
  const step = await buildPaymentStep({ id: 7, amount: 1234.5, description: 'Order', paymentMethod: 'gcash' });
  assert.ok(step, 'demo fallback always returns a step');
  assert.strictEqual(step.payment_provider, 'demo');
  assert.strictEqual(step.payment_status, 'unpaid');
  assert.match(step.payment_reference, /^GCASH-/);
  assert.ok(step.payment_qr.startsWith('data:image/png;base64,'), `expected data URL, got ${step.payment_qr.slice(0, 60)}`);
  assert.ok(!step.payment_qr.includes('qrserver.com'), 'must not reference a third-party QR service');
  // The data URL decodes to a real PNG of non-trivial size.
  const base64 = step.payment_qr.split(',')[1];
  assert.ok(Buffer.from(base64, 'base64').length > 500, 'QR image should be a real bitmap');
});

test('qrImageUrl always returns a data URL (and works for arbitrary payloads)', async() => {
  const url = await qrImageUrl('INVENTRAK PAYMENT\nAmount: PHP 1.00\nRef: X');
  assert.ok(url.startsWith('data:image/png;base64,'));
});

test('qrPayload embeds amount and reference readably', () => {
  const p = qrPayload(99.5, 'GCASH-0001AB');
  assert.ok(p.includes('PHP 99.50'));
  assert.ok(p.includes('GCASH-0001AB'));
});
