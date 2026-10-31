// Shared PayMongo QR Ph checkout and webhook verification helpers.
// Secrets stay on the backend; the customer app receives only a hosted checkout URL.

const crypto = require('crypto');
const { SYLVER_POLICY_DEMO } = require('./catalog-orders/company-policy');

const PAYMONGO_API = 'https://api.paymongo.com/v2/checkout_sessions';

function payMongoConfigError(env = process.env) {
  const missing = [
    ['PAYMONGO_SECRET_KEY', env.PAYMONGO_SECRET_KEY],
    ['PAYMONGO_WEBHOOK_SECRET', env.PAYMONGO_WEBHOOK_SECRET],
    ['PAYMONGO_SUCCESS_URL', env.PAYMONGO_SUCCESS_URL],
    ['PAYMONGO_CANCEL_URL', env.PAYMONGO_CANCEL_URL],
  ].filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
  if (missing.length) return 'QR Ph checkout is not configured (' + missing.join(', ') + ')';
  if (!/^(sk_test_|sk_live_)/.test(String(env.PAYMONGO_SECRET_KEY))) {
    return 'PAYMONGO_SECRET_KEY must be a PayMongo test or live secret key';
  }
  for (const name of ['PAYMONGO_SUCCESS_URL', 'PAYMONGO_CANCEL_URL']) {
    try {
      if (new URL(env[name]).protocol !== 'https:') return name + ' must be an HTTPS URL';
    } catch {
      return name + ' must be a valid HTTPS URL';
    }
  }
  return null;
}

function makeReference(id) {
  return `INVENTRAK-ORDER-${String(id)}`;
}

