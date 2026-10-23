// notify-test.js — prove real email + SMS delivery against the configured
// providers (Resend for email, PhilSMS/Semaphore/Twilio for SMS). Run it AFTER pasting
// the provider keys into the environment:
//
//   RESEND_API_KEY=re_xxx PHILSMS_API_TOKEN=xxx PHILSMS_SENDER_ID=SYLVERS \
//   TEST_EMAIL=you@example.com TEST_PHONE=09171234567 \
//   npm run notify:test
//
// Exit codes: 0 = all configured channels sent, 1 = a channel is unconfigured
// or failed (CI-gateable), 2 = no provider configured at all.
const { sendEmail, sendSms } = require('../src/notify');

const emailKey = process.env.RESEND_API_KEY;
const philsmsToken = process.env.PHILSMS_API_TOKEN;
const philsmsSenderId = process.env.PHILSMS_SENDER_ID;
const semaphoreKey = process.env.SEMAPHORE_API_KEY;
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuth = process.env.TWILIO_AUTH_TOKEN;

const testEmail = process.env.TEST_EMAIL;
const testPhone = process.env.TEST_PHONE;

function hr() {
  console.log('----------------------------------------');
}

async function main() {
  const results = [];
  let configured = 0;

  if (!emailKey && !philsmsToken && !semaphoreKey && !(twilioSid && twilioAuth)) {
    console.log('[notify:test] No providers configured.');
    console.log('  Email:  RESEND_API_KEY');
    console.log('  SMS:    PHILSMS_API_TOKEN + PHILSMS_SENDER_ID, SEMAPHORE_API_KEY, or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN');
    console.log('See DEPLOY.md -> "Real email + SMS notifications".');
    process.exit(2);
  }

  if (emailKey) {
    configured += 1;
    if (!testEmail) {
      results.push({
        channel: 'email',
        ok: false,
        detail: 'TEST_EMAIL not set — set it to the address to receive the test',
      });
    } else {
      hr();
      console.log(`[notify:test] sending test EMAIL to ${testEmail} via Resend...`);
      const r = await sendEmail({
        to: testEmail,
        subject: 'INVENTRAK notification test',
        text: 'This is a test message from the INVENTRAK notification system. If you received this, email delivery is working.',
      });
      results.push({ channel: 'email', ok: r.sent, detail: `to ${testEmail}` });
    }
  } else {
    results.push({ channel: 'email', ok: null, detail: 'RESEND_API_KEY not set — skipped' });
  }

  const smsConfigured = philsmsToken || semaphoreKey || (twilioSid && twilioAuth);
  if (smsConfigured) {
    configured += 1;
    if (philsmsToken && !philsmsSenderId) {
      results.push({
        channel: 'sms',
        ok: false,
        detail: 'PHILSMS_SENDER_ID not set — set it to your registered PhilSMS sender ID',
      });
    } else if (!testPhone) {
      results.push({
        channel: 'sms',
        ok: false,
        detail: 'TEST_PHONE not set — set it to the PH mobile number to receive the test',
      });
    } else {
      hr();
      const smsProvider = philsmsToken ? 'PhilSMS' : semaphoreKey ? 'Semaphore' : 'Twilio';
      console.log(`[notify:test] sending test SMS to ${testPhone} via ${smsProvider}...`);
      const r = await sendSms({
        to: testPhone,
        message: 'INVENTRAK notification test. If you received this, SMS delivery is working.',
      });
      results.push({ channel: 'sms', ok: r.sent, detail: `to ${testPhone}` });
    }
  } else {
    results.push({ channel: 'sms', ok: null, detail: 'PHILSMS_API_TOKEN / SEMAPHORE_API_KEY / TWILIO_* not set — skipped' });
  }

  hr();
  let failed = 0;
  for (const r of results) {
    const mark = r.ok === true ? 'PASS' : r.ok === null ? 'SKIP' : 'FAIL';
    if (r.ok === false) failed += 1;
    console.log(`[notify:test] ${mark}  ${r.channel}: ${r.detail}`);
  }
  hr();
  if (failed > 0) {
    console.log(
      `[notify:test] ${failed} channel(s) failed — check the provider error logged above and the keys in the env.`
    );
    process.exit(1);
  }
  if (configured === 0) process.exit(2);
  console.log(`[notify:test] OK — ${configured} configured channel(s) all green. Check the recipient's inbox/phone.`);
  process.exit(0);
}

main().catch(err => {
  console.error(`[notify:test] unexpected error: ${err && err.stack}`);
  process.exit(1);
});
