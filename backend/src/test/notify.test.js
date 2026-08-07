// Unit tests for backend/src/notify.js. Providers are env-configured, so the
// tests force an unconfigured state: sending must resolve to { sent: false }
// (log-only), never throw, and notifications must compose correctly.
// With env keys set, global.fetch is stubbed to lock the request shapes sent
// to Resend / Semaphore / Twilio.
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { sendEmail, sendSms, notifyInquiryStatus, notifyWelcome, normalizePhNumber, smtpSendMail } = require('../notify');

// Force an unconfigured state regardless of the machine's env.
const SAVED = {};
const KEYS = [
  'RESEND_API_KEY', 'EMAIL_FROM', 'SEMAPHORE_API_KEY', 'SEMAPHORE_SENDER_NAME',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE',
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

// ---------- SMTP client tests (fake local SMTP server, no network) ----------

// A minimal in-process SMTP server that speaks enough of the protocol to
// exercise the client: greeting, multiline EHLO (AUTH, no STARTTLS), AUTH
// PLAIN, MAIL FROM, RCPT TO, DATA (captures the message), QUIT.
function startFakeSmtp() {
  return new Promise((resolve) => {
    const commands = [];
    let lastMessage = '';
    const server = net.createServer((sock) => {
      let dataMode = false;
      let msg = [];
      sock.write('220 fake.smtp.test ESMTP ready\r\n');
      sock.on('data', (chunk) => {
        const text = chunk.toString();
        for (const line of text.split('\r\n')) {
          if (line === '') continue;
          if (dataMode) {
            if (line === '.') {
              dataMode = false;
              lastMessage = msg.join('\n');
              sock.write('250 2.0.0 queued\r\n');
            } else {
              msg.push(line);
            }
            continue;
          }
          commands.push(line);
          if (/^EHLO/i.test(line)) {
            sock.write('250-fake.smtp.test hello\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
          } else if (/^AUTH PLAIN/i.test(line)) {
            sock.write('235 2.7.0 authentication successful\r\n');
          } else if (/^MAIL FROM/i.test(line)) {
            sock.write('250 2.1.0 ok\r\n');
          } else if (/^RCPT TO/i.test(line)) {
            sock.write('250 2.1.5 ok\r\n');
          } else if (/^DATA/i.test(line)) {
            dataMode = true;
            msg = [];
            sock.write('354 end with <CRLF>.<CRLF>\r\n');
          } else if (/^QUIT/i.test(line)) {
            sock.write('221 2.0.0 bye\r\n');
            sock.end();
          } else {
            sock.write('250 2.0.0 ok\r\n');
          }
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        getCommands: () => commands.slice(),
        getLastMessage: () => lastMessage,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('notify: SMTP runs the full protocol (EHLO/AUTH/MAIL/RCPT/DATA/QUIT) and delivers', async () => {
  const fake = await startFakeSmtp();
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(fake.port);
  process.env.SMTP_SECURE = 'false';
  process.env.SMTP_USER = 'user@test';
  process.env.SMTP_PASS = 'secret';
  process.env.EMAIL_FROM = 'INVENTRAK <no-reply@inventrak.ph>';
  try {
    const r = await sendEmail({ to: 'buyer@example.com', subject: 'Hi', text: 'Plain body', html: '<b>Rich</b>' });
    assert.deepStrictEqual(r, { sent: true });
    const cmds = fake.getCommands();
    const verbs = cmds.map((c) => c.split(' ')[0]);
    assert.ok(verbs.includes('EHLO'), 'client sends EHLO');
    assert.ok(verbs.includes('AUTH'), 'client authenticates');
    assert.ok(verbs.includes('MAIL'), 'client sends MAIL FROM');
    assert.ok(verbs.includes('RCPT'), 'client sends RCPT TO');
    assert.ok(verbs.includes('DATA'), 'client sends DATA');
    assert.ok(verbs.includes('QUIT'), 'client quits cleanly');
    const msg = fake.getLastMessage();
    assert.ok(msg.includes('Subject: Hi'), 'subject in the message');
    assert.ok(msg.includes('Content-Type: multipart/alternative'), 'multipart body');
    assert.ok(msg.includes('<b>Rich</b>'), 'html part present');
    assert.ok(msg.includes('Plain body'), 'text part present');
  } finally {
    KEYS.forEach((k) => { delete process.env[k]; });
    await fake.close();
  }
});

test('notify: SMTP without credentials skips AUTH and still delivers', async () => {
  const fake = await startFakeSmtp();
  KEYS.forEach((k) => { delete process.env[k]; });
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(fake.port);
  process.env.SMTP_SECURE = 'false';
  try {
    const r = await smtpSendMail({
      host: '127.0.0.1', port: fake.port, secure: false, user: '', pass: '',
      from: 'a@b.com', to: 'c@d.com', subject: 'S', text: 'T', html: '',
    });
    assert.deepStrictEqual(r, { sent: true });
    const verbs = fake.getCommands().map((c) => c.split(' ')[0]);
    assert.ok(!verbs.includes('AUTH'), 'no AUTH without credentials');
    assert.ok(verbs.includes('MAIL'));
  } finally {
    KEYS.forEach((k) => { delete process.env[k]; });
    await fake.close();
  }
});

test('notify: SMTP failure (bad recipient code) resolves { sent: false } without throwing', async () => {
  // A fake server that rejects RCPT TO with 550.
  const server = await new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.write('220 fake ESMTP\r\n');
      sock.on('data', (chunk) => {
        const line = chunk.toString().split('\r\n')[0];
        if (/^EHLO/.test(line)) sock.write('250-fake\r\n250-AUTH PLAIN\r\n250 ok\r\n');
        else if (/^AUTH/.test(line)) sock.write('235 ok\r\n');
        else if (/^MAIL FROM/.test(line)) sock.write('250 ok\r\n');
        else if (/^RCPT TO/.test(line)) sock.write('550 5.1.1 no such user\r\n');
        else sock.write('250 ok\r\n');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }));
  });
  try {
    const r = await smtpSendMail({
      host: '127.0.0.1', port: server.port, secure: false, user: 'u', pass: 'p',
      from: 'a@b.com', to: 'nobody@example.com', subject: 'S', text: 'T', html: '',
    });
    assert.deepStrictEqual(r, { sent: false });
  } finally {
    await server.close();
  }
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
