// Fire-and-forget email + SMS notifications (zero dependencies; uses global
// fetch, available since Node 18).
//
// Providers are optional and configured entirely by environment variables, so
// the app runs and tests fine without any of them:
//   Email: RESEND_API_KEY (https://resend.com)  [+ optional EMAIL_FROM]
//   SMS:   SEMAPHORE_API_KEY (https://semaphore.co — PH gateway)
//              [+ optional SEMAPHORE_SENDER_NAME]
//          or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM (Twilio)
//
// When nothing is configured, messages are LOGGED instead of sent, so the
// behavior is visible in development without an account. Notifications never
// throw into the request path — callers fire-and-forget.

function logMessage(channel, data) {
  console.log(`[notify] ${channel} :: ${JSON.stringify(data)}`);
}

// Normalize a Philippine mobile number for a specific SMS provider:
//   Semaphore expects a leading-zero format:  09171234567
//   Twilio expects E.164 format:             +639171234567
// Handles either input style on either provider; returns null if the number
// is not a plausible PH mobile number (11 digits with 09, or +63 + 10 digits).
function normalizePhNumber(input, provider) {
  const raw = String(input || '').replace(/[^0-9+]/g, '');
  if (!raw) return null;
  let digits;
  if (raw.startsWith('+63')) digits = raw.slice(3);
  else if (raw.startsWith('63')) digits = raw.slice(2);
  else if (raw.startsWith('0')) digits = raw.slice(1);
  else digits = raw;
  if (!/^9\d{9}$/.test(digits)) return null;
  if (provider === 'twilio') return `+63${digits}`;
  return `0${digits}`; // semaphore + default
}

