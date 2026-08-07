// Fire-and-forget email + SMS notifications (zero dependencies; uses global
// fetch, and net/tls for SMTP).
//
// Providers are optional and configured entirely by environment variables, so
// the app runs and tests fine without any of them:
//   Email (generic SMTP — delivers to ANY recipient; works with Gmail
//         app-passwords, Brevo, Mailgun, etc.):
//         SMTP_HOST [+ SMTP_PORT (default 465 secure / 587 STARTTLS),
//                     SMTP_USER, SMTP_PASS, EMAIL_FROM]
//   Email (Resend HTTP API): RESEND_API_KEY  [+ optional EMAIL_FROM]
//         NOTE: the free onboarding@resend.dev sender only delivers to the
//         account owner's inbox until a domain is verified — use SMTP (above)
//         or a verified domain to reach real customers.
//   SMS:   SEMAPHORE_API_KEY (https://semaphore.co — PH gateway)
//              [+ optional SEMAPHORE_SENDER_NAME]
//          or TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM (Twilio)
//
// When nothing is configured, messages are LOGGED instead of sent, so the
// behavior is visible in development without an account. Notifications never
// throw into the request path — callers fire-and-forget.

const net = require('net');
const tls = require('tls');

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

// ---------- generic SMTP client (zero dependencies) ----------
// Implicit TLS (port 465) or STARTTLS (port 587) with AUTH PLAIN. Resolves
// { sent: boolean } and never throws.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function linesToHtml(text) {
  return String(text == null ? '' : text).split('\n').map(esc).join('<br>');
}

// Branded HTML wrapper used by every email (code rendered as a big dashed box).
function htmlBody({ title, bodyText, code }) {
  const codeHtml = code
    ? `<div style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:12px;padding:18px;font-size:30px;letter-spacing:8px;font-weight:800;color:#14532d;text-align:center;margin:20px 0;font-family:monospace,Consolas">${esc(code)}</div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:24px">
  <div style="background:#166534;border-radius:14px 14px 0 0;padding:22px;text-align:center">
    <div style="color:#ffffff;font-size:20px;font-weight:800">🌾 INVENTRAK</div>
    <div style="color:#bbf7d0;font-size:12px;margin-top:2px">Inventory &amp; Order Management</div>
  </div>
  <div style="background:#ffffff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 14px 14px;padding:26px">
    <h2 style="margin:0 0 14px;color:#0f172a;font-size:18px">${esc(title)}</h2>
    <div style="color:#334155;font-size:14px;line-height:1.65">${bodyText}</div>
    ${codeHtml}
    <p style="color:#94a3b8;font-size:12px;margin-top:22px;line-height:1.5">— INVENTRAK<br>If you didn't request this, you can safely ignore this email.</p>
  </div>
</div></body></html>`;
}

function buildMessage(from, to, subject, text, html) {
  const headers = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0'];
  let body;
  if (html) {
    headers.push('Content-Type: multipart/alternative; boundary="inventrak_boundary"');
    body = [
      '--inventrak_boundary',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text || '',
      '--inventrak_boundary',
      'Content-Type: text/html; charset=utf-8',
      '',
      html,
      '--inventrak_boundary--',
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    body = text || '';
  }
  // CRLF + dot-stuffing (a line starting with '.' must be doubled).
  return headers.join('\r\n') + '\r\n\r\n' + body.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

// One SMTP transaction for a single recipient. Resolves { sent: boolean }.
function smtpSendMail({ host, port, secure, user, pass, from, to, subject, text, html }) {
  return new Promise((resolve) => {
    const TIMEOUT_MS = 15000;
    let buffer = '';
    let replyLines = [];
    let stage = 'greeting';
    let settled = false;
    let socket = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      console.error(`[notify] smtp error: ${(err && err.message) || err}`);
      try { socket && socket.destroy(); } catch {}
      resolve({ sent: false });
    };
    const done = () => {
      if (settled) return;
      settled = true;
      try { socket && socket.end(); } catch {}
      resolve({ sent: true });
    };
    const writeLine = (line) => socket.write(line + '\r\n');

    function onReply(code, all) {
      switch (stage) {
        case 'greeting':
          if (code !== 220) return fail(new Error(`greeting ${code}`));
          stage = 'ehlo';
          writeLine('EHLO inventrak.local');
          return;
        case 'ehlo': {
          if (code !== 250) return fail(new Error(`EHLO ${code}`));
          const canStartTls = !secure && /STARTTLS/i.test(all);
          const canAuth = !!user && /AUTH/i.test(all);
          if (canStartTls) { stage = 'starttls'; writeLine('STARTTLS'); }
          else if (canAuth) { stage = 'auth'; writeLine(`AUTH PLAIN ${Buffer.from(`\u0000${user}\u0000${pass}`).toString('base64')}`); }
          else { stage = 'mail'; writeLine(`MAIL FROM:<${from}>`); }
          return;
        }
        case 'starttls': {
          if (code !== 220) return fail(new Error(`STARTTLS ${code}`));
          // Upgrade the existing connection to TLS, then re-EHLO.
          socket.removeListener('data', onData);
          const tlsSocket = tls.connect({ socket, servername: host });
          socket = tlsSocket;
          buffer = '';
          replyLines = [];
          attach(tlsSocket);
          stage = 'ehlo';
          writeLine('EHLO inventrak.local');
          return;
        }
        case 'auth':
          if (code !== 235) return fail(new Error(`AUTH ${code}`));
          stage = 'mail';
          writeLine(`MAIL FROM:<${from}>`);
          return;
        case 'mail':
          if (code !== 250) return fail(new Error(`MAIL FROM ${code}`));
          stage = 'rcpt';
          writeLine(`RCPT TO:<${to}>`);
          return;
        case 'rcpt':
          if (code !== 250) return fail(new Error(`RCPT TO ${code}`));
          stage = 'data';
          writeLine('DATA');
          return;
        case 'data':
          if (code !== 354) return fail(new Error(`DATA ${code}`));
          stage = 'body';
          socket.write(buildMessage(from, to, subject, text, html) + '\r\n.\r\n');
          return;
        case 'body':
          if (code !== 250) return fail(new Error(`message ${code}`));
          stage = 'quit';
          writeLine('QUIT');
          return;
        case 'quit':
          if (code !== 221) return fail(new Error(`QUIT ${code}`));
          done();
          return;
        default:
          fail(new Error(`unexpected stage ${stage}`));
      }
    }

    function onData(chunk) {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const m = line.match(/^(\d{3})([ -])(.*)$/);
        if (!m) continue;
        replyLines.push(line);
        if (m[2] === ' ') {
          const all = replyLines.join('\n');
          replyLines = [];
          onReply(Number(m[1]), all);
          if (settled) return;
        }
      }
    }

    function attach(s) {
      s.setTimeout(TIMEOUT_MS, () => fail(new Error('SMTP timeout')));
      s.on('error', fail);
      s.on('data', onData);
    }

    socket = secure
      ? tls.connect({ host, port: port || 465, servername: host })
      : net.connect(port || 587, host);
    attach(socket);
  });
}

