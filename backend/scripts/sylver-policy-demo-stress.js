// System-wide Sylver policy stress test. The demo flag is set BEFORE either
// backend loads, and the shared harness gives both drivers isolated storage.
process.env.SYLVER_POLICY_DEMO = 'true';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sqlite, npmfree, bootBoth, teardown, call } = require('../src/test/harness');

const SIDES = [['sqlite', sqlite], ['npmfree', npmfree]];
const TERMS_VERSION = '2026-10-24-sylver-demo-v3';
const PROOF = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/9WQAAAAASUVORK5CYII=';
let customerSequence = 0;

before(async() => { await bootBoth(); });
after(() => { teardown(); });

function nextCustomer(sideName) {
  customerSequence += 1;
  return { name: `Demo Stress ${customerSequence}`, email: `sylver-stress-${sideName}-${customerSequence}@example.test` };
}

async function send(side, path, { method = 'GET', role = 'admin', body } = {}) {
  return call(side.url, path, { method, token: role ? side.token[role] : null, body });
}

async function createOrder(side, sideName, { qty = 1, method = 'cash', fulfillment = 'pickup', address = null, customerEmail = null } = {}) {
  const customer = nextCustomer(sideName);
  return send(side, '/api/order-inquiries', {
    method: 'POST', role: 'customer',
    body: {
      customer_name: customer.name,
      customer_email: customerEmail || customer.email,
      products: [{ id: 1, name: 'Client supplied label', qty, price: 1 }],
      estimated_cost: 1,
      fulfillment_method: fulfillment,
      ...(address ? { delivery_address: address } : {}),
      payment_method: method,
      terms_accepted: true,
      terms_version: TERMS_VERSION,
    },
  });
}

async function orderById(side, id) {
  const response = await send(side, '/api/order-inquiries?limit=100');
  assert.equal(response.status, 200);
  return response.json.data.find((row) => Number(row.id) === Number(id));
}

async function stockFor(side, productId = 1) {
  const response = await send(side, '/api/inventory');
  assert.equal(response.status, 200);
  const item = response.json.items.find((row) => Number(row.product?.id) === productId);
  return Number(item?.total || 0);
}

async function setStatus(side, id, status, extras = {}) {
  return send(side, `/api/order-inquiries/${id}`, { method: 'PUT', body: { status, ...extras } });
}

async function submitProof(side, id, method, amount) {
  const date = new Date().toISOString().slice(0, 10);
  return send(side, `/api/order-inquiries/${id}/payment`, {
    method: 'PUT', role: 'customer',
    body: { customer_reference: `${method.toUpperCase()}-${Date.now()}-${customerSequence}`, amount, payment_date: date, proof_data: PROOF },
  });
}

test('demo policy, catalog pricing and bulk discount are enforced by both servers', async() => {
  for (const [label, side] of SIDES) {
    const policy = await send(side, '/api/order-inquiries/policy');
    assert.equal(policy.status, 200, `${label}: policy endpoint works`);
    assert.equal(policy.json.demo_company_rules, true, `${label}: demo flag is active only in this isolated test process`);
    assert.equal(policy.json.discount_threshold, 5000);
    assert.equal(policy.json.discount_rate, 0.03);

    const order = await createOrder(side, label, { qty: 5, method: 'cash' });
    assert.equal(order.status, 201, `${label}: ordinary minimum quantity is accepted`);
    assert.equal(order.json.estimated_cost, 5189.5, `${label}: server price and 3% syrup/sauce discount are authoritative`);
    assert.equal(order.json.bulk_discount_amount, 160.5);
    const row = await orderById(side, order.json.id);
    assert.equal(Number(row.bulk_discount_eligible_subtotal), 5350);
    assert.equal(JSON.parse(row.products)[0].name, 'Da Vinci Butterscotch Sauce (2L)');

    const tooManyForStock = await createOrder(side, label, { qty: 10000, method: 'cash' });
    assert.equal(tooManyForStock.status, 409, `${label}: large requests are bounded by current stock, not an arbitrary 10,000-unit rule`);
  }
});

test('card payment is a no-charge demo transaction in both backends', async() => {
  for (const [label, side] of SIDES) {
    const courierCard = await createOrder(side, label, { qty: 1, method: 'card', fulfillment: 'courier', address: '1 Example Road' });
    assert.equal(courierCard.status, 400, `${label}: the simulated card method cannot bypass the courier quote and payment gate`);

    const created = await createOrder(side, label, { qty: 1, method: 'card' });
    assert.equal(created.status, 201, `${label}: demo card order can be created`);
    assert.equal(created.json.payment.payment_method, 'card');
    assert.equal(created.json.payment.payment_provider, 'demo_card', `${label}: payment is explicitly identified as a simulator`);
    assert.match(created.json.payment.payment_reference, /^CARD-DEMO-/);
    assert.equal(created.json.payment.payment_status, 'unpaid', `${label}: card remains unpaid until the customer completes the demo step`);

    const premature = await send(side, `/api/order-inquiries/${created.json.id}/payment`, {
      method: 'PUT', role: 'customer', body: { demo_card_confirmed: true },
    });
    assert.equal(premature.status, 409, `${label}: payment waits until staff confirms the order`);
    assert.equal((await setStatus(side, created.json.id, 'approved')).status, 200);

    const completed = await send(side, `/api/order-inquiries/${created.json.id}/payment`, {
      method: 'PUT', role: 'customer', body: { demo_card_confirmed: true },
    });
    assert.equal(completed.status, 200, `${label}: demo button completes the simulated transaction`);
    assert.equal(completed.json.payment_status, 'paid');
    const row = await orderById(side, created.json.id);
    assert.equal(row.payment_customer_reference, created.json.payment.payment_reference);
    assert.equal(row.payment_status, 'paid');
    assert.equal(Number(row.amount_paid), Number(row.estimated_cost), `${label}: demo transaction records the order amount without card data`);
    assert.equal(JSON.parse(row.payment_records)[0].status, 'recorded_demo_only');
  }
});

test('courier quote, split receipt verification, dispatch gate and 24-hour return review work end to end', async() => {
  for (const [label, side] of SIDES) {
    const created = await createOrder(side, label, { qty: 1, method: 'gcash', fulfillment: 'courier', address: '23 Example Street, Marikina' });
    assert.equal(created.status, 201, `${label}: courier inquiry submitted`);
    const id = created.json.id;

    const tooEarly = await submitProof(side, id, 'gcash', 100);
    assert.equal(tooEarly.status, 409, `${label}: payment cannot precede staff confirmation`);
    const approved = await setStatus(side, id, 'approved', { delivery_fee: 125, delivery_schedule: 'Saturday, 10 AM–12 PM' });
    assert.equal(approved.status, 200, `${label}: courier fee and schedule can be quoted`);
    assert.equal((await submitProof(side, id, 'gcash', 500)).status, 409, `${label}: a partial deposit is blocked until staff authorizes split payment`);
    const allowSplit = await send(side, `/api/order-inquiries/${id}/payment`, { method: 'PUT', body: { allow_partial: true } });
    assert.equal(allowSplit.status, 200, `${label}: staff authorizes a deposit or split payment`);
    const first = await submitProof(side, id, 'gcash', 500);
    assert.equal(first.status, 200, `${label}: partial receipt submitted`);
    const list = await send(side, '/api/order-inquiries?limit=100');
    const listed = list.json.data.find((row) => Number(row.id) === Number(id));
    assert.ok(!JSON.stringify(listed.payment_records).includes(PROOF.split(',')[1]), `${label}: private image data is omitted from list responses`);
    const proof = await send(side, `/api/order-inquiries/${id}/payment-proof?record_id=${first.json.payment_record_id}`);
    assert.equal(proof.status, 200, `${label}: owner/admin can read proof through scoped endpoint`);
    assert.equal(proof.json.proof_data, PROOF);
    const partial = await send(side, `/api/order-inquiries/${id}/payment`, { method: 'PUT', body: { payment_status: 'paid', payment_record_id: first.json.payment_record_id } });
    assert.equal(partial.status, 200);
    assert.equal(partial.json.payment_status, 'partial', `${label}: payment can be split`);

    const second = await submitProof(side, id, 'gcash', 695);
    assert.equal(second.status, 200, `${label}: outstanding amount may be paid in a second part`);
    const paid = await send(side, `/api/order-inquiries/${id}/payment`, { method: 'PUT', body: { payment_status: 'paid', payment_record_id: second.json.payment_record_id } });
    assert.equal(paid.status, 200);
    assert.equal(paid.json.payment_status, 'paid');
    assert.equal(Number(paid.json.amount_paid), 1195, `${label}: full amount includes quoted courier fee`);

    assert.equal((await setStatus(side, id, 'preparing')).status, 200);
    assert.equal((await setStatus(side, id, 'fulfilled')).status, 200, `${label}: paid courier order may dispatch`);
    assert.equal((await setStatus(side, id, 'delivered')).status, 200);
    const deliveredOrder = await orderById(side, id);
    assert.ok(deliveredOrder.sale_committed_at, `${label}: sale commits once on delivery`);

    const returnRequest = await send(side, `/api/order-inquiries/${id}/return-requests`, {
      method: 'POST', role: 'customer', body: { reason: 'damaged', message: 'Bottle arrived damaged', proof_data: PROOF },
    });
    assert.equal(returnRequest.status, 201, `${label}: return reported inside 24 hours`);
    const returnProof = await send(side, `/api/order-inquiries/${id}/return-proof?request_id=${returnRequest.json.return_request.id}`);
    assert.equal(returnProof.status, 200);
    assert.equal(returnProof.json.proof_data, PROOF);
    const refund = await send(side, `/api/order-inquiries/${id}/return-requests/${returnRequest.json.return_request.id}`, {
      method: 'PUT', body: { decision: 'approved', refund_amount: 100, refund_method: 'bank_transfer' },
    });
    assert.equal(refund.status, 200);
    assert.equal(refund.json.return_request.refund_status, 'recorded_demo_only', `${label}: demo records refunds without transferring money`);
  }
});

