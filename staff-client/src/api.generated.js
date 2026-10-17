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
  // POST /api/admin/promote — Promote a customer account to admin (admin only) â€” the public register endpoint hardcodes role 'customer', so this is the only way to create admins. Takes effect on the user's NEXT login (the token embeds the role at sign-in)
  promoteUser: (body) => request('POST', '/api/admin/promote', { body }),
  // GET /api/admin/backup — Export a full database snapshot (admin only)
  exportBackup: (_) => request('GET', '/api/admin/backup', {  }),
  // POST /api/admin/backup — Take a snapshot now and store it in the durable store (admin only)
  pushBackup: (_) => request('POST', '/api/admin/backup', {  }),
  // GET /api/admin/backups — Snapshots held by the durable store, newest first (admin only)
  listStoredBackups: (_) => request('GET', '/api/admin/backups', {  }),
  // POST /api/admin/restore — Restore the database from a snapshot (admin only)
  restoreBackup: (body) => request('POST', '/api/admin/restore', { body }),
  // GET /api/alerts — List low-stock alerts (admin only)
  listAlerts: (_) => request('GET', '/api/alerts', {  }),
  // PUT /api/alerts/{id}/resolve — Resolve an alert (admin only)
  resolveAlert: ({ id }) => request('PUT', '/api/alerts/{id}/resolve', { params: { id } }),
  // GET /api/analytics/export/{type} — Export data as JSON or CSV (admin only)
  exportAnalytics: ({ type }, params) => request('GET', '/api/analytics/export/{type}', { params: { type }, query: params }),
  // GET /api/analytics/summary — Dashboard summary metrics (admin tier â€” contains revenue)
  getAnalyticsSummary: (_) => request('GET', '/api/analytics/summary', {  }),
  // GET /api/approvals — Pending stock adjustments and transfers in one approval queue (admin only)
  getApprovals: (_) => request('GET', '/api/approvals', {  }),
  // GET /api/audit-trail — Security audit log entries (admin only) â€” newest first
  listAuditTrail: (params) => request('GET', '/api/audit-trail', { query: params }),
  // POST /api/auth/forgot-password — Request a password reset code (emailed to the account, if the email exists)
  forgotPassword: (body) => request('POST', '/api/auth/forgot-password', { body }),
  // POST /api/auth/google — Sign in with a Google ID token (OAuth). Creates or links the customer account by email.
  googleAuth: (body) => request('POST', '/api/auth/google', { body }),
  // GET /api/auth/google/callback — Google OAuth callback: exchanges the code server-side and deep-links back to the app with a session token.
  googleAuthCallback: (params) => request('GET', '/api/auth/google/callback', { query: params }),
  // GET /api/auth/google/start — Start Google OAuth relay: redirects the browser to Google consent with the backend callback as redirect_uri.
  googleAuthStart: (params) => request('GET', '/api/auth/google/start', { query: params }),
  // POST /api/auth/login — Log in and receive a JWT token
  login: (body) => request('POST', '/api/auth/login', { body }),
  // POST /api/auth/logout — Log out and revoke the presented session token
  logout: (_) => request('POST', '/api/auth/logout', {  }),
  // GET /api/auth/me — Get the authenticated user's profile
  getMe: (_) => request('GET', '/api/auth/me', {  }),
  // POST /api/auth/mfa/confirm — Confirm a live code to enable MFA for the admin account
  mfaConfirm: (body) => request('POST', '/api/auth/mfa/confirm', { body }),
  // POST /api/auth/mfa/disable — Disable MFA â€” requires the current authenticator code
  mfaDisable: (body) => request('POST', '/api/auth/mfa/disable', { body }),
  // POST /api/auth/mfa/recovery-codes — Regenerate one-time recovery codes (invalidates the previous set)
  mfaRecoveryCodes: (_) => request('POST', '/api/auth/mfa/recovery-codes', {  }),
  // POST /api/auth/mfa/setup — Generate a fresh TOTP secret for the admin (not enabled until confirmed)
  mfaSetup: (_) => request('POST', '/api/auth/mfa/setup', {  }),
  // POST /api/auth/mfa/verify — Complete the second factor: exchange the MFA challenge for a session token
  mfaVerify: (body) => request('POST', '/api/auth/mfa/verify', { body }),
  // POST /api/auth/register — Register a new customer user
  register: (body) => request('POST', '/api/auth/register', { body }),
  // POST /api/auth/resend-verification — Resend the signup verification code (only acts on unverified accounts; never reveals whether the email has an account)
  resendVerification: (body) => request('POST', '/api/auth/resend-verification', { body }),
  // POST /api/auth/reset-password — Set a new password using a single-use reset code
  resetPassword: (body) => request('POST', '/api/auth/reset-password', { body }),
  // POST /api/auth/verify-email — Redeem the signup verification code to verify the account email
  verifyEmail: (body) => request('POST', '/api/auth/verify-email', { body }),
  // GET /api/back-orders — List back orders (scoped to your own orders unless admin)
  listBackOrders: (_) => request('GET', '/api/back-orders', {  }),
  // POST /api/back-orders — Create or update a back order (admin only)
  upsertBackOrder: (body) => request('POST', '/api/back-orders', { body }),
  // GET /api/back-orders/{id} — Get a back order by inquiry id
  getBackOrder: ({ id }) => request('GET', '/api/back-orders/{id}', { params: { id } }),
  // GET /api/cache/stats — In-memory cache statistics (admin only)
  getCacheStats: (_) => request('GET', '/api/cache/stats', {  }),
  // GET /api/correction-requests — List correction requests (admin only)
  listCorrectionRequests: (params) => request('GET', '/api/correction-requests', { query: params }),
  // POST /api/correction-requests — Record a reject comment / correction request (admin only)
  createCorrectionRequest: (body) => request('POST', '/api/correction-requests', { body }),
  // GET /api/correction-requests/{id} — Single correction request (admin only)
  getCorrectionRequest: ({ id }) => request('GET', '/api/correction-requests/{id}', { params: { id } }),
  // POST /api/correction-requests/{id}/resolve — Mark a correction request as addressed (admin only)
  resolveCorrectionRequest: ({ id }, body) => request('POST', '/api/correction-requests/{id}/resolve', { params: { id }, body }),
  // GET /api/customers — Customer Records with per-customer aggregates (admin only)
  listCustomers: (_) => request('GET', '/api/customers', {  }),
  // GET /api/customers/{id} — One customer's record with their order and purchase history (admin only)
  getCustomer: ({ id }) => request('GET', '/api/customers/{id}', { params: { id } }),
  // PUT /api/customers/{id} — Edit a Customer Record (admin only)
  updateCustomer: ({ id }, body) => request('PUT', '/api/customers/{id}', { params: { id }, body }),
  // GET /api/health — Public liveness probe â€” returns 200 with service status and active driver
  getHealth: (_) => request('GET', '/api/health', {  }),
  // GET /api/health/integrity — Audit data integrity (duplicate stock rows, negative stock, FIFO lot drift, orphaned movements)
  getIntegrity: (_) => request('GET', '/api/health/integrity', {  }),
  // GET /api/inventory — Get inventory levels per location
  getInventory: (params) => request('GET', '/api/inventory', { query: params }),
  // POST /api/inventory/count — Record a stocktake count (staff or admin)
  recordInventoryCount: (body) => request('POST', '/api/inventory/count', { body }),
  // POST /api/inventory/counts — Record a shelf walk in one request (staff tier)
  createShelfCounts: (body) => request('POST', '/api/inventory/counts', { body }),
  // GET /api/inventory/reconciliation — Shelf-vs-system reconciliation: shrinkage and unrecorded sales (admin only)
  getInventoryReconciliation: (params) => request('GET', '/api/inventory/reconciliation', { query: params }),
  // GET /api/inventory/shelf-stocktake/{id} — One shelf with every line on it, ready to be walked (staff tier)
  getShelfStocktake: ({ id }) => request('GET', '/api/inventory/shelf-stocktake/{id}', { params: { id } }),
  // GET /api/locations — List locations
  listLocations: (_) => request('GET', '/api/locations', {  }),
  // POST /api/locations — Create a location (admin only)
  createLocation: (body) => request('POST', '/api/locations', { body }),
  // DELETE /api/locations/{id} — Delete a location (admin only)
  deleteLocation: ({ id }) => request('DELETE', '/api/locations/{id}', { params: { id } }),
  // GET /api/meta — Public build identity â€” name, package version, deployed git commit, storage driver, process start time
  getMeta: (_) => request('GET', '/api/meta', {  }),
  // GET /api/notifications — Paginated notification records (admin only)
  listNotifications: (params) => request('GET', '/api/notifications', { query: params }),
  // GET /api/notifications/{id} — Single notification record (admin only)
  getNotification: ({ id }) => request('GET', '/api/notifications/{id}', { params: { id } }),
  // GET /api/optimization — Bulk optimization metrics for all products
  getOptimizationBulk: (_) => request('GET', '/api/optimization', {  }),
  // GET /api/optimization/{productId} — EOQ, ROP, safety stock, and turnover for one product
  getOptimization: ({ productId }) => request('GET', '/api/optimization/{productId}', { params: { productId } }),
  // GET /api/optimization/abc — ABC classification of products
  getOptimizationAbc: (_) => request('GET', '/api/optimization/abc', {  }),
  // GET /api/optimization/fsn — FSN (Fast/Slow/Non-moving) classification of products by movement frequency and recency
  getOptimizationFsn: (params) => request('GET', '/api/optimization/fsn', { query: params }),
  // GET /api/order-inquiries — List order inquiries
  listOrderInquiries: (params) => request('GET', '/api/order-inquiries', { query: params }),
  // POST /api/order-inquiries — Submit an order inquiry
  createOrderInquiry: (body) => request('POST', '/api/order-inquiries', { body }),
  // PUT /api/order-inquiries/{id} — Update inquiry status (pending -> approved -> fulfilled / rejected)
  updateOrderInquiry: ({ id }, body) => request('PUT', '/api/order-inquiries/{id}', { params: { id }, body }),
  // GET /api/order-inquiries/{id}/costing — Get the immutable costing snapshot frozen when the inquiry was submitted
  getInquiryCosting: ({ id }) => request('GET', '/api/order-inquiries/{id}/costing', { params: { id } }),
  // PUT /api/order-inquiries/{id}/payment — Mark an inquiry as paid/unpaid/failed after the GCash step
  updateInquiryPayment: ({ id }, body) => request('PUT', '/api/order-inquiries/{id}/payment', { params: { id }, body }),
  // GET /api/products — List products (optionally paginated, searched, filtered)
  listProducts: (params) => request('GET', '/api/products', { query: params }),
  // POST /api/products — Create a product (admin only)
  createProduct: (body) => request('POST', '/api/products', { body }),
  // GET /api/products/{id} — Get a single product
  getProduct: ({ id }) => request('GET', '/api/products/{id}', { params: { id } }),
  // PUT /api/products/{id} — Update a product (admin only)
  updateProduct: ({ id }, body) => request('PUT', '/api/products/{id}', { params: { id }, body }),
  // DELETE /api/products/{id} — Soft-delete a product (admin only)
  deleteProduct: ({ id }) => request('DELETE', '/api/products/{id}', { params: { id } }),
  // POST /api/products/bulk-costs — Set unit cost on many products in one request (admin only) — the cost-of-goods CSV import
  bulkUpdateCosts: (body) => request('POST', '/api/products/bulk-costs', { body }),
  // POST /api/products/bulk-prices — Set prices for many products in one request (admin only) â€” the price-list CSV import
  bulkUpdatePrices: (body) => request('POST', '/api/products/bulk-prices', { body }),
  // GET /api/products/categories — List distinct product categories
  listCategories: (_) => request('GET', '/api/products/categories', {  }),
  // GET /api/products/costs — Cost-of-goods sheet (admin only) — the only read path that reveals product cost
  listProductCosts: (_) => request('GET', '/api/products/costs', {  }),
  // GET /api/products/qr/{code} — QR product lookup: resolve a scanned tag payload / SKU / bare id to a product (staff or admin)
  getProductByQr: ({ code }) => request('GET', '/api/products/qr/{code}', { params: { code } }),
  // GET /api/reports — Printable management report: daily sales, stock by location, order status, low stock, movers (admin only)
  getReports: (params) => request('GET', '/api/reports', { query: params }),
  // GET /api/sales — List sales transactions (admin only)
  listSales: (params) => request('GET', '/api/sales', { query: params }),
  // POST /api/sales — Record a counter / walk-in sale: decrements stock, consumes the FEFO lot, audits
  createSale: (body) => request('POST', '/api/sales', { body }),
  // POST /api/scan-events — Record a QR / barcode scan into the audit trail (staff or admin)
  createScanEvent: (body) => request('POST', '/api/scan-events', { body }),
  // GET /api/settings — Get runtime system settings (admin tier â€” read-only)
  getSettings: (_) => request('GET', '/api/settings', {  }),
  // PUT /api/settings — Update runtime system settings (Owner / Super Admin only)
  updateSettings: (body) => request('PUT', '/api/settings', { body }),
  // GET /api/stock-adjustments — List stock adjustment requests (admin only)
  listStockAdjustments: (params) => request('GET', '/api/stock-adjustments', { query: params }),
  // POST /api/stock-adjustments — Create a stock adjustment request (admin only) â€” PENDING until approved
  createStockAdjustment: (body) => request('POST', '/api/stock-adjustments', { body }),
  // POST /api/stock-adjustments/{id}/approve — Approve a pending adjustment and apply it to stock (admin only)
  approveStockAdjustment: ({ id }) => request('POST', '/api/stock-adjustments/{id}/approve', { params: { id } }),
  // POST /api/stock-adjustments/{id}/reject — Reject a pending adjustment (stock unchanged) (admin only)
  rejectStockAdjustment: ({ id }, body) => request('POST', '/api/stock-adjustments/{id}/reject', { params: { id }, body }),
  // GET /api/stock-lots — List FIFO stock lots
  listStockLots: (params) => request('GET', '/api/stock-lots', { query: params }),
  // POST /api/stock-movement — Record a stock movement (FIFO-aware)
  createStockMovement: (body) => request('POST', '/api/stock-movement', { body }),
  // GET /api/stock-movements — List stock movements
  listStockMovements: (params) => request('GET', '/api/stock-movements', { query: params }),
  // GET /api/stock-transfers — List stock transfer requests (admin only)
  listStockTransfers: (params) => request('GET', '/api/stock-transfers', { query: params }),
  // POST /api/stock-transfers — Create a stock transfer request (admin only) â€” PENDING until approved
  createStockTransfer: (body) => request('POST', '/api/stock-transfers', { body }),
  // POST /api/stock-transfers/{id}/approve — Approve a pending transfer and move the stock (admin only)
  approveStockTransfer: ({ id }) => request('POST', '/api/stock-transfers/{id}/approve', { params: { id } }),
  // POST /api/stock-transfers/{id}/reject — Reject a pending transfer (stock unchanged) (admin only)
  rejectStockTransfer: ({ id }, body) => request('POST', '/api/stock-transfers/{id}/reject', { params: { id }, body }),
  // GET /api/stocktake — Recount board: which shelves are due to be walked (admin only)
  getStocktakeSchedule: (_) => request('GET', '/api/stocktake', {  }),
  // GET /api/unit-conversions — List the unit conversion catalog (admin only)
  listUnitConversions: (_) => request('GET', '/api/unit-conversions', {  }),
  // POST /api/unit-conversions — Create or update one unit conversion rate (admin only)
  upsertUnitConversion: (body) => request('POST', '/api/unit-conversions', { body }),
  // DELETE /api/unit-conversions/{id} — Remove a unit conversion (admin only)
  deleteUnitConversion: ({ id }) => request('DELETE', '/api/unit-conversions/{id}', { params: { id } }),
  // GET /api/users — List users (admin only)
  listUsers: (_) => request('GET', '/api/users', {  }),
  };
}

export default createApiClient;
