// Order-inquiry lifecycle: rejection reasons, customer cancellation and the
// pickup/courier fulfilment preference.
//
// Runs against BOTH backends (SQLite and the npm-free fallback) because they
// share catalog-orders/inquiry-lifecycle but not their storage code — the whole
// point of these tests is that the two implementations agree.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
delete process.env.SYLVER_POLICY_DEMO;
const { sqlite, npmfree, bootBoth, teardown, call, shapeOf } = require('./harness');
const { ORDER_TERMS_VERSION } = require('../catalog-orders/order-terms');

const SIDES = [
  ['sqlite', sqlite],
  ['npmfree', npmfree],
];

before(async () => {
  await bootBoth();
});

after(() => {
  teardown();
});

function historyOf(row) {
  try {
    const parsed = JSON.parse(row.status_history || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Places an inquiry and returns { status, id }. Defaults to the customer's
// account so the inquiry is stamped with its owner.
async function place(side, { tokenKey = 'customer', ...overrides } = {}) {
  const res = await call(side.url, '/api/order-inquiries', {
    method: 'POST',
    token: tokenKey ? side.token[tokenKey] : null,
    body: {
      customer_name: 'Lifecycle Tester',
      customer_email: 'lifecycle@example.com',
      products: [{ name: 'Widget', qty: 2, price: 50 }],
      estimated_cost: 100,
      notes: 'lifecycle test',
      ...overrides,
    },
  });
  return res;
}

async function readInquiry(side, id, { tokenKey = 'admin' } = {}) {
  const res = await call(side.url, '/api/order-inquiries?limit=100', { token: side.token[tokenKey] });
  assert.strictEqual(res.status, 200, 'inquiry list readable');
  const rows = Array.isArray(res.json) ? res.json : res.json.data;
  return rows.find((o) => Number(o.id) === Number(id));
}

test('terms: submissions require acceptance of the current ordering terms', async () => {
  for (const [label, side] of SIDES) {
    const declined = await place(side, { terms_accepted: false });
    assert.strictEqual(declined.status, 400, `${label}: declined terms are refused`);
    assert.match(JSON.stringify(declined.json.details || []), /accept the ordering terms/i);

    const stale = await place(side, { terms_version: `${ORDER_TERMS_VERSION}-old` });
    assert.strictEqual(stale.status, 400, `${label}: an outdated terms version is refused`);
    assert.match(JSON.stringify(stale.json.details || []), /terms_version.*out of date/i);
  }
});

test('fulfilment: pickup is the recorded default on both backends', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    assert.strictEqual(placed.status, 201, `${label}: inquiry submitted`);
    const row = await readInquiry(side, placed.json.id);
    assert.ok(row, `${label}: inquiry readable`);
    assert.strictEqual(row.fulfillment_method, 'pickup', `${label}: pickup is the default`);
    assert.strictEqual(row.rejection_reason, null, `${label}: nothing rejected yet`);
    assert.strictEqual(row.cancelled_at, null, `${label}: nothing cancelled yet`);
    assert.strictEqual(row.cancellation_reason, null, `${label}: nothing cancelled yet`);
  }
});

test('fulfilment: courier is recorded and requires a delivery address', async () => {
  for (const [label, side] of SIDES) {
    const nowhere = await place(side, { fulfillment_method: 'courier' });
    assert.strictEqual(nowhere.status, 400, `${label}: courier without an address is refused`);
    assert.ok(
      JSON.stringify(nowhere.json.details || []).includes('delivery_address'),
      `${label}: the error names the missing address`,
    );

    const placed = await place(side, {
      fulfillment_method: 'courier',
      delivery_address: '12 Mabini St, Quezon City',
    });
    assert.strictEqual(placed.status, 201, `${label}: courier with an address is accepted`);
    const row = await readInquiry(side, placed.json.id);
    assert.strictEqual(row.fulfillment_method, 'courier', `${label}: courier stored`);
    assert.strictEqual(row.delivery_address, '12 Mabini St, Quezon City', `${label}: address stored`);
  }
});

test('fulfilment: an unknown method is refused rather than silently defaulted', async () => {
  for (const [label, side] of SIDES) {
    const res = await place(side, { fulfillment_method: 'drone' });
    assert.strictEqual(res.status, 400, `${label}: unknown method refused`);
  }
});

test('production checkout refuses the no-charge demo card option', async () => {
  for (const [label, side] of SIDES) {
    const response = await place(side, { payment_method: 'card' });
    assert.strictEqual(response.status, 400, `${label}: card demo is unavailable without Sylver demo mode`);
    assert.match(JSON.stringify(response.json.details || []), /payment_method must be one of/i);
  }
});

test('rejection: a reason is mandatory and is stored with the actor', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const id = placed.json.id;

    const bare = await call(side.url, `/api/order-inquiries/${id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'rejected' },
    });
    assert.strictEqual(bare.status, 400, `${label}: rejection without a reason is refused`);
    assert.ok(
      JSON.stringify(bare.json.details || []).includes('rejection_reason'),
      `${label}: the error names the missing reason`,
    );
    // The refusal must not have applied the rejection.
    const untouched = await readInquiry(side, id);
    assert.strictEqual(untouched.status, 'pending', `${label}: refused rejection changed nothing`);

    const reason = 'Out of stock at the supplier until next week.';
    const rejected = await call(side.url, `/api/order-inquiries/${id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'rejected', rejection_reason: reason },
    });
    assert.strictEqual(rejected.status, 200, `${label}: rejection with a reason accepted`);

    const row = await readInquiry(side, id);
    assert.strictEqual(row.status, 'rejected', `${label}: status stored`);
    assert.strictEqual(row.rejection_reason, reason, `${label}: reason stored on the inquiry`);

    const history = historyOf(row);
    const last = history[history.length - 1];
    assert.strictEqual(last.status, 'rejected', `${label}: timeline ends at rejected`);
    assert.strictEqual(last.reason, reason, `${label}: timeline carries the reason`);
    assert.ok(last.by != null, `${label}: timeline records who rejected it`);
    assert.ok(last.at && !Number.isNaN(Date.parse(last.at)), `${label}: timestamp recorded`);
  }
});

