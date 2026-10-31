const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  buildPaymentStep,
  createPayMongoSession,
  payMongoConfigError,
  validatePayMongoWebhook,
  applyVerifiedQrPhPayment,
} = require('../payments');
const { SYLVER_POLICY_DEMO } = require('../catalog-orders/company-policy');

function makePaidEvent({ amount = 12345, livemode = false, eventType = 'checkout_session.payment.paid' } = {}) {
  return {
    event_type: 'send.webhook',
    data: {
      id: 'evt_test_1',
      type: eventType,
      livemode,
      data: {
        id: 'cs_test_1',
        attributes: {
          reference_number: 'INVENTRAK-ORDER-41',
          currency: 'PHP',
          payments: [{
            id: 'pay_test_1',
            attributes: {
              status: 'paid',
              amount,
              currency: 'PHP',
              source: { type: 'qrph' },
            },
          }],
        },
      },
    },
  };
}

function signEvent(event, secret = 'webhook-test-secret', timestamp = '1793400000') {
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody.toString('utf8')).digest('hex');
  return { rawBody, signature: 't=' + timestamp + ',te=' + signature + ',li=' + signature };
}

test('COD and legacy production GCash do not create fake payment steps', async() => {
  assert.equal(await buildPaymentStep({ id: 1, amount: 100, paymentMethod: 'cod' }), null);
  if (!SYLVER_POLICY_DEMO) {
    assert.equal(await buildPaymentStep({ id: 1, amount: 100, paymentMethod: 'gcash' }), null);
    assert.equal(await buildPaymentStep({ id: 1, amount: 100, paymentMethod: 'card' }), null);
  }
});

test('PayMongo configuration requires separate API, webhook, and redirect settings', () => {
  assert.match(payMongoConfigError({}), /PAYMONGO_SECRET_KEY/);
  assert.match(payMongoConfigError({ PAYMONGO_SECRET_KEY: 'sk_test_example' }), /PAYMONGO_WEBHOOK_SECRET/);
  assert.equal(payMongoConfigError({
    PAYMONGO_SECRET_KEY: 'sk_test_example',
    PAYMONGO_WEBHOOK_SECRET: 'whsec_example',
    PAYMONGO_SUCCESS_URL: 'https://example.test/success',
    PAYMONGO_CANCEL_URL: 'https://example.test/cancel',
  }), null);
});

test('PayMongo QR Ph checkout creates a PHP v2 hosted session with Basic auth', async(t) => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async(url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async() => ({
        data: {
          id: 'cs_test_1',
          attributes: {
            checkout_url: 'https://checkout.paymongo.com/test',
            reference_number: 'INVENTRAK-ORDER-41',
            status: 'unpaid',
          },
        },
      }),
    };
  };
  t.after(() => { global.fetch = originalFetch; });

  const session = await createPayMongoSession({
    id: 41,
    amount: 123.45,
    description: 'Sylver order 41',
    email: 'buyer@example.test',
    env: {
      PAYMONGO_SECRET_KEY: 'sk_test_example',
      PAYMONGO_WEBHOOK_SECRET: 'whsec_example',
      PAYMONGO_SUCCESS_URL: 'https://example.test/success',
      PAYMONGO_CANCEL_URL: 'https://example.test/cancel',
    },
  });

  assert.equal(request.url, 'https://api.paymongo.com/v2/checkout_sessions');
  assert.equal(request.options.headers.Authorization, 'Basic ' + Buffer.from('sk_test_example:').toString('base64'));
  assert.deepEqual(request.body.data.attributes.payment_method_types, ['qrph']);
  assert.equal(request.body.data.attributes.line_items[0].amount, 12345);
  assert.equal(request.body.data.attributes.line_items[0].currency, 'PHP');
  assert.equal(request.body.data.attributes.billing.email, 'buyer@example.test');
  assert.equal(request.body.data.attributes.send_email_receipt, true);
  assert.equal(session.session_id, 'cs_test_1');
  assert.equal(session.checkout_url, 'https://checkout.paymongo.com/test');
});

