// Unit tests for backend/src/notify.js. Providers are env-configured, so the
// tests force an unconfigured state: sending must resolve to { sent: false }
// (log-only), never throw, and notifications must compose correctly.
const { test } = require('node:test');
const assert = require('node:assert');
const { sendEmail, sendSms, notifyInquiryStatus, notifyWelcome } = require('../notify');

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
