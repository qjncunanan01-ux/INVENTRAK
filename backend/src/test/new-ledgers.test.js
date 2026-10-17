// Unit conversions, back orders, correction requests and the notification
// ledger -- the four admin ledgers surfaced by the checklist work. Every case
// runs against BOTH backends (SQLite Express + npm-free fallback) so the two
// implementations cannot drift on status codes, RBAC, or validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');
const { setNotificationRecorder } = require('../notify');
const notificationsRouter = require('../routes/system/notifications');
const { recordNotification: npmfreeRecordNotification } = require('../server_npmfree');

// The harness boots BOTH backends in one process, so the notify module's
// recorder hook is shared. Re-register the recorder that belongs to the side
// under test before triggering a notification. In production a single backend
// runs per process, so each backend's own registration wins without this.
function useRecorderFor(label) {
  setNotificationRecorder(label === 'sqlite' ? notificationsRouter.insertNotificationRecord : npmfreeRecordNotification);
}

test.before(async () => {
  await bootBoth();
});
test.after(() => teardown());

const SIDES = [
  ['sqlite', () => sqlite],
  ['npmfree', () => npmfree],
];

test('unit conversions: admin CRUD, validation, and RBAC', async () => {
  for (const [label, get] of SIDES) {
    const side = get();

    // Create (units are normalized to lower-case/trimmed).
    let r = await call(side.url, '/api/unit-conversions', {
      method: 'POST',
      token: side.token.admin,
      body: { from_unit: ' KG ', to_unit: 'g', rate: 1000, note: 'kilo' },
    });
    assert.equal(r.status, 200, `${label} create`);
    assert.equal(r.json.from_unit, 'kg');
    assert.equal(r.json.to_unit, 'g');
    assert.equal(r.json.rate, 1000);
    const id = r.json.id;

    // List.
    r = await call(side.url, '/api/unit-conversions', { token: side.token.admin });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json) && r.json.some((c) => c.id === id), `${label} list`);

    // Upsert the same pair updates the rate in place (no duplicate row).
    r = await call(side.url, '/api/unit-conversions', {
      method: 'POST',
      token: side.token.admin,
      body: { from_unit: 'kg', to_unit: 'g', rate: 1001 },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.rate, 1001);
    assert.equal(r.json.id, id);

    // Identity conversion is refused.
    r = await call(side.url, '/api/unit-conversions', {
      method: 'POST',
      token: side.token.admin,
      body: { from_unit: 'kg', to_unit: 'kg', rate: 1 },
    });
    assert.equal(r.status, 400);

    // Non-positive rate is refused.
    r = await call(side.url, '/api/unit-conversions', {
      method: 'POST',
      token: side.token.admin,
      body: { from_unit: 'a', to_unit: 'b', rate: -1 },
    });
    assert.equal(r.status, 400);

    // Inventory Staff may not read the catalog.
    r = await call(side.url, '/api/unit-conversions', { token: side.token.staff });
    assert.equal(r.status, 403, `${label} staff forbidden`);

    // Delete, then delete again -> 404.
    r = await call(side.url, `/api/unit-conversions/${id}`, { method: 'DELETE', token: side.token.admin });
    assert.equal(r.status, 200);
    r = await call(side.url, `/api/unit-conversions/${id}`, { method: 'DELETE', token: side.token.admin });
    assert.equal(r.status, 404);
  }
});

