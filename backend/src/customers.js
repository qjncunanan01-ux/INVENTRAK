// Customer Records — the entity behind every order and sale.
//
// WHY A SEPARATE TABLE
// `users` holds ACCOUNTS: a login, a role, a password. A customer does not need
// one — guest checkout is a first-class path (an inquiry submitted without a
// token has user_id = NULL). Every other customer attribute was smeared across
// order_inquiries (name/email/phone, once per order) and sales_transactions
// (customer_name, free text). That makes "this customer's history" unanswerable:
// two orders from the same person, typed slightly differently, look like two
// unrelated people.
//
// IDENTITY RULE (resolve-or-create), in strict priority order:
//   1. user_id  — an authenticated account is unambiguous, so it wins outright.
//   2. email    — matched case-insensitively. The most stable identifier a
//                 walk-in café customer will give.
//   3. name     — matched case-insensitively on the trimmed name. Weak on its
//                 own (two people can share a name), but it is the only signal
//                 a sale recorded at the counter has.
//   4. nothing  — no usable identity, so no customer row. A sale with no name
//                 and no email is genuinely unattributable and inventing a row
//                 for it would corrupt every customer aggregate.
//
// These are pure functions over a plain array so BOTH backends resolve identity
// identically — the npm-free backend keeps customers in memory and the cloud
// store under '@customers', so a row created in one is reused in the other.
const { isValidEmail } = require('./sanitize');

const normEmail = (e) => String(e || '').trim().toLowerCase();
const normName = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
};

// Find the customer these fields refer to, or null when there is no usable
// identity. Never creates — resolveCustomer() does that.
function findCustomer(customers, { user_id, email, name } = {}) {
  const list = Array.isArray(customers) ? customers : [];

  if (user_id != null && user_id !== '') {
    const uid = Number(user_id);
    if (Number.isFinite(uid)) {
      const byUser = list.find((c) => c && Number(c.user_id) === uid);
      if (byUser) return byUser;
    }
  }

  const e = normEmail(email);
  if (e) {
    const byEmail = list.find((c) => c && normEmail(c.email) === e);
    if (byEmail) return byEmail;
  }

  const n = normName(name);
  if (n) {
    const byName = list.find((c) => c && normName(c.name) === n);
    if (byName) return byName;
  }

  return null;
}

// Resolve to a customer, creating one only when identity is unambiguous.
// Returns { customer, created } or { customer: null, created: false }.
//
// Existing rows are ENRICHED, never overwritten: a second order that supplies a
// phone or an address fills in what the first one left blank. A field already on
// record is left alone, because the earliest recorded value is the one the
// business actually took down.
function resolveCustomer(customers, fields = {}) {
  const list = Array.isArray(customers) ? customers : [];
  const email = clean(fields.email);
  const name = clean(fields.name) || clean(fields.customer_name);
  const phone = clean(fields.contact_number) || clean(fields.phone) || clean(fields.customer_phone);
  const businessName = clean(fields.business_name);
  const address = clean(fields.address) || clean(fields.delivery_address);
  const userId =
    fields.user_id === undefined || fields.user_id === null || fields.user_id === ''
      ? null
      : Number(fields.user_id);
  const now = fields.now || new Date().toISOString();

  const existing = findCustomer(list, { user_id: userId, email, name });

  if (existing) {
    let changed = false;
    if (!existing.email && email) { existing.email = email; changed = true; }
    if (!existing.contact_number && phone) { existing.contact_number = phone; changed = true; }
    if (!existing.business_name && businessName) { existing.business_name = businessName; changed = true; }
    if (!existing.address && address) { existing.address = address; changed = true; }
    // An anonymous guest order can later turn out to be a signed-in account.
    if (existing.user_id == null && userId != null && Number.isFinite(userId)) {
      existing.user_id = userId;
      changed = true;
    }
    if (changed) existing.updated_at = now;
    return { customer: existing, created: false, changed };
  }

  // No identity at all: refuse rather than invent a customer row.
  if (!name && !email) return { customer: null, created: false, changed: false };

  const customer = {
    name: name || (email ? email.split('@')[0] : null),
    business_name: businessName,
    contact_number: phone,
    email: email && isValidEmail(email) ? email : null,
    address,
    user_id: Number.isFinite(userId) ? userId : null,
    created_at: now,
    updated_at: now,
  };
  list.push(customer);
  return { customer, created: true, changed: true };
}

// Per-customer aggregates for the admin list view. Computed in JS so both
// backends return an identical shape regardless of storage driver.
function summarize(customers, { inquiries = [], sales = [] } = {}) {
  const byCustomer = new Map();
  for (const c of Array.isArray(customers) ? customers : []) {
    if (c && c.id != null) byCustomer.set(Number(c.id), { inquiries: 0, spend: 0, lastActivity: null });
  }
  for (const o of Array.isArray(inquiries) ? inquiries : []) {
    const cid = Number(o && o.customer_id);
    const agg = byCustomer.get(cid);
    if (!agg) continue;
    agg.inquiries += 1;
    const at = o.created_at || null;
    if (at && (!agg.lastActivity || at > agg.lastActivity)) agg.lastActivity = at;
  }
  for (const s of Array.isArray(sales) ? sales : []) {
    const cid = Number(s && s.customer_id);
    const agg = byCustomer.get(cid);
    if (!agg) continue;
    agg.spend += Number(s.total_amount) || 0;
    const at = s.transaction_date || null;
    if (at && (!agg.lastActivity || at > agg.lastActivity)) agg.lastActivity = at;
  }
  return (Array.isArray(customers) ? customers : []).map((c) => {
    const agg = byCustomer.get(Number(c && c.id)) || { inquiries: 0, spend: 0, lastActivity: null };
    return {
      ...c,
      inquiry_count: agg.inquiries,
      total_spend: Math.round(agg.spend * 100) / 100,
      last_activity: agg.lastActivity,
    };
  });
}

module.exports = { findCustomer, resolveCustomer, summarize, normEmail, normName };