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
      throw new Error(msg);
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
  // POST /api/auth/login — Log in and receive a JWT token
  login: (body) => request('POST', '/api/auth/login', { body }),
  // GET /api/auth/me — Get the authenticated user's profile
  getMe: (_) => request('GET', '/api/auth/me', {  }),
  // GET /api/products — List products (optionally paginated, searched, filtered)
  listProducts: (params) => request('GET', '/api/products', { query: params }),
  // POST /api/products — Create a product (admin only)
  createProduct: (body) => request('POST', '/api/products', { body }),
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
  // GET /api/order-inquiries — List order inquiries
  listOrderInquiries: (params) => request('GET', '/api/order-inquiries', { query: params }),
  // POST /api/order-inquiries — Submit an order inquiry
  createOrderInquiry: (body) => request('POST', '/api/order-inquiries', { body }),
  // PUT /api/order-inquiries/{id} — Update inquiry status (pending -> approved -> fulfilled / rejected)
  updateOrderInquiry: ({ id }, body) => request('PUT', '/api/order-inquiries/{id}', { params: { id }, body }),
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
  // GET /api/alerts — List low-stock alerts
  listAlerts: (_) => request('GET', '/api/alerts', {  }),
  // PUT /api/alerts/{id}/resolve — Resolve an alert (admin only)
  resolveAlert: ({ id }) => request('PUT', '/api/alerts/{id}/resolve', { params: { id } }),
  // GET /api/sales — List sales transactions
  listSales: (params) => request('GET', '/api/sales', { query: params }),
  // POST /api/sales — Record a sale
  createSale: (body) => request('POST', '/api/sales', { body }),
  // GET /api/users — List users (admin only)
  listUsers: (_) => request('GET', '/api/users', {  }),
  };
}

export default createApiClient;
