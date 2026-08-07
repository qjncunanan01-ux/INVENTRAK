// Unit tests for backend/src/notify.js. Providers are env-configured, so the
// tests force an unconfigured state: sending must resolve to { sent: false }
// (log-only), never throw, and notifications must compose correctly.
// With env keys set, global.fetch is stubbed to lock the request shapes sent
// to Resend / Semaphore / Twilio.
const { test } = require('node:test');
const assert = require('node:assert');
const { sendEmail, sendSms, notifyInquiryStatus, notifyWelcome, normalizePhNumber } = require('../notify');

// Force an unconfigured state regardless of the machine's env.
const SAVED = {};
const KEYS = [
  'RESEND_API_KEY', 'EMAIL_FROM', 'SEMAPHORE_API_KEY', 'SEMAPHORE_SENDER_NAME',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM',
];

test('notify: unconfigured email and SMS resolve to { sent: false } without throwing', async () => {
  KEYS.forEach((k) => { SAVED[k] = process.env[k]; delete process.env[k]; });
  try {
    const email = await sendEmail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });
    assert.deepStrictEqual(email, { sent: false });
    const sms = await sendSms({ to: '+639171234567', message: 'Hello' });
    assert.deepStrictEqual(sms, { sent: false });
  } finally {
    KEYS.forEach((k) => { if (SAVED[k] !== undefined) process.env[k] = SAVED[k]; });
  }
});

test('notify: inquiry status notification never throws, even with no contacts', async () => {
  KEYS.forEach((k) => { SAVED[k] = process.env[k]; delete process.env[k]; });
  try {
    const result = await notifyInquiryStatus(
      { customer_name: 'Buyer', customer_email: 'buyer@example.com', customer_phone: '+639171234567', products: 'Widget x2' },
      'approved'
    );
    assert.ok(Array.isArray(result) || result === undefined, 'resolves with an array or undefined');
  } finally {
    KEYS.forEach((k) => { if (SAVED[k] !== undefined) process.env[k] = SAVED[k]; });
  }
});

test('notify: welcome email resolves to { sent: false } when unconfigured', async () => {
  KEYS.forEach((k) => { SAVED[k] = process.env[k]; delete process.env[k]; });
  try {
    const result = await notifyWelcome('new@example.com', 'newbie');
    assert.deepStrictEqual(result, { sent: false });
  } finally {
    KEYS.forEach((k) => { if (SAVED[k] !== undefined) process.env[k] = SAVED[k]; });
  }
});

test('notify: inquiry without an email/phone skips both channels cleanly', async () => {
  KEYS.forEach((k) => { SAVED[k] = process.env[k]; delete process.env[k]; });
  try {
    const result = await notifyInquiryStatus({ customer_name: 'No Contact' }, 'fulfilled');
    assert.ok(Array.isArray(result) || result === undefined);
  } finally {
    KEYS.forEach((k) => { if (SAVED[k] !== undefined) process.env[k] = SAVED[k]; });
  }
});

// ---------- stubbed-fetch request-shape tests ----------

// Install a fetch stub that records every call and answers { ok: true }.
// Returns { calls, restore }.
function stubFetch() {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, text: async () => '' };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

test('notify: email posts to Resend with Bearer auth and a correct body', async () => {
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.RESEND_API_KEY = 're_test_123';
  process.env.EMAIL_FROM = 'INVENTRAK <hello@inventrak.ph>';
  const stub = stubFetch();
  try {
    const r = await sendEmail({ to: 'buyer@example.com', subject: 'Test', text: 'Body' });
    assert.deepStrictEqual(r, { sent: true });
    assert.strictEqual(stub.calls.length, 1);
    const call = stub.calls[0];
    assert.strictEqual(call.url, 'https://api.resend.com/emails');
    assert.strictEqual(call.opts.method, 'POST');
    assert.strictEqual(call.opts.headers.Authorization, 'Bearer re_test_123');
    const body = JSON.parse(call.opts.body);
    assert.strictEqual(body.from, 'INVENTRAK <hello@inventrak.ph>');
    assert.deepStrictEqual(body.to, ['buyer@example.com']);
    assert.strictEqual(body.subject, 'Test');
  } finally {
    stub.restore();
    KEYS.forEach((k) => { delete process.env[k]; });
  }
});