test('back orders: admin manages them, a customer reads only their own order', async () => {
  for (const [label, get] of SIDES) {
    const side = get();

    // A real order placed by the demo customer. Ownership is proven through the
    // order itself (account id or the email it was placed with), so the test
    // needs the real thing rather than a made-up inquiry id.
    let r = await call(side.url, '/api/order-inquiries', {
      method: 'POST',
      token: side.token.customer,
      body: {
        customer_name: 'Demo Customer',
        customer_email: 'customer@example.com',
        products: [{ name: 'Test item', qty: 1, price: 10 }],
        estimated_cost: 10,
      },
    });
    assert.equal(r.status, 201, `${label} customer places an order`);
    const inquiryId = r.json.id;

    // Admin records the shortfall.
    r = await call(side.url, '/api/back-orders', {
      method: 'POST',
      token: side.token.admin,
      body: { inquiry_id: inquiryId, reason: 'out of stock', requested_by_date: '2026-11-01' },
    });
    assert.equal(r.status, 200, `${label} admin create`);
    assert.equal(r.json.inquiry_id, inquiryId);
    assert.equal(r.json.status, 'open');

    // The customer reads their own order's back-order status...
    r = await call(side.url, `/api/back-orders/${inquiryId}`, { token: side.token.customer });
    assert.equal(r.status, 200, `${label} owner reads by inquiry`);
    assert.equal(r.json.reason, 'out of stock');

    // ...and finds it in the list (which is scoped to their own orders).
    r = await call(side.url, '/api/back-orders', { token: side.token.customer });
    assert.equal(r.status, 200);
    assert.ok(r.json.some((b) => b.inquiry_id === inquiryId), `${label} owner's list contains it`);

    // Someone who does NOT own the inquiry gets a 403, not the reason.
    r = await call(side.url, `/api/back-orders/${inquiryId}`, { token: side.token.staff });
    assert.equal(r.status, 403, `${label} non-owner refused`);
    r = await call(side.url, '/api/back-orders', { token: side.token.staff });
    assert.equal(r.status, 200);
    assert.ok(!r.json.some((b) => b.inquiry_id === inquiryId), `${label} non-owner's list does not leak it`);

    // An unknown inquiry is a 404 for a non-admin, not a 403 or an empty 200.
    r = await call(side.url, '/api/back-orders/999999', { token: side.token.customer });
    assert.equal(r.status, 404, `${label} unknown inquiry`);

    // Unauthenticated is refused, and so is a customer trying to WRITE one.
    r = await call(side.url, '/api/back-orders');
    assert.equal(r.status, 401, `${label} anon forbidden`);
    r = await call(side.url, '/api/back-orders', {
      method: 'POST',
      token: side.token.customer,
      body: { inquiry_id: inquiryId, status: 'cancelled' },
    });
    assert.equal(r.status, 403, `${label} customer may not write`);

    // Upsert advances the status without duplicating the row.
    r = await call(side.url, '/api/back-orders', {
      method: 'POST',
      token: side.token.admin,
      body: { inquiry_id: inquiryId, status: 'fulfilled' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'fulfilled');
    r = await call(side.url, '/api/back-orders', { token: side.token.admin });
    assert.equal(r.json.filter((b) => b.inquiry_id === inquiryId).length, 1, `${label} one row per inquiry`);
  }
});

test('correction requests: create, list, get, resolve; admin only', async () => {
  for (const [label, get] of SIDES) {
    const side = get();

    let r = await call(side.url, '/api/correction-requests', {
      method: 'POST',
      token: side.token.admin,
      body: { submission_id: 77, submission_type: 'adjustment', comment: 'Recount shelf B' },
    });
    assert.equal(r.status, 200, `${label} create`);
    assert.equal(r.json.comment, 'Recount shelf B');
    assert.equal(r.json.status, 'open');
    const id = r.json.id;

    // Filter by submission.
    r = await call(side.url, '/api/correction-requests?submission_id=77', { token: side.token.admin });
    assert.equal(r.status, 200);
    assert.ok(r.json.some((x) => x.id === id), `${label} list by submission`);

    // Single.
    r = await call(side.url, `/api/correction-requests/${id}`, { token: side.token.admin });
    assert.equal(r.status, 200);
    assert.equal(r.json.id, id);

    // Resolve.
    r = await call(side.url, `/api/correction-requests/${id}/resolve`, {
      method: 'POST',
      token: side.token.admin,
      body: { status: 'closed' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'closed');

    // Missing comment is refused.
    r = await call(side.url, '/api/correction-requests', {
      method: 'POST',
      token: side.token.admin,
      body: { submission_id: 9 },
    });
    assert.equal(r.status, 400);

    // Staff may not read corrections.
    r = await call(side.url, '/api/correction-requests', { token: side.token.staff });
    assert.equal(r.status, 403, `${label} staff forbidden`);
  }
});

test('approver reject comment becomes a correction request on the submitter\'s row', async () => {
  for (const [label, get] of SIDES) {
    const side = get();

    // The staff member submits a count.
    let r = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 1, location_id: 1, new_qty: 5, reason: 'tuesday count' },
    });
    assert.equal(r.status, 201, `${label} staff submits`);
    const id = r.json.id;

    // Before any decision the row carries no correction.
    r = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
    let row = r.json.find((x) => x.id === id);
    assert.equal(row.correction_comment, null, `${label} no correction yet`);

    // The approver rejects WITH a comment — the whole point of the feature.
    r = await call(side.url, `/api/stock-adjustments/${id}/reject`, {
      method: 'POST',
      token: side.token.admin,
      body: { comment: 'Recount shelf B — the label was for a different size' },
    });
    assert.equal(r.status, 200, `${label} reject with comment`);
    assert.match(r.json.message, /correction/i, `${label} the response says a correction was sent`);

    // The submitter's own listing — the screen the staff app already polls —
    // now shows the instruction, with no extra permission and no extra call.
    r = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
    row = r.json.find((x) => x.id === id);
    assert.equal(row.status, 'rejected', `${label} rejected`);
    assert.equal(row.correction_comment, 'Recount shelf B — the label was for a different size');
    assert.equal(row.correction_status, 'open');

    // And it is a real correction-request record for the admin ledger.
    r = await call(side.url, `/api/correction-requests?submission_id=${id}`, { token: side.token.admin });
    assert.equal(r.status, 200);
    const created = r.json.find((c) => c.submission_type === 'stock_adjustment');
    assert.ok(created, `${label} correction recorded`);
    assert.equal(created.requested_by, 'admin');

    // Once resolved, the submitter stops seeing an open instruction.
    r = await call(side.url, `/api/correction-requests/${created.id}/resolve`, {
      method: 'POST',
      token: side.token.admin,
      body: { status: 'closed' },
    });
    assert.equal(r.status, 200);
    r = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
    row = r.json.find((x) => x.id === id);
    assert.equal(row.correction_comment, null, `${label} resolved correction is no longer projected`);

    // A silent reject stays silent: no comment, no correction row.
    r = await call(side.url, '/api/stock-adjustments', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 1, location_id: 1, new_qty: 4 },
    });
    const silentId = r.json.id;
    r = await call(side.url, `/api/stock-adjustments/${silentId}/reject`, {
      method: 'POST',
      token: side.token.admin,
      body: {},
    });
    assert.equal(r.status, 200, `${label} silent reject still works`);
    assert.doesNotMatch(r.json.message, /correction/i);
    r = await call(side.url, '/api/stock-adjustments', { token: side.token.staff });
    row = r.json.find((x) => x.id === silentId);
    assert.equal(row.correction_comment, null, `${label} no correction for a silent reject`);

    // Transfers behave identically.
    r = await call(side.url, '/api/stock-transfers', {
      method: 'POST',
      token: side.token.staff,
      body: { product_id: 1, src_location: 1, dst_location: 2, qty: 2, reason: 'rebalance' },
    });
    assert.equal(r.status, 201, `${label} staff submits a transfer`);
    const tid = r.json.id;
    r = await call(side.url, `/api/stock-transfers/${tid}/reject`, {
      method: 'POST',
      token: side.token.admin,
      body: { comment: 'Wrong destination shelf' },
    });
    assert.equal(r.status, 200, `${label} transfer reject with comment`);
    r = await call(side.url, '/api/stock-transfers', { token: side.token.staff });
    const trow = r.json.find((x) => x.id === tid);
    assert.equal(trow.correction_comment, 'Wrong destination shelf');
    assert.equal(trow.correction_status, 'open');
    // The transfer row names whoever proposed it, exactly as a count does.
    // Without this the staff app's "Mine" filter cannot place the row — the
    // correction note would exist but be invisible on the submitter's phone.
    assert.equal(trow.created_by, 'staff', `${label} transfer names its submitter`);
    assert.equal(typeof trow.created_by_id, 'number', `${label} transfer carries the submitter id`);
  }
});

