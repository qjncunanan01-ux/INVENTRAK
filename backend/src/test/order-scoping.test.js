// Per-account order-scoping regression tests. Locks the guarantee that a
// customer can ONLY ever see their own order inquiries (and that admins see
// everything), on BOTH backends, so the isolation can never silently regress.
//
// Covered, deliberately:
//   1. owner-only   — an inquiry placed WITH a token appears only in that
//                     account's history (user_id stamped)
//   2. legacy email — an inquiry placed WITHOUT a token but with the
//                     account's email still shows in that account's history
//                     (pre-ownership orders stay reachable), and a guest
//                     order with a DIFFERENT email never shows
//   3. admin        — admins see every inquiry
//   4. tamper       — a customer cannot mark another account's order paid
//                     (payment 403) nor change its status (admin-only 403),
//                     but CAN mark their own order paid (200)
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { sqlite, npmfree, bootBoth, teardown, call } = require('./harness');

before(async () => {
  await bootBoth();
});
after(() => {
  teardown();
});

// Register a fresh account on a given backend and return { token, id, username, email }.
async function registerAccount(side, tag) {
  const uname = `scope_${tag}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
  const email = `${uname}@example.com`;
  const reg = await call(side.url, '/api/auth/register', {
    method: 'POST',
    body: { username: uname, password: 'ScopePass!123', email, phone: '09171234567' },
  });
  assert.strictEqual(reg.status, 200, `register ${uname}`);
  return { token: reg.json.token, id: reg.json.user.id, username: uname, email };
}

// Place an inquiry; `token` present stamps user_id, absent = legacy guest row.
async function placeInquiry(side, { token, email, name }) {
  const res = await call(side.url, '/api/order-inquiries', {
    method: 'POST',
    token: token || undefined,
    body: {
      customer_name: name || 'Scoped Customer',
      customer_email: email,
      customer_phone: '09171234567',
      products: ['Widget x1'],
      estimated_cost: 100,
      payment_method: 'cod',
    },
  });
  assert.strictEqual(res.status, 201, 'inquiry created');
  return res.json.id;
}

for (const side of [sqlite, npmfree]) {
  const label = side === sqlite ? 'sqlite' : 'npmfree';

  test(`${label}: customer sees ONLY their own inquiries (user_id stamped)`, async () => {
    const alice = await registerAccount(side, 'a');
    const bob = await registerAccount(side, 'b');

    // Alice's inquiry (token → user_id = alice), Bob's inquiry (token → bob).
    const aliceOrder = await placeInquiry(side, { token: alice.token, email: alice.email, name: 'Alice' });
    const bobOrder = await placeInquiry(side, { token: bob.token, email: bob.email, name: 'Bob' });

    // Legacy fallback: a GUEST order with Alice's email (no token) must appear
    // in Alice's history — orders placed before ownership existed stay visible.
    const aliceLegacy = await placeInquiry(side, { email: alice.email, name: 'Alice Guest' });
    // And a guest order with an UNRELATED email must appear for NOBODY.
    const strangerOrder = await placeInquiry(side, { email: 'stranger@nowhere.dev', name: 'Stranger' });

    const aliceList = await call(side.url, '/api/order-inquiries', { token: alice.token });
    assert.strictEqual(aliceList.status, 200);
    const aliceIds = aliceList.json.map((o) => o.id);
    assert.ok(aliceIds.includes(aliceOrder), `${label}: alice sees her own stamped order`);
    assert.ok(aliceIds.includes(aliceLegacy), `${label}: alice sees the legacy guest order carrying her email`);
    assert.ok(!aliceIds.includes(bobOrder), `${label}: alice does NOT see bob's order`);
    assert.ok(!aliceIds.includes(strangerOrder), `${label}: alice does NOT see the unrelated guest order`);

    const bobList = await call(side.url, '/api/order-inquiries', { token: bob.token });
    const bobIds = bobList.json.map((o) => o.id);
    assert.ok(bobIds.includes(bobOrder), `${label}: bob sees his own order`);
    assert.ok(!bobIds.includes(aliceOrder), `${label}: bob does NOT see alice's order`);
    assert.ok(!bobIds.includes(aliceLegacy), `${label}: bob does NOT see alice's legacy order`);
    assert.ok(!bobIds.includes(strangerOrder), `${label}: bob does NOT see the stranger's order`);
  });

  test(`${label}: admin sees ALL inquiries regardless of owner`, async () => {
    const alice = await registerAccount(side, 'admincheck');
    const own = await placeInquiry(side, { token: alice.token, email: alice.email, name: 'Alice2' });
    const legacy = await placeInquiry(side, { email: alice.email, name: 'Alice2 Guest' });
    const stranger = await placeInquiry(side, { email: 'nobody@nowhere.dev', name: 'Nobody' });

    const adminList = await call(side.url, '/api/order-inquiries', { token: side.token.admin });
    assert.strictEqual(adminList.status, 200);
    const adminIds = adminList.json.map((o) => o.id);
    assert.ok(adminIds.includes(own), `${label}: admin sees the owned order`);
    assert.ok(adminIds.includes(legacy), `${label}: admin sees the legacy order`);
    assert.ok(adminIds.includes(stranger), `${label}: admin sees the unrelated guest order`);
  });

  test(`${label}: notifications feed is per-account (listOrderInquiries-backed)`, async () => {
    // The mobile NotificationsScreen calls listOrderInquiries({ limit: 100 })
    // with the session token and flattens each order's status_history into
    // cards (orderId, status, at, name, cost) — so the notification feed is
    // EXACTLY this scoped list. Replicate that derivation to assert that a
    // customer's feed can only ever contain their OWN order events, and that
    // an admin status change surfaces as a card for the owner and nobody else.
    const alice = await registerAccount(side, 'notif_a');
    const bob = await registerAccount(side, 'notif_b');
    const aliceOrder = await placeInquiry(side, { token: alice.token, email: alice.email, name: 'Alice N' });
    const bobOrder = await placeInquiry(side, { token: bob.token, email: bob.email, name: 'Bob N' });
    // Legacy guest order carrying Alice's email — must feed HER notifications.
    const aliceLegacy = await placeInquiry(side, { email: alice.email, name: 'Alice N Guest' });

    // Admin approves Alice's order → her feed gains an "approved" card.
    const approve = await call(side.url, `/api/order-inquiries/${aliceOrder}`, {
      method: 'PUT', token: side.token.admin, body: { status: 'approved' },
    });
    assert.strictEqual(approve.status, 200, `${label}: admin approves alice's order`);

    // The exact call the Notifications screen makes.
    const aliceFeed = await call(side.url, '/api/order-inquiries?limit=100', { token: alice.token });
    const bobFeed = await call(side.url, '/api/order-inquiries?limit=100', { token: bob.token });
    assert.strictEqual(aliceFeed.status, 200);
    assert.strictEqual(bobFeed.status, 200);
    const aliceRows = aliceFeed.json.data || aliceFeed.json;
    const bobRows = bobFeed.json.data || bobFeed.json;

    // Screen derivation: flatten status_history into cards, skipping the
    // initial 'placed' event unless it's all there is.
    const derive = (rows) => {
      const events = [];
      rows.forEach((o) => {
        let history = [];
        try {
          const parsed = JSON.parse(o.status_history || '[]');
          if (Array.isArray(parsed)) history = parsed;
        } catch {}
        if (history.length === 0) history = [{ status: o.status, at: o.created_at }];
        const shown = history.length > 1 ? history.slice(1) : history;
        shown.forEach((e) => events.push({ orderId: o.id, status: e.status, name: o.customer_name }));
      });
      return events;
    };
    const aliceCards = derive(aliceRows);
    const bobCards = derive(bobRows);

    const aliceCardOrders = new Set(aliceCards.map((c) => c.orderId));
    const bobCardOrders = new Set(bobCards.map((c) => c.orderId));

    // Alice's feed: her own order (with the approved card) + her legacy order.
    assert.ok(aliceCardOrders.has(aliceOrder), `${label}: alice feed includes her own order`);
    assert.ok(aliceCardOrders.has(aliceLegacy), `${label}: alice feed includes her legacy order`);
    assert.ok(!aliceCardOrders.has(bobOrder), `${label}: alice feed has NO card for bob's order`);
    assert.ok(
      aliceCards.some((c) => c.orderId === aliceOrder && c.status === 'approved'),
      `${label}: alice feed shows the approved card for her order`
    );

    // Bob's feed: ONLY his own order, and never a card for alice's orders.
    assert.ok(bobCardOrders.has(bobOrder), `${label}: bob feed includes his own order`);
    assert.ok(!bobCardOrders.has(aliceOrder), `${label}: bob feed has NO card for alice's order`);
    assert.ok(!bobCardOrders.has(aliceLegacy), `${label}: bob feed has NO card for alice's legacy order`);
  });

  test(`${label}: customer cannot tamper with another account's order`, async () => {
    const alice = await registerAccount(side, 'tamper_a');
    const bob = await registerAccount(side, 'tamper_b');
    const aliceOrder = await placeInquiry(side, { token: alice.token, email: alice.email, name: 'Alice3' });
    const bobOrder = await placeInquiry(side, { token: bob.token, email: bob.email, name: 'Bob3' });

    // Alice marks HER OWN order paid → 200 (the checkout flow depends on this).
    const ownPay = await call(side.url, `/api/order-inquiries/${aliceOrder}/payment`, {
      method: 'PUT', token: alice.token, body: { payment_status: 'paid' },
    });
    assert.strictEqual(ownPay.status, 200, `${label}: customer can pay their own order`);

    // Alice marks BOB's order paid → 403.
    const crossPay = await call(side.url, `/api/order-inquiries/${bobOrder}/payment`, {
      method: 'PUT', token: alice.token, body: { payment_status: 'paid' },
    });
    assert.strictEqual(crossPay.status, 403, `${label}: customer cannot pay another account's order`);

    // Alice changes BOB's status → 403 (status updates are admin-only).
    const crossStatus = await call(side.url, `/api/order-inquiries/${bobOrder}`, {
      method: 'PUT', token: alice.token, body: { status: 'approved' },
    });
    assert.strictEqual(crossStatus.status, 403, `${label}: customer cannot change another account's status`);

    // Alice cannot change her OWN status either (admin-only).
    const ownStatus = await call(side.url, `/api/order-inquiries/${aliceOrder}`, {
      method: 'PUT', token: alice.token, body: { status: 'approved' },
    });
    assert.strictEqual(ownStatus.status, 403, `${label}: status updates are admin-only even on own order`);

    // Admin CAN change either order's status.
    const adminStatus = await call(side.url, `/api/order-inquiries/${bobOrder}`, {
      method: 'PUT', token: side.token.admin, body: { status: 'approved' },
    });
    assert.strictEqual(adminStatus.status, 200, `${label}: admin can update any order`);
  });
}