test('notify: semaphore SMS uses a 0-prefixed PH number', async () => {
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.SEMAPHORE_API_KEY = 'sema_key';
  process.env.SEMAPHORE_SENDER_NAME = 'INVENTRAK';
  const stub = stubFetch();
  try {
    const r = await sendSms({ to: '+639171234567', message: 'Hello' });
    assert.deepStrictEqual(r, { sent: true });
    const call = stub.calls[0];
    assert.strictEqual(call.url, 'https://api.semaphore.co/api/v4/messages');
    const params = new URLSearchParams(call.opts.body);
    assert.strictEqual(params.get('number'), '09171234567');
    assert.strictEqual(params.get('apikey'), 'sema_key');
    assert.strictEqual(params.get('sendername'), 'INVENTRAK');
    assert.strictEqual(params.get('message'), 'Hello');
  } finally {
    stub.restore();
    KEYS.forEach((k) => { delete process.env[k]; });
  }
});

test('notify: twilio SMS uses an E.164 PH number with basic auth', async () => {
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  process.env.TWILIO_FROM = '+15005550006';
  const stub = stubFetch();
  try {
    const r = await sendSms({ to: '09171234567', message: 'Hello' });
    assert.deepStrictEqual(r, { sent: true });
    const call = stub.calls[0];
    assert.ok(call.url.includes('/Accounts/ACxxx/Messages.json'));
    const params = new URLSearchParams(call.opts.body);
    assert.strictEqual(params.get('To'), '+639171234567');
    assert.strictEqual(params.get('From'), '+15005550006');
    const expected = Buffer.from('ACxxx:tok').toString('base64');
    assert.strictEqual(call.opts.headers.Authorization, `Basic ${expected}`);
  } finally {
    stub.restore();
    KEYS.forEach((k) => { delete process.env[k]; });
  }
});

test('notify: unparseable SMS numbers are skipped, not sent', async () => {
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.SEMAPHORE_API_KEY = 'sema_key';
  const stub = stubFetch();
  try {
    const r = await sendSms({ to: 'not-a-phone', message: 'Hello' });
    assert.deepStrictEqual(r, { sent: false });
    assert.strictEqual(stub.calls.length, 0);
  } finally {
    stub.restore();
    KEYS.forEach((k) => { delete process.env[k]; });
  }
});

test('notify: normalizePhNumber handles all PH input styles', () => {
  assert.strictEqual(normalizePhNumber('09171234567', 'semaphore'), '09171234567');
  assert.strictEqual(normalizePhNumber('+639171234567', 'semaphore'), '09171234567');
  assert.strictEqual(normalizePhNumber('639171234567', 'semaphore'), '09171234567');
  assert.strictEqual(normalizePhNumber('09171234567', 'twilio'), '+639171234567');
  assert.strictEqual(normalizePhNumber('+639171234567', 'twilio'), '+639171234567');
  assert.strictEqual(normalizePhNumber('12345', 'semaphore'), null);
  assert.strictEqual(normalizePhNumber('', 'semaphore'), null);
  assert.strictEqual(normalizePhNumber(null, 'twilio'), null);
});

test('notify: provider failure (non-ok) resolves { sent: false } and logs', async () => {
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.RESEND_API_KEY = 're_test_123';
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });
  try {
    const r = await sendEmail({ to: 'a@b.com', subject: 'S', text: 'T' });
    assert.deepStrictEqual(r, { sent: false });
  } finally {
    global.fetch = original;
    KEYS.forEach((k) => { delete process.env[k]; });
  }
});
