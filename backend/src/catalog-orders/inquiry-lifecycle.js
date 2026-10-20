// Order-inquiry lifecycle rules — the ONE place both backends agree on them.
//
// There are two implementations of this API: the SQLite/Express route
// (routes/catalog-orders/order-inquiries.js) and the npm-free fallback
// (server_npmfree.js). They keep separate STORAGE code and must keep separate
// storage code. They must NOT keep separate RULES: two copies of a transition
// table is exactly how one backend lets a customer cancel a delivered order
// while the other refuses, and how a rejection ends up with a reason on one
// deployment and not the other. Every decision about whether a status change,
// a rejection or a fulfilment choice is legal lives here.
//
// Storage shape this module assumes (both backends):
//   status_history  JSON array of { status, at, by?, reason? } objects
//   fulfillment_method  'pickup' | 'courier'
//   rejection_reason    TEXT NULL (set when status becomes 'rejected')
//   cancelled_at        ISO timestamp (set by the cancel endpoint)
//   cancellation_reason TEXT NULL

// Fulfilment: how the customer wants to receive the order. A preference, not a
// booking — nothing here talks to a courier API.
const FULFILLMENT_METHODS = ['pickup', 'courier'];
const DEFAULT_FULFILLMENT = 'pickup';

// What an admin may set through PUT /api/order-inquiries/{id}.
// 'cancelled' is deliberately NOT here: cancellation has its own endpoint so
// the timestamp, the reason and the responsible user are always recorded the
// same way, instead of being one more value an admin can type.
const ASSIGNABLE_STATUSES = ['pending', 'approved', 'rejected', 'fulfilled', 'delivered'];

// Legal forward moves. Everything absent from a row is refused.
//   pending   -> approved / rejected / fulfilled / delivered
//   approved  -> fulfilled / delivered / rejected
//   fulfilled -> delivered
// rejected, delivered and cancelled are TERMINAL: nothing leaves them.
const TRANSITIONS = {
  pending: ['approved', 'rejected', 'fulfilled', 'delivered'],
  approved: ['fulfilled', 'delivered', 'rejected'],
  fulfilled: ['delivered'],
  rejected: [],
  delivered: [],
  cancelled: [],
};

// Only these can still be cancelled by the customer. Once the business has
// fulfilled or delivered the order, or already decided it, cancelling is a
// conversation with the business, not a button.
const CANCELLABLE_FROM = ['pending', 'approved'];

const MAX_REASON = 500;

function isFulfillmentMethod(value) {
  return FULFILLMENT_METHODS.includes(value);
}

// Validates + normalizes the fulfilment choice at submission.
// Courier requires a delivery address — a courier order with nowhere to go is
// not an order. Pickup needs none (the branch address is configured server-side
// and surfaced by the app).
function normalizeFulfillment({ fulfillment_method, delivery_address } = {}) {
  const method =
    fulfillment_method === undefined || fulfillment_method === null || fulfillment_method === ''
      ? DEFAULT_FULFILLMENT
      : String(fulfillment_method).trim().toLowerCase();
  if (!isFulfillmentMethod(method)) {
    return { error: `fulfillment_method must be one of ${FULFILLMENT_METHODS.join(', ')}` };
  }
  const address = delivery_address === undefined || delivery_address === null ? '' : String(delivery_address).trim();
  if (method === 'courier' && !address) {
    return { error: 'delivery_address is required when fulfillment_method is courier' };
  }
  return { method, address: address || null };
}

// Trims + bounds a free-text reason. Returns { value } or { error }.
// An empty reason is an error when `required`, otherwise it normalizes to null.
function normalizeReason(raw, { required = false, field = 'reason' } = {}) {
  const value = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!value) {
    return required ? { error: `${field} is required` } : { value: null };
  }
  if (value.length > MAX_REASON) {
    return { error: `${field} must be at most ${MAX_REASON} characters` };
  }
  return { value };
}

function parseHistory(historyJson) {
  if (!historyJson) return [];
  try {
    const parsed = typeof historyJson === 'string' ? JSON.parse(historyJson) : historyJson;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Appends one event, seeding the inquiry's founding status when the row predates
// status tracking (so a timeline never starts with a gap).
//
// A no-op (same status as the last event) appends nothing — repeated admin
// clicks must not pile up duplicate history rows, which is what makes the
// customer's progress card grow.
function appendStatusEvent(historyJson, { status, at, by = null, reason = null, created_at = null, current_status = null }) {
  const history = parseHistory(historyJson);
  if (history.length === 0) {
    const founding = current_status || status;
    history.push({ status: founding, at: created_at || at });
  }
  const last = history[history.length - 1] || {};
  if (last.status === status) return { history, appended: false };
  const event = { status, at };
  if (by !== null && by !== undefined) event.by = by;
  if (reason) event.reason = reason;
  history.push(event);
  return { history, appended: true };
}

// The guard both PUT handlers call. Returns null when the change is allowed, or
// { status, error } describing the refusal.
function checkStatusChange({ from, to }) {
  if (!ASSIGNABLE_STATUSES.includes(to)) {
    return {
      status: 400,
      error: `Invalid status. Must be one of: ${ASSIGNABLE_STATUSES.join(', ')}`,
    };
  }
  if (!from) return null; // legacy row with no status: first move is free
  if (from === to) return null; // idempotent repeat
  const allowed = TRANSITIONS[from];
  if (!allowed) {
    return { status: 400, error: `Unknown current status: ${from}` };
  }
  if (allowed.length === 0) {
    return { status: 409, error: `An inquiry that is already ${from} cannot change status` };
  }
  if (!allowed.includes(to)) {
    return { status: 409, error: `Cannot move an inquiry from ${from} to ${to}` };
  }
  return null;
}

// Cancellation guard for the customer-facing endpoint.
function checkCancellation({ from }) {
  if (from === 'cancelled') {
    return { status: 200, alreadyCancelled: true, error: null };
  }
  if (!CANCELLABLE_FROM.includes(from)) {
    return {
      status: 409,
      error: `Only a pending or approved inquiry can be cancelled — this one is ${from}`,
    };
  }
  return null;
}

module.exports = {
  FULFILLMENT_METHODS,
  DEFAULT_FULFILLMENT,
  ASSIGNABLE_STATUSES,
  CANCELLABLE_FROM,
  TRANSITIONS,
  MAX_REASON,
  isFulfillmentMethod,
  normalizeFulfillment,
  normalizeReason,
  parseHistory,
  appendStatusEvent,
  checkStatusChange,
  checkCancellation,
};