async function createPayMongoSession({ id, amount, description, email, env = process.env }) {
  const configError = payMongoConfigError(env);
  if (configError) throw new Error(configError);

  const amountMinor = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100) {
    throw new Error('QR Ph checkout requires an order total of at least PHP 1.00');
  }

  const reference = makeReference(id);
  const body = {
    data: {
      attributes: {
        line_items: [{
          currency: 'PHP',
          amount: amountMinor,
          name: String(description || `Sylver order ${id}`).slice(0, 80),
          quantity: 1,
        }],
        payment_method_types: ['qrph'],
        success_url: env.PAYMONGO_SUCCESS_URL,
        cancel_url: env.PAYMONGO_CANCEL_URL,
        reference_number: reference,
        ...(email ? {
          billing: { email: String(email).slice(0, 254) },
          send_email_receipt: true,
        } : {}),
      },
    },
  };

  let response;
  try {
    response = await fetch(PAYMONGO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // PayMongo secret keys use HTTP Basic auth with an empty password.
        Authorization: `Basic ${Buffer.from(`${env.PAYMONGO_SECRET_KEY}:`).toString('base64')}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error(`[payments] PayMongo QR Ph request failed: ${err && err.message}`);
    throw new Error('PayMongo QR Ph checkout could not be reached');
  }

  if (!response.ok) {
    console.error(`[payments] PayMongo QR Ph returned HTTP ${response.status}`);
    throw new Error('PayMongo could not create the QR Ph checkout');
  }

  let json;
  try { json = await response.json(); } catch { throw new Error('PayMongo returned an invalid checkout response'); }
  const data = json && json.data;
  const attrs = data && data.attributes;
  if (!data || !data.id || !attrs || !attrs.checkout_url) {
    throw new Error('PayMongo returned an incomplete QR Ph checkout response');
  }
  return {
    provider: 'paymongo',
    session_id: data.id,
    checkout_url: attrs.checkout_url,
    reference: attrs.reference_number || reference,
    status: attrs.status || 'unpaid',
  };
}

function parseSignatureHeader(header) {
  const values = {};
  for (const part of String(header || '').split(',')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key && value && !values[key]) values[key] = value;
  }
  return values;
}

function validatePayMongoWebhook(rawBody, signatureHeader, { env = process.env } = {}) {
  if (!Buffer.isBuffer(rawBody)) return { ok: false, status: 400, error: 'Expected raw webhook body' };
  const secret = String(env.PAYMONGO_WEBHOOK_SECRET || '');
  const apiKey = String(env.PAYMONGO_SECRET_KEY || '');
  if (!secret || !apiKey) return { ok: false, status: 503, error: 'PayMongo webhook is not configured' };

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return { ok: false, status: 400, error: 'Invalid webhook JSON' }; }
  const eventData = event && event.data;
  const legacyAttrs = eventData && eventData.attributes;
  const eventType = eventData && (eventData.type || (legacyAttrs && legacyAttrs.type));
  const livemode = eventData && (typeof eventData.livemode === 'boolean' ? eventData.livemode : legacyAttrs && legacyAttrs.livemode);
  if (typeof eventType !== 'string' || typeof livemode !== 'boolean') {
    return { ok: false, status: 400, error: 'Invalid PayMongo event payload' };
  }
  const liveKey = apiKey.startsWith('sk_live_');
  if (livemode !== liveKey) return { ok: false, status: 401, error: 'PayMongo mode mismatch' };

  const parts = parseSignatureHeader(signatureHeader);
  const timestamp = parts.t;
  const provided = livemode ? parts.li : parts.te;
  if (!timestamp || !/^\d+$/.test(timestamp) || !provided || !/^[a-f\d]{64}$/i.test(provided)) {
    return { ok: false, status: 401, error: 'Invalid PayMongo signature' };
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  const providedBytes = Buffer.from(provided, 'hex');
  if (expectedBytes.length !== providedBytes.length || !crypto.timingSafeEqual(expectedBytes, providedBytes)) {
    return { ok: false, status: 401, error: 'Invalid PayMongo signature' };
  }

  const eventId = eventData.id || event.id || null;
  if (eventType !== 'checkout_session.payment.paid') {
    return { ok: true, ignored: true, event_id: eventId };
  }
  const session = eventData.data || (legacyAttrs && legacyAttrs.data);
  const sessionAttrs = session && session.attributes;
  const payments = sessionAttrs && Array.isArray(sessionAttrs.payments) ? sessionAttrs.payments : [];
  if (!session || !session.id || !sessionAttrs || !sessionAttrs.reference_number) {
    return { ok: true, ignored: true, event_id: eventId };
  }
  const payment = payments.find((item) => {
    const attrs = item && item.attributes;
    return attrs && attrs.status === 'paid' && attrs.source && attrs.source.type === 'qrph';
  });
  // A signed test delivery can contain a sample payment for a different method
  // (for example GCash) or an incomplete fixture. Acknowledge it without ever
  // treating it as QR Ph, so PayMongo doesn't retry an unrelated event forever.
  if (!payment) return { ok: true, ignored: true, event_id: eventId };
  const paymentAttrs = payment && payment.attributes;
  if (!paymentAttrs || !payment.id) {
    return { ok: false, status: 400, error: 'PayMongo event is missing paid QR Ph details' };
  }
  const currency = String(paymentAttrs.currency || sessionAttrs.currency || '').toUpperCase();
  if (currency !== 'PHP' || !Number.isSafeInteger(Number(paymentAttrs.amount))) {
    return { ok: false, status: 400, error: 'PayMongo payment has invalid currency or amount' };
  }
  return {
    ok: true,
    ignored: false,
    event_id: eventId,
    session_id: session.id,
    payment_id: payment.id,
    reference: String(sessionAttrs.reference_number),
    amount_minor: Number(paymentAttrs.amount),
    currency,
    livemode,
  };
}

function applyVerifiedQrPhPayment(order, verified, now = new Date().toISOString()) {
  if (!order || order.payment_method !== 'qrph' || order.payment_provider !== 'paymongo') {
    return { ok: false, error: 'Order is not a PayMongo QR Ph order' };
  }
  let records;
  try { records = typeof order.payment_records === 'string' ? JSON.parse(order.payment_records) : order.payment_records; }
  catch { records = []; }
  if (!Array.isArray(records)) records = [];
  const checkout = records.find((record) => record
    && record.type === 'paymongo_checkout'
    && String(record.provider_reference) === String(verified.session_id)
    && String(record.reference) === String(verified.reference));
  if (!checkout) return { ok: false, error: 'Checkout session does not match this order' };

  if (checkout.status === 'verified' && String(checkout.provider_payment_id) === String(verified.payment_id)) {
    return { ok: true, changed: false, duplicate: true };
  }
  if (checkout.status !== 'pending' || order.payment_status === 'paid') {
    return { ok: false, error: 'Order already has a different final payment state' };
  }
  const expectedMinor = Math.round(Number(checkout.amount) * 100);
  if (!Number.isSafeInteger(expectedMinor) || verified.amount_minor !== expectedMinor || verified.currency !== 'PHP') {
    return { ok: false, error: 'Paid amount does not match the order checkout amount' };
  }

  checkout.status = 'verified';
  checkout.provider_payment_id = verified.payment_id;
  checkout.webhook_event_id = verified.event_id || null;
  checkout.paid_at = now;
  const amountPaid = Math.round((Number(order.amount_paid || 0) + verified.amount_minor / 100) * 100) / 100;
  const amountDue = Math.round((Number(order.estimated_cost || 0) + Number(order.delivery_fee || 0)) * 100) / 100;
  const paymentStatus = amountPaid + 0.01 >= amountDue ? 'paid' : 'partial';
  return {
    ok: true,
    changed: true,
    payment_records: JSON.stringify(records),
    amount_paid: amountPaid,
    payment_status: paymentStatus,
    payment_updated_at: now,
  };
}

async function buildPaymentStep({ id, amount, description, email, paymentMethod }) {
  if (SYLVER_POLICY_DEMO) {
    if (paymentMethod === 'card') {
      const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
      return {
        payment_method: 'card', payment_status: 'unpaid',
        payment_reference: `CARD-DEMO-${String(id || '0').padStart(4, '0')}-${suffix}`,
        payment_url: null, payment_qr: null, payment_provider: 'demo_card',
      };
    }
    if (!['gcash', 'bank_transfer'].includes(paymentMethod)) return null;
    const prefix = paymentMethod === 'gcash' ? 'GCASH' : 'BANK';
    const reference = `${prefix}-${String(id || '0').padStart(4, '0')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    return {
      payment_method: paymentMethod, payment_status: 'unpaid',
      payment_reference: reference, payment_url: null, payment_qr: null,
      payment_provider: 'demo_manual',
    };
  }
  if (paymentMethod !== 'qrph') return null;

  const session = await createPayMongoSession({ id, amount, description, email });
  return {
    payment_method: 'qrph',
    payment_status: 'unpaid',
    payment_reference: session.reference,
    payment_url: session.checkout_url,
    payment_qr: null,
    payment_provider: session.provider,
    payment_provider_reference: session.session_id,
  };
}

module.exports = {
  buildPaymentStep,
  createPayMongoSession,
  makeReference,
  payMongoConfigError,
  applyVerifiedQrPhPayment,
  validatePayMongoWebhook,
};