test('rejection: a reason that is only whitespace does not count', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const res = await call(side.url, `/api/order-inquiries/${placed.json.id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'rejected', rejection_reason: '    ' },
    });
    assert.strictEqual(res.status, 400, `${label}: whitespace is not a reason`);
  }
});

test('transitions: a decided inquiry cannot be reopened, and cancel is not a PUT status', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const id = placed.json.id;

    await call(side.url, `/api/order-inquiries/${id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'rejected', rejection_reason: 'Not deliverable to that address.' },
    });

    const reopen = await call(side.url, `/api/order-inquiries/${id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'approved' },
    });
    assert.strictEqual(reopen.status, 409, `${label}: rejected is terminal`);

    const viaPut = await call(side.url, `/api/order-inquiries/${id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'cancelled' },
    });
    assert.strictEqual(viaPut.status, 400, `${label}: cancellation is its own endpoint`);
  }
});

test('cancellation: the customer cancels their own pending inquiry, once', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const id = placed.json.id;

    const res = await call(side.url, `/api/order-inquiries/${id}/cancel`, {
      method: 'POST',
      token: side.token.customer,
      body: { cancellation_reason: 'Ordered the wrong pack size.' },
    });
    assert.strictEqual(res.status, 200, `${label}: cancellation accepted`);
    assert.strictEqual(res.json.ok, true, `${label}: ok flag`);
    assert.ok(res.json.cancelled_at && !Number.isNaN(Date.parse(res.json.cancelled_at)), `${label}: timestamp returned`);
    assert.strictEqual(res.json.cancellation_reason, 'Ordered the wrong pack size.', `${label}: reason returned`);

    const row = await readInquiry(side, id);
    assert.strictEqual(row.status, 'cancelled', `${label}: status stored`);
    assert.strictEqual(row.cancellation_reason, 'Ordered the wrong pack size.', `${label}: reason stored`);
    const last = historyOf(row).slice(-1)[0];
    assert.strictEqual(last.status, 'cancelled', `${label}: timeline ends at cancelled`);
    assert.ok(last.by != null, `${label}: timeline records who cancelled`);

    // Idempotent: the same call again returns the ORIGINAL record, unchanged.
    const again = await call(side.url, `/api/order-inquiries/${id}/cancel`, {
      method: 'POST',
      token: side.token.customer,
      body: { cancellation_reason: 'a different reason' },
    });
    assert.strictEqual(again.status, 200, `${label}: repeat is a no-op success`);
    assert.strictEqual(again.json.cancelled_at, res.json.cancelled_at, `${label}: original timestamp kept`);
    assert.strictEqual(
      again.json.cancellation_reason,
      'Ordered the wrong pack size.',
      `${label}: original reason kept`,
    );
    assert.strictEqual(shapeOf(again.json), shapeOf(res.json), `${label}: repeat response shape matches`);
  }
});