test('deposits and existing-customer credit require staff approval and cannot be claimed through another email', async() => {
  for (const [label, side] of SIDES) {
    const priorOrder = await createOrder(side, label, { qty: 1, method: 'cash', customerEmail: 'customer@example.com' });
    assert.equal(priorOrder.status, 201, `${label}: customer creates a prior record on the authenticated account`);
    const policy = await send(side, '/api/order-inquiries/policy', { role: 'customer' });
    assert.equal(policy.json.credit_eligible, true, `${label}: a matching pre-existing customer record unlocks a request, not approval (policy=${JSON.stringify(policy.json)}, prior=${JSON.stringify(priorOrder.json)})`);

    const impersonated = await createOrder(side, label, { method: 'credit' });
    assert.equal(impersonated.status, 400, `${label}: an unrelated email cannot claim credit`);
    const courierCredit = await createOrder(side, label, { method: 'credit', fulfillment: 'courier', address: '1 Example Road', customerEmail: 'customer@example.com' });
    assert.equal(courierCredit.status, 400, `${label}: courier still requires payment before dispatch`);

    const credit = await createOrder(side, label, { method: 'credit', customerEmail: 'customer@example.com' });
    assert.equal(credit.status, 201, `${label}: eligible existing customer may request credit`);
    assert.equal((await send(side, `/api/order-inquiries/${credit.json.id}/payment`, { method: 'PUT', body: { payment_status: 'credit_approved' } })).status, 409, `${label}: staff cannot approve credit before order confirmation`);
    assert.equal((await setStatus(side, credit.json.id, 'approved')).status, 200);
    const creditApproval = await send(side, `/api/order-inquiries/${credit.json.id}/payment`, { method: 'PUT', body: { payment_status: 'credit_approved' } });
    assert.equal(creditApproval.status, 200, `${label}: staff approves the existing arrangement per order`);
    assert.equal((await setStatus(side, credit.json.id, 'preparing')).status, 200);
    assert.equal((await setStatus(side, credit.json.id, 'fulfilled')).status, 200);
    assert.equal((await setStatus(side, credit.json.id, 'delivered')).status, 200, `${label}: an approved pickup credit arrangement can complete without falsely recording a cash payment`);

    const cash = await createOrder(side, label, { qty: 1, method: 'cash' });
    assert.equal(cash.status, 201);
    assert.equal((await setStatus(side, cash.json.id, 'approved')).status, 200);
    assert.equal((await send(side, `/api/order-inquiries/${cash.json.id}/payment`, { method: 'PUT', body: { payment_status: 'paid', amount: 100 } })).status, 409, `${label}: cash deposit is refused before authorization`);
    assert.equal((await send(side, `/api/order-inquiries/${cash.json.id}/payment`, { method: 'PUT', body: { allow_partial: true } })).status, 200);
    const part = await send(side, `/api/order-inquiries/${cash.json.id}/payment`, { method: 'PUT', body: { payment_status: 'paid', amount: 100 } });
    assert.equal(part.status, 200);
    assert.equal(part.json.payment_status, 'partial');
    const balance = await send(side, `/api/order-inquiries/${cash.json.id}/payment`, { method: 'PUT', body: { payment_status: 'paid' } });
    assert.equal(balance.status, 200);
    assert.equal(balance.json.payment_status, 'paid');
  }
});

