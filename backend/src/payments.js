// Payments module — GCash payment step for order inquiries.
//
// Real gateway: when PAYMONGO_SECRET_KEY is set, a PayMongo Checkout Session
// is created (PayMongo is the standard PH gateway that supports GCash), and
// the customer gets a checkout_url to open in a browser.
//
// Demo fallback (no key needed): a deterministic pseudo-payment is generated —
// a GCash-style reference code and a QR payload (the exact reference + amount)
// rendered as a QR image via a public QR API. This keeps the "Pay via GCash"
// step fully demoable offline, while the real gateway just swaps in when the
// key is present.
//
// The module is deliberately dependency-free: no SDK, just fetch() (Node 18+
// has global fetch) for the PayMongo call.

const crypto = require('crypto');

const PAYMONGO_API = 'https://api.paymongo.com/v1/checkout_sessions';

// GCash-style reference, e.g. "GCASH-8K3MZ21P" (readable, deterministic-ish).
function makeReference(id) {
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
  return `GCASH-${String(id || '0').padStart(4, '0')}${suffix.slice(0, 2)}`;
}

// QR payload the customer would scan in the GCash app: amount + reference.
function qrPayload(amount, reference) {
  return `INVENTRAK PAYMENT\nAmount: PHP ${Number(amount || 0).toFixed(2)}\nRef: ${reference}`;
}

// QR image URL (api.qrserver.com needs no key; the same URL pattern is used
// by the mobile client to render the QR with the built-in <Image> component).
function qrImageUrl(payload) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(payload)}`;
}

// PayMongo checkout session (real GCash payment). Basic auth with the secret
// key (no SDK needed). Amount is in centavos, currency PHP, and the session
// returns a checkout_url the customer opens to pay.
async function createPayMongoSession({ amount, description, reference, email }) {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) return null;

  const body = {
    data: {
      attributes: {
        amount: Math.round(Number(amount || 0) * 100),
        currency: 'PHP',
        description: String(description || 'INVENTRAK order').slice(0, 190),
        statement_descriptor: 'INVENTRAK',
        reference_number: reference,
        payment_method_types: ['gcash'],
        ...(email ? { send_email_receipt: true, customer: { email } } : {}),
      },
    },
  };

  let res;
  try {
    res = await fetch(PAYMONGO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(secretKey).toString('base64')}`,
      },
      body: JSON.stringify(body),
      // Don't let a slow gateway hold up checkout forever.
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    // Network-level failure (DNS, timeout, connection refused): fall back to
    // the QR demo instead of letting checkout hang / 500.
    console.error(`[payments] PayMongo network error: ${err && err.message}`);
    return null;
  }

  if (!res.ok) {
    // Do NOT throw: fall back to the QR demo so an unconfigured/expired key
    // never breaks checkout. The failure is logged for the admin.
    const text = await res.text().catch(() => '');
    console.error(`[payments] PayMongo error ${res.status}: ${text.slice(0, 300)}`);
    return null;
  }

  const json = await res.json();
  const attrs = json && json.data && json.data.attributes;
  if (!attrs || !attrs.checkout_url) return null;

  return {
    provider: 'paymongo',
    checkout_url: attrs.checkout_url,
    payment_intent: attrs.payment_intent && attrs.payment_intent.id,
    reference: attrs.reference_number || reference,
    status: attrs.status || 'checkout',
  };
}

// Build the payment step for an inquiry. Tries PayMongo first (when the key
// is present); the QR fallback is always available so GCash payment works in
// the demo without any external keys.
async function buildPaymentStep({ id, amount, description, email, paymentMethod }) {
  if (paymentMethod !== 'gcash' && paymentMethod !== 'card') {
    return null; // COD / other: no payment step.
  }

  const reference = makeReference(id);
  const provider = 'gcash'; // GCash is the headline method; card routes the same UI.

  let session = null;
  try {
    session = await createPayMongoSession({
      amount,
      description,
      reference,
      email,
    });
  } catch (err) {
    // Never let a payment-provider failure break checkout (belt-and-braces:
    // createPayMongoSession already catches network errors internally).
    console.error(`[payments] session error: ${err && err.message}`);
  }

  if (session) {
    return {
      payment_method: paymentMethod,
      payment_status: 'unpaid',
      payment_reference: session.reference || reference,
      payment_url: session.checkout_url,
      payment_qr: qrImageUrl(
        `PAYMENT ${session.reference || reference} AMOUNT PHP ${Number(amount || 0).toFixed(2)}`
      ),
      payment_provider: session.provider,
    };
  }

  // Demo fallback: deterministic QR + reference, no external keys.
  return {
    payment_method: paymentMethod,
    payment_status: 'unpaid',
    payment_reference: reference,
    payment_url: null,
    payment_qr: qrImageUrl(qrPayload(amount, reference)),
    payment_provider: 'demo',
  };
}

module.exports = { buildPaymentStep, makeReference, qrImageUrl, qrPayload };