test('cancellation: an approved inquiry can still be cancelled', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const id = placed.json.id;
    const approved = await call(side.url, `/api/order-inquiries/${id}`, {
      method: 'PUT',
      token: side.token.admin,
      body: { status: 'approved' },
    });
    assert.strictEqual(approved.status, 200, `${label}: approved first`);
    const res = await call(side.url, `/api/order-inquiries/${id}/cancel`, {
      method: 'POST',
      token: side.token.customer,
    });
    assert.strictEqual(res.status, 200, `${label}: approved inquiry cancellable`);
    assert.strictEqual(res.json.cancellation_reason, null, `${label}: reason optional`);
  }
});

test('cancellation: a fulfilled inquiry cannot be cancelled', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side, {
      products: [{ id: 23, name: 'Essse Cafe Selezione Speciale Coffee Beans 1kg', qty: 1, price: 10 }],
    });
    const id = placed.json.id;
    for (const status of ['approved', 'fulfilled']) {
      const moved = await call(side.url, `/api/order-inquiries/${id}`, {
        method: 'PUT',
        token: side.token.admin,
        body: { status, ...(status === 'fulfilled' ? { location_id: 1 } : {}) },
      });
      assert.strictEqual(moved.status, 200, `${label}: moved to ${status}`);
    }
    const res = await call(side.url, `/api/order-inquiries/${id}/cancel`, {
      method: 'POST',
      token: side.token.customer,
    });
    assert.strictEqual(res.status, 409, `${label}: fulfilled is not cancellable`);
    assert.match(res.json.error, /fulfilled/, `${label}: the refusal says why`);
    const row = await readInquiry(side, id);
    assert.strictEqual(row.status, 'fulfilled', `${label}: status untouched`);
  }
});

test('cancellation: a customer cannot cancel somebody else’s inquiry', async () => {
  for (const [label, side] of SIDES) {
    // Placed with the ADMIN's token: the customer is not the owner.
    const placed = await place(side, { tokenKey: 'admin', customer_email: 'someone-else@example.com' });
    assert.strictEqual(placed.status, 201, `${label}: inquiry placed`);
    const res = await call(side.url, `/api/order-inquiries/${placed.json.id}/cancel`, {
      method: 'POST',
      token: side.token.customer,
    });
    assert.strictEqual(res.status, 403, `${label}: foreign inquiry refused`);
    const row = await readInquiry(side, placed.json.id);
    assert.strictEqual(row.status, 'pending', `${label}: nothing was cancelled`);
  }
});

test('cancellation: anonymous callers and unknown ids are refused', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const anon = await call(side.url, `/api/order-inquiries/${placed.json.id}/cancel`, { method: 'POST' });
    assert.strictEqual(anon.status, 401, `${label}: authentication required`);

    const missing = await call(side.url, '/api/order-inquiries/99999/cancel', {
      method: 'POST',
      token: side.token.admin,
    });
    assert.strictEqual(missing.status, 404, `${label}: unknown inquiry`);
  }
});

test('cancellation: an admin may cancel on the customer’s behalf', async () => {
  for (const [label, side] of SIDES) {
    const placed = await place(side);
    const res = await call(side.url, `/api/order-inquiries/${placed.json.id}/cancel`, {
      method: 'POST',
      token: side.token.admin,
      body: { cancellation_reason: 'Customer phoned in the cancellation.' },
    });
    assert.strictEqual(res.status, 200, `${label}: admin cancellation accepted`);
    const row = await readInquiry(side, placed.json.id);
    assert.strictEqual(row.status, 'cancelled', `${label}: cancelled`);
  }
});
