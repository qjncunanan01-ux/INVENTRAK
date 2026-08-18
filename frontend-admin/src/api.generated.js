// AUTO-GENERATED from backend/openapi.json — do not edit by hand.
// Regenerate with: cd backend && npm run client:generate
// This module is the single source of truth for how the frontends
// talk to the API: every endpoint below mirrors the OpenAPI contract.

export function createApiClient({ baseUrl = "", getToken = () => null } = {}) {
  async function request(method, pathTemplate, { params, query, body } = {}) {
    let url = `${baseUrl}${pathTemplate}`;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url = url.replace(`{${k}}`, encodeURIComponent(v));
      }
    }
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qs.set(k, v);
      }
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) { /* non-JSON (e.g. CSV export) */ }
    if (!res.ok) {
      const msg = data && typeof data === "object" && (data.error || data.message)
        ? data.error || data.message
        : `Request failed (${res.status})`;
      // Attach status + parsed body so callers can react to specific
      // errors (e.g. a 429 login lockout carrying retryAfterSeconds).
      const err = new Error(msg);
      err.status = res.status;
      err.body = data && typeof data === "object" ? data : null;
      throw err;
    }
    return data;
  }

  // Generic path-based helpers (same signatures the pages already use).
  const apiGet = (path) => request("GET", path);
  const apiPost = (path, body) => request("POST", path, { body });
  const apiPut = (path, body) => request("PUT", path, { body });
  const apiDelete = (path) => request("DELETE", path);

  return {
    apiGet, apiPost, apiPut, apiDelete,
  // POST /api/auth/register — Register a new customer user
  register: (body) => request('POST', '/api/auth/register', { body }),
  // POST /api/auth/verify-email — Redeem the signup verification code to verify the account email
  verifyEmail: (body) => request('POST', '/api/auth/verify-email', { body }),
  // POST /api/auth/resend-verification — Resend the signup verification code (only acts on unverified accounts; never reveals whether the email has an account)
  resendVerification: (body) => request('POST', '/api/auth/resend-verification', { body }),
  // POST /api/auth/login — Log in and receive a JWT token
  login: (body) => request('POST', '/api/auth/login', { body }),
  // POST /api/auth/google — Sign in with a Google ID token (OAuth). Creates or links the customer account by email.
  googleAuth: (body) => request('POST', '/api/auth/google', { body }),
  // GET /api/auth/me — Get the authenticated user's profile
  getMe: (_) => request('GET', '/api/auth/me', {  }),
  // POST /api/auth/forgot-password — Request a password reset code (emailed to the account, if the email exists)
  forgotPassword: (body) => request('POST', '/api/auth/forgot-password', { body }),
  // POST /api/auth/reset-password — Set a new password using a single-use reset code
  resetPassword: (body) => request('POST', '/api/auth/reset-password', { body }),
  // GET /api/products — List products (optionally paginated, searched, filtered)
  listProducts: (params) => request('GET', '/api/products', { query: params }),
  // POST /api/products — Create a product (admin only)
  createProduct: (body) => request('POST', '/api/products', { body }),
  // POST /api/products/bulk-prices — Set prices for many products in one request (admin only) — the price-list CSV import
  bulkUpdatePrices: (body) => request('POST', '/api/products/bulk-prices', { body }),
  // GET /api/products/categories — List distinct product categories
  listCategories: (_) => request('GET', '/api/products/categories', {  }),
  // GET /api/products/{id} — Get a single product
  getProduct: ({ id }) => request('GET', '/api/products/{id}', { params: { id } }),
  // PUT /api/products/{id} — Update a product (admin only)
  updateProduct: ({ id }, body) => request('PUT', '/api/products/{id}', { params: { id }, body }),
  // DELETE /api/products/{id} — Soft-delete a product (admin only)
  deleteProduct: ({ id }) => request('DELETE', '/api/products/{id}', { params: { id } }),
  // GET /api/inventory — Get inventory levels per location
  getInventory: (params) => request('GET', '/api/inventory', { query: params }),
  // GET /api/locations — List locations
  listLocations: (_) => request('GET', '/api/locations', {  }),
  // POST /api/locations — Create a location (admin only)
  createLocation: (body) => request('POST', '/api/locations', { body }),
  // DELETE /api/locations/{id} — Delete a location (admin only)
  deleteLocation: ({ id }) => request('DELETE', '/api/locations/{id}', { params: { id } }),
  // POST /api/stock-movement — Record a stock movement (FIFO-aware)
  createStockMovement: (body) => request('POST', '/api/stock-movement', { body }),
  // GET /api/stock-movements — List stock movements
  listStockMovements: (params) => request('GET', '/api/stock-movements', { query: params }),
  // GET /api/stock-lots — List FIFO stock lots
  listStockLots: (params) => request('GET', '/api/stock-lots', { query: params }),
  // GET /api/stock-adjustments — List stock adjustment requests (admin only)
  listStockAdjustments: (params) => request('GET', '/api/stock-adjustments', { query: params }),
  // POST /api/stock-adjustments — Create a stock adjustment request (admin only) — PENDING until approved
  createStockAdjustment: (body) => request('POST', '/api/stock-adjustments', { body }),
  // POST /api/stock-adjustments/{id}/approve — Approve a pending adjustment and apply it to stock (admin only)
  approveStockAdjustment: ({ id }) => request('POST', '/api/stock-adjustments/{id}/approve', { params: { id } }),
  // POST /api/stock-adjustments/{id}/reject — Reject a pending adjustment (stock unchanged) (admin only)
  rejectStockAdjustment: ({ id }) => request('POST', '/api/stock-adjustments/{id}/reject', { params: { id } }),
  // GET /api/stock-transfers — List stock transfer requests (admin only)
  listStockTransfers: (params) => request('GET', '/api/stock-transfers', { query: params }),
  // POST /api/stock-transfers — Create a stock transfer request (admin only) — PENDING until approved
  createStockTransfer: (body) => request('POST', '/api/stock-transfers', { body }),
  // POST /api/stock-transfers/{id}/approve — Approve a pending transfer and move the stock (admin only)
  approveStockTransfer: ({ id }) => request('POST', '/api/stock-transfers/{id}/approve', { params: { id } }),
  // POST /api/stock-transfers/{id}/reject — Reject a pending transfer (stock unchanged) (admin only)
  rejectStockTransfer: ({ id }) => request('POST', '/api/stock-transfers/{id}/reject', { params: { id } }),
  // GET /api/approvals — Pending stock adjustments and transfers in one approval queue (admin only)
  getApprovals: (_) => request('GET', '/api/approvals', {  }),
  // GET /api/reports — Printable management report: daily sales, stock by location, order status, low stock, movers (admin only)
  getReports: (params) => request('GET', '/api/reports', { query: params }),
  // GET /api/order-inquiries — List order inquiries
  listOrderInquiries: (params) => request('GET', '/api/order-inquiries', { query: params }),
  // POST /api/order-inquiries — Submit an order inquiry
  createOrderInquiry: (body) => request('POST', '/api/order-inquiries', { body }),
  // PUT /api/order-inquiries/{id} — Update inquiry status (pending -> approved -> fulfilled / rejected)
  updateOrderInquiry: ({ id }, body) => request('PUT', '/api/order-inquiries/{id}', { params: { id }, body }),
  // PUT /api/order-inquiries/{id}/payment — Mark an inquiry as paid/unpaid/failed after the GCash step
  updateInquiryPayment: ({ id }, body) => request('PUT', '/api/order-inquiries/{id}/payment', { params: { id }, body }),
  // POST /api/ocr — Scan a product photo: OCR the image and fuzzy-match the catalog
  scanProductPhoto: (body) => request('POST', '/api/ocr', { body }),
  // GET /api/optimization — Bulk optimization metrics for all products
  getOptimizationBulk: (_) => request('GET', '/api/optimization', {  }),
  // GET /api/optimization/abc — ABC classification of products
  getOptimizationAbc: (_) => request('GET', '/api/optimization/abc', {  }),
  // GET /api/optimization/{productId} — EOQ, ROP, safety stock, and turnover for one product
  getOptimization: ({ productId }) => request('GET', '/api/optimization/{productId}', { params: { productId } }),
  // GET /api/analytics/summary — Dashboard summary metrics
  getAnalyticsSummary: (_) => request('GET', '/api/analytics/summary', {  }),
  // GET /api/analytics/export/{type} — Export data as JSON or CSV (admin only)
  exportAnalytics: ({ type }, params) => request('GET', '/api/analytics/export/{type}', { params: { type }, query: params }),
  // GET /api/alerts — List low-stock alerts (admin only)
  listAlerts: (_) => request('GET', '/api/alerts', {  }),
  // PUT /api/alerts/{id}/resolve — Resolve an alert (admin only)
  resolveAlert: ({ id }) => request('PUT', '/api/alerts/{id}/resolve', { params: { id } }),
  // GET /api/sales — List sales transactions (admin only)
  listSales: (params) => request('GET', '/api/sales', { query: params }),
  // POST /api/sales — Record a sale
  createSale: (body) => request('POST', '/api/sales', { body }),
  // GET /api/users — List users (admin only)
  listUsers: (_) => request('GET', '/api/users', {  }),
  // POST /api/admin/promote — Promote a customer account to admin (admin only) — the public register endpoint hardcodes role 'customer', so this is the only way to create admins. Takes effect on the user's NEXT login (the token embeds the role at sign-in)
  promoteUser: (body) => request('POST', '/api/admin/promote', { body }),
  // GET /api/health/integrity — Audit data integrity (duplicate stock rows, negative stock, FIFO lot drift, orphaned movements)
  getIntegrity: (_) => request('GET', '/api/health/integrity', {  }),
  // POST /api/ocr/stock — Admin stock check: OCR a product label and return matches with live per-location stock
  ocrStockCheck: (body) => request('POST', '/api/ocr/stock', { body }),
  // GET /api/auth/google/start — Start Google OAuth relay: redirects the browser to Google consent with the backend callback as redirect_uri.
  googleAuthStart: (params) => request('GET', '/api/auth/google/start', { query: params }),
  // GET /api/auth/google/callback — Google OAuth callback: exchanges the code server-side and deep-links back to the app with a session token.
  googleAuthCallback: (params) => request('GET', '/api/auth/google/callback', { query: params }),
  // POST /api/auth/logout — Log out and revoke the presented session token
  logout: (_) => request('POST', '/api/auth/logout', {  }),
  // POST /api/auth/mfa/setup — Generate a fresh TOTP secret for the admin (not enabled until confirmed)
  mfaSetup: (_) => request('POST', '/api/auth/mfa/setup', {  }),
  // POST /api/auth/mfa/confirm — Confirm a live code to enable MFA for the admin account
  mfaConfirm: (body) => request('POST', '/api/auth/mfa/confirm', { body }),
  // POST /api/auth/mfa/disable — Disable MFA — requires the current authenticator code
  mfaDisable: (body) => request('POST', '/api/auth/mfa/disable', { body }),
  // POST /api/auth/mfa/verify — Complete the second factor: exchange the MFA challenge for a session token
  mfaVerify: (body) => request('POST', '/api/auth/mfa/verify', { body }),
  // POST /api/auth/mfa/recovery-codes — Regenerate one-time recovery codes (invalidates the previous set)
  mfaRecoveryCodes: (_) => request('POST', '/api/auth/mfa/recovery-codes', {  }),
  };
}

export default createApiClient;