async function sendEmail({ to, subject, text, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logMessage('email (unconfigured — set RESEND_API_KEY to enable)', { to, subject, text: text || html });
    return { sent: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'INVENTRAK <onboarding@resend.dev>',
        to: Array.isArray(to) ? to : [to],
        subject,
        text: text || '',
        html: html || '',
      }),
    });
    if (!res.ok) {
      console.error(`[notify] email failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error(`[notify] email error: ${err && err.message}`);
    return { sent: false };
  }
}

async function sendSms({ to, message }) {
  const semaphoreKey = process.env.SEMAPHORE_API_KEY;
  if (semaphoreKey) {
    try {
      const number = normalizePhNumber(to, 'semaphore');
      if (!number) {
        console.error(`[notify] sms (semaphore) skipped: unparseable PH number "${to}"`);
        return { sent: false };
      }
      const params = new URLSearchParams({ apikey: semaphoreKey, number, message });
      if (process.env.SEMAPHORE_SENDER_NAME) params.set('sendername', process.env.SEMAPHORE_SENDER_NAME);
      const res = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      if (!res.ok) {
        console.error(`[notify] sms (semaphore) failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      console.error(`[notify] sms (semaphore) error: ${err && err.message}`);
      return { sent: false };
    }
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  if (twilioSid && twilioAuth) {
    try {
      const number = normalizePhNumber(to, 'twilio');
      if (!number) {
        console.error(`[notify] sms (twilio) skipped: unparseable PH number "${to}"`);
        return { sent: false };
      }
      const params = new URLSearchParams({
        To: number,
        From: process.env.TWILIO_FROM || '',
        Body: message,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });
      if (!res.ok) {
        console.error(`[notify] sms (twilio) failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
        return { sent: false };
      }
      return { sent: true };
    } catch (err) {
      console.error(`[notify] sms (twilio) error: ${err && err.message}`);
      return { sent: false };
    }
  }

  logMessage('sms (unconfigured — set SEMAPHORE_API_KEY or TWILIO_* to enable)', { to, message });
  return { sent: false };
}

const STATUS_LABELS = { approved: 'APPROVED', rejected: 'REJECTED', fulfilled: 'FULFILLED' };

// The stored products value is a JSON string (e.g. '["Widget x1"]'); render it
// as a readable list for the email body.
function productSummary(products) {
  if (Array.isArray(products)) return products.join(', ');
  if (typeof products === 'string') {
    try {
      const parsed = JSON.parse(products);
      if (Array.isArray(parsed)) return parsed.join(', ');
      return products;
    } catch {
      return products;
    }
  }
  return 'your items';
}

// Compose + send an order-inquiry status update to the customer (email always,
// SMS when a phone number was provided). Resolves when both channels settled.
function notifyInquiryStatus(inquiry, newStatus) {
  const label = STATUS_LABELS[newStatus] || newStatus;
  const name = (inquiry && inquiry.customer_name) || 'there';
  const text = `Hi ${name},\n\nYour order inquiry (${productSummary(inquiry && inquiry.products)}) is now ${label}.\n\n— INVENTRAK`;

  const emailP = inquiry && inquiry.customer_email
    ? sendEmail({ to: inquiry.customer_email, subject: `Your INVENTRAK order inquiry is ${label}`, text })
    : Promise.resolve({ sent: false });

  const smsP = inquiry && inquiry.customer_phone
    ? sendSms({ to: inquiry.customer_phone, message: `INVENTRAK: Your order inquiry is now ${label}.` })
    : Promise.resolve({ sent: false });

  return Promise.all([emailP, smsP]).catch((err) => {
    console.error(`[notify] inquiry notification error: ${err && err.message}`);
  });
}

// Welcome email sent on registration (fire-and-forget).
function notifyWelcome(email, username) {
  if (!email) return Promise.resolve({ sent: false });
  return sendEmail({
    to: email,
    subject: 'Welcome to INVENTRAK',
    text: `Hi ${username},\n\nYour INVENTRAK account is ready. Browse supplies, send order inquiries, and track their status.\n\n— INVENTRAK`,
  }).catch((err) => {
    console.error(`[notify] welcome email error: ${err && err.message}`);
  });
}

// Signup verification code (fire-and-forget): email always, SMS when a phone
// number was provided. Sent by the register / resend-verification endpoints;
// the code is single-use and expires after ttlMinutes. The welcome email is
// sent only AFTER the account is verified.
function notifyVerificationCode({ email, username, code, phone, ttlMinutes = 30 }) {
  const text = `Hi ${username},\n\nYour INVENTRAK verification code is:\n\n  ${code}\n\nEnter it in the app to verify your account. It expires in ${ttlMinutes} minutes.\n\n— INVENTRAK`;
  const emailP = email
    ? sendEmail({ to: email, subject: 'Your INVENTRAK verification code', text })
    : Promise.resolve({ sent: false });
  const smsP = phone
    ? sendSms({ to: phone, message: `INVENTRAK: Your verification code is ${code}.` })
    : Promise.resolve({ sent: false });
  return Promise.all([emailP, smsP]).catch((err) => {
    console.error(`[notify] verification notification error: ${err && err.message}`);
  });
}

// Password reset code email (fire-and-forget). Sent by the forgot-password
// endpoint; the code is single-use and expires after ttlMinutes (the backend
// passes the real RESET_CODE_TTL_MS converted to minutes so the email never
// lies about the expiry).
function notifyPasswordReset(email, username, code, ttlMinutes = 30) {
  if (!email) return Promise.resolve({ sent: false });
  return sendEmail({
    to: email,
    subject: 'Your INVENTRAK password reset code',
    text: `Hi ${username},\n\nUse this code to reset your INVENTRAK password:\n\n  ${code}\n\nIt expires in ${ttlMinutes} minutes. If you didn't request this, you can safely ignore this email.\n\n— INVENTRAK`,
  }).catch((err) => {
    console.error(`[notify] password reset email error: ${err && err.message}`);
  });
}

module.exports = { sendEmail, sendSms, notifyInquiryStatus, notifyWelcome, notifyPasswordReset, notifyVerificationCode, normalizePhNumber };