test('QR Ph paid webhook requires valid raw-body signature and matching mode', () => {
  const event = makePaidEvent();
  const { rawBody, signature } = signEvent(event);
  const env = { PAYMONGO_SECRET_KEY: 'sk_test_example', PAYMONGO_WEBHOOK_SECRET: 'webhook-test-secret' };
  const verified = validatePayMongoWebhook(rawBody, signature, { env });
  assert.equal(verified.ok, true);
  assert.equal(verified.reference, 'INVENTRAK-ORDER-41');
  assert.equal(verified.amount_minor, 12345);
  assert.equal(verified.currency, 'PHP');

  assert.equal(validatePayMongoWebhook(rawBody, 't=1,te=00,li=00', { env }).status, 401);
  const liveEvent = makePaidEvent({ livemode: true });
  const liveSigned = signEvent(liveEvent);
  assert.equal(validatePayMongoWebhook(liveSigned.rawBody, liveSigned.signature, { env }).status, 401);
  assert.equal(validatePayMongoWebhook(JSON.parse(rawBody.toString()), signature, { env }).status, 400);
});

test('non-payment PayMongo webhook events are safely acknowledged without payment mutation', () => {
  const event = makePaidEvent({ eventType: 'checkout_session.payment.failed' });
  const { rawBody, signature } = signEvent(event);
  const result = validatePayMongoWebhook(rawBody, signature, {
    env: { PAYMONGO_SECRET_KEY: 'sk_test_example', PAYMONGO_WEBHOOK_SECRET: 'webhook-test-secret' },
  });
  assert.deepEqual(result, { ok: true, ignored: true, event_id: 'evt_test_1' });
});

test('signed paid webhook samples for another method are acknowledged without payment mutation', () => {
  const event = makePaidEvent();
  event.data.data.attributes.payment_method_used = 'gcash';
  event.data.data.attributes.payments[0].attributes.source.type = 'gcash';
  delete event.data.data.attributes.payments[0].attributes.amount;
  delete event.data.data.attributes.payments[0].attributes.currency;
  const { rawBody, signature } = signEvent(event);
  const result = validatePayMongoWebhook(rawBody, signature, {
    env: { PAYMONGO_SECRET_KEY: 'sk_test_example', PAYMONGO_WEBHOOK_SECRET: 'webhook-test-secret' },
  });
  assert.deepEqual(result, { ok: true, ignored: true, event_id: 'evt_test_1' });
});

test('verified QR Ph payment must match stored checkout ID, reference, currency, and exact amount', () => {
  const verified = {
    session_id: 'cs_test_1',
    payment_id: 'pay_test_1',
    event_id: 'evt_test_1',
    reference: 'INVENTRAK-ORDER-41',
    amount_minor: 12345,
    currency: 'PHP',
  };
  const order = {
    id: 41,
    estimated_cost: 123.45,
    delivery_fee: 0,
    amount_paid: 0,
    payment_status: 'unpaid',
    payment_method: 'qrph',
    payment_provider: 'paymongo',
    payment_records: JSON.stringify([{
      type: 'paymongo_checkout',
      provider_reference: 'cs_test_1',
      reference: 'INVENTRAK-ORDER-41',
      amount: 123.45,
      status: 'pending',
    }]),
  };
  const settled = applyVerifiedQrPhPayment(order, verified, '2026-10-31T00:00:00.000Z');
  assert.equal(settled.ok, true);
  assert.equal(settled.payment_status, 'paid');
  assert.equal(settled.amount_paid, 123.45);

  const updatedOrder = { ...order, ...settled };
  const parsed = JSON.parse(updatedOrder.payment_records);
  const duplicate = applyVerifiedQrPhPayment(updatedOrder, verified);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);

  assert.equal(applyVerifiedQrPhPayment(order, { ...verified, amount_minor: 12344 }).ok, false);
  assert.equal(applyVerifiedQrPhPayment(order, { ...verified, session_id: 'cs_other' }).ok, false);
  assert.equal(parsed[0].provider_payment_id, 'pay_test_1');
});