// ---------- email (SMTP first, then Resend API, then log) ----------

async function sendEmail({ to, subject, text, html }) {
  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0) return { sent: false };

  // 1) Generic SMTP — preferred: delivers to ANY recipient.
  if (process.env.SMTP_HOST) {
    // Convention: 587 means STARTTLS, 465 (or unset) means implicit TLS;
    // SMTP_SECURE=true/false overrides when set.
    const port = parseInt(process.env.SMTP_PORT || '', 10) || 465;
    const secure = process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : port !== 587;
    let last = { sent: false };
    for (const recipient of recipients) {
      last = await smtpSendMail({
        host: process.env.SMTP_HOST,
        port,
        secure,
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.EMAIL_FROM || `INVENTRAK <inventrak@${process.env.SMTP_HOST}>`,
        to: recipient,
        subject,
        text: text || '',
        html: html || '',
      });
      if (!last.sent) break;
    }
    return { sent: last.sent };
  }

  // 2) Resend HTTP API.
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logMessage('email (unconfigured — set SMTP_HOST or RESEND_API_KEY to enable)', { to, subject, text: text || html });
    return { sent: false };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'INVENTRAK <onboarding@resend.dev>',
        to: recipients,
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

const STATUS_LABELS = { approved: 'APPROVED', rejected: 'REJECTED', fulfilled: 'FULFILLED', delivered: 'DELIVERED' };

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
  const items = productSummary(inquiry && inquiry.products);
  const text = `Hi ${name},\n\nYour order inquiry (${items}) is now ${label}.\n\n— INVENTRAK`;
  const html = htmlBody({
    title: `Your order inquiry is ${label}`,
    bodyText: `Hi ${esc(name)},<br><br>Your order inquiry <strong>(${esc(items)})</strong> is now <strong>${esc(label)}</strong>.`,
  });

  const emailP = inquiry && inquiry.customer_email
    ? sendEmail({ to: inquiry.customer_email, subject: `Your INVENTRAK order inquiry is ${label}`, text, html })
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
    html: htmlBody({
      title: `Welcome, ${esc(username)}!`,
      bodyText: 'Your INVENTRAK account is ready. Browse supplies, send order inquiries, and track their status right from the app.',
    }),
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
  const html = htmlBody({
    title: 'Verify your account',
    bodyText: `Hi ${esc(username)},<br><br>Enter this code in the app to verify your account. It expires in <strong>${ttlMinutes} minutes</strong>.`,
    code,
  });
  const emailP = email
    ? sendEmail({ to: email, subject: 'Your INVENTRAK verification code', text, html })
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
    html: htmlBody({
      title: 'Reset your password',
      bodyText: `Hi ${esc(username)},<br><br>Use this code to reset your INVENTRAK password. It expires in <strong>${ttlMinutes} minutes</strong>. If you didn't request this, you can safely ignore this email.`,
      code,
    }),
  }).catch((err) => {
    console.error(`[notify] password reset email error: ${err && err.message}`);
  });
}

module.exports = { sendEmail, sendSms, notifyInquiryStatus, notifyWelcome, notifyPasswordReset, notifyVerificationCode, normalizePhNumber, smtpSendMail };
