// Admin-side auth-scoping regression.
//
// The backend locks per-account scoping server-side (customer sees own only,
// admin sees all). On the admin side the equivalent guarantee is that every
// dashboard fetch — especially GET /api/order-inquiries — carries the stored
// admin token. Without it the API returns 401 and the dashboard silently
// shows zero inquiries (the exact class of bug the `/api/inquiries` 404 was).
//
// This drives the REAL generated client (not a mocked apiGet) against a
// captured fetch, so it locks the actual token-attachment mechanism: the
// bearer header present with a token, absent without one, and always on the
// correct endpoint.
import { createApiClient } from './api.generated';

const BASE = 'http://localhost:4001';

// Capture what the generated client sends, without hitting the network.
function captureFetch() {
  const calls = [];
  global.fetch = async(url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {} });
    return {
      ok: true,
      status: 200,
      text: async() => '[]',
      json: async() => [],
    };
  };
  return calls;
}

function makeClient(getToken) {
  return createApiClient({ baseUrl: BASE, getToken });
}

describe('admin API auth scoping (real generated client)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  test('order-inquiries fetch carries the stored admin token (Bearer)', async() => {
    const calls = captureFetch();
    const client = makeClient(() => 'admin-token-abc');
    await client.listOrderInquiries();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/order-inquiries`);
    expect(calls[0].headers.Authorization).toBe('Bearer admin-token-abc');
  });

  test('order-inquiries fetch sends NO token when none is stored (would 401 → dashboard zeros)', async() => {
    const calls = captureFetch();
    const client = makeClient(() => null);
    await client.listOrderInquiries();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/order-inquiries`);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  test('the generic apiGet path helper also attaches the token on the same endpoint', async() => {
    const calls = captureFetch();
    const client = makeClient(() => 'admin-token-xyz');
    // DashboardPage calls apiGet('/api/order-inquiries') through this helper.
    await client.apiGet('/api/order-inquiries');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/order-inquiries`);
    expect(calls[0].headers.Authorization).toBe('Bearer admin-token-xyz');
  });

  test('admin status update (PUT) also carries the token — never unauthenticated', async() => {
    const calls = captureFetch();
    const client = makeClient(() => 'admin-token-789');
    await client.updateOrderInquiry({ id: 5 }, { status: 'approved' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/order-inquiries/5`);
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].headers.Authorization).toBe('Bearer admin-token-789');
  });

  test('Scan & Stock (getProductByQr → GET /api/products/qr/:code) carries the admin token', async() => {
    const calls = captureFetch();
    const client = makeClient(() => 'admin-token-scan');
    // ScanStockPage sends the scanned tag payload through this typed endpoint.
    await client.getProductByQr({ code: 'INVENTRAK:PROD:42' });

    expect(calls).toHaveLength(1);
    // The tag payload is URL-encoded into the path parameter.
    expect(calls[0].url).toBe(`${BASE}/api/products/qr/INVENTRAK%3APROD%3A42`);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].headers.Authorization).toBe('Bearer admin-token-scan');
  });

  test('Reports (apiGet /api/reports?days=N) carries the admin token', async() => {
    const calls = captureFetch();
    const client = makeClient(() => 'admin-token-reports');
    // ReportsPage calls apiGet(`/api/reports?days=${d}`) through the helper.
    await client.apiGet('/api/reports?days=14');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/reports?days=14`);
    expect(calls[0].headers.Authorization).toBe('Bearer admin-token-reports');
  });

  test('every admin-only read is authenticated: users, sales, alerts, approvals, exports', async() => {
    const calls = captureFetch();
    const client = makeClient(() => 'admin-token-all');
    // One request per admin-only endpoint used by the dashboard/pages.
    await client.listUsers();
    await client.listSales();
    await client.listAlerts();
    await client.getApprovals();
    await client.exportAnalytics({ type: 'products' }, { format: 'csv' });

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.headers.Authorization).toBe('Bearer admin-token-all');
    }
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/api/users`,
      `${BASE}/api/sales`,
      `${BASE}/api/alerts`,
      `${BASE}/api/approvals`,
      `${BASE}/api/analytics/export/products?format=csv`,
    ]);
  });
});