test('notification ledger records real attempts and is admin-only', async () => {
  for (const [label, get] of SIDES) {
    const side = get();

    // Registering sends a verification code; the register route AWAITS the
    // notify call, so the ledger row exists by the time the response returns.
    useRecorderFor(label);
    const username = `notif-${label}-${Date.now()}`;
    const reg = await call(side.url, '/api/auth/register', {
      method: 'POST',
      body: { username, password: 'StrongPass123!', email: `${username}@example.com`, phone: '09171234567' },
    });
    assert.equal(reg.status, 200, `${label} register`);

    let r = await call(side.url, '/api/notifications', { token: side.token.admin });
    assert.equal(r.status, 200, `${label} ledger`);
    assert.ok(Array.isArray(r.json.rows), `${label} rows is an array`);
    const row = r.json.rows.find((x) => x.event === 'verification');
    assert.ok(row, `${label} recorded a verification attempt`);
    assert.equal(row.channel, 'email');

    // Detail endpoint.
    r = await call(side.url, `/api/notifications/${row.id}`, { token: side.token.admin });
    assert.equal(r.status, 200);
    assert.equal(r.json.id, row.id);

    // Staff may not read the admin ledger.
    r = await call(side.url, '/api/notifications', { token: side.token.staff });
    assert.equal(r.status, 403, `${label} staff forbidden`);
  }
});