test('change requests, cash pickup, cancellation release, and concurrent stock reservations stay consistent', async() => {
  for (const [label, side] of SIDES) {
    const changing = await createOrder(side, label, { qty: 1, method: 'cash' });
    assert.equal(changing.status, 201);
    const change = await send(side, `/api/order-inquiries/${changing.json.id}/change-request`, { method: 'POST', role: 'customer', body: { message: 'Please change pickup time to 2 PM.' } });
    assert.equal(change.status, 201);
    const changeDecision = await send(side, `/api/order-inquiries/${changing.json.id}/change-request`, { method: 'PUT', body: { decision: 'accepted' } });
    assert.equal(changeDecision.status, 200);
    assert.equal(changeDecision.json.change_request.status, 'accepted');

    const cancelable = await createOrder(side, label, { qty: 1, method: 'cash' });
    assert.equal(cancelable.status, 201);
    const before = await stockFor(side);
    assert.equal((await setStatus(side, cancelable.json.id, 'approved')).status, 200);
    const reserved = await stockFor(side);
    assert.equal(reserved, before - 1, `${label}: confirmation reserves one unit`);
    const cancelled = await send(side, `/api/order-inquiries/${cancelable.json.id}/cancel`, { method: 'POST', role: 'customer', body: { reason: 'Changed my plan' } });
    assert.equal(cancelled.status, 200);
    assert.equal(await stockFor(side), before, `${label}: cancellation restores the exact reservation`);

    const cash = await createOrder(side, label, { qty: 1, method: 'cash' });
    assert.equal(cash.status, 201);
    assert.equal((await setStatus(side, cash.json.id, 'approved')).status, 200);
    assert.equal((await setStatus(side, cash.json.id, 'preparing')).status, 200);
    assert.equal((await setStatus(side, cash.json.id, 'fulfilled')).status, 200, `${label}: cash order can be marked ready for pickup`);
    const paidCash = await send(side, `/api/order-inquiries/${cash.json.id}/payment`, { method: 'PUT', body: { payment_status: 'paid' } });
    assert.equal(paidCash.status, 200, `${label}: admin records cash collected at pickup`);
    assert.equal((await setStatus(side, cash.json.id, 'delivered')).status, 200, `${label}: collected and paid pickup can close`);

    const stockAtStart = await stockFor(side);
    const created = await Promise.all(Array.from({ length: 40 }, () => createOrder(side, label, { qty: 10, method: 'cash' })));
    assert.equal(created.filter((result) => result.status === 201).length, 40, `${label}: all pending requests fit the stock currently on hand individually`);
    const decisions = await Promise.all(created.map((result) => setStatus(side, result.json.id, 'approved')));
    const reservedCount = decisions.filter((result) => result.status === 200).length;
    const refusedCount = decisions.filter((result) => result.status === 409).length;
    assert.ok(reservedCount > 0 && refusedCount > 0, `${label}: competing confirmations serialize; some reserve and the remainder are refused`);
    assert.equal(reservedCount + refusedCount, 40);
    assert.equal(await stockFor(side), stockAtStart - reservedCount * 10, `${label}: no oversell under concurrent confirmation`);

    const reads = await Promise.all(Array.from({ length: 100 }, (_, index) => send(side, index % 2 ? '/api/order-inquiries/policy' : '/api/order-inquiries?limit=10')));
    assert.ok(reads.every((result) => result.status === 200), `${label}: 100 parallel policy/order reads remain available after stock contention`);
  }
});
