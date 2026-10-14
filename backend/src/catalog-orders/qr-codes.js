// QR product identification — the scanning core shared by BOTH backends.
//
// Replaces the OCR pipeline (camera image → tesseract text → fuzzy catalog
// match) with deterministic identification: the QR code on a product tag
// carries only a stable IDENTIFIER, and the database — never the tag — is the
// source of truth for everything else (name, price, quantity, status).
//
//   Camera → QR decoder → identifier → database lookup → product
//
// Payload contract (CROSS-APP — mirrored by frontend-admin/src/qr.js and the
// mobile/staff scanners, all covered by tests; change all of them together):
//
//   INVENTRAK:PROD:<id>                 product tag printed by the admin
//   INVENTRAK:LOC:<id>:<url-encoded>    storage-area tag (routed, not looked up here)
//
// Security properties (deliberate, per the capstone spec):
//   - The QR authorizes NOTHING. It only names a product. Authentication,
//     role, product status, location, quantity and the approval workflow are
//     all enforced server-side exactly as before.
//   - No quantity, price, cost or personal data is ever encoded in a tag, so a
//     lost tag leaks nothing and a reprinted tag never goes stale.

// The only QR namespace that identifies a product.
const PRODUCT_QR_PREFIX = 'INVENTRAK:PROD:';

// Camera-friendly tag URL. Plain-text payloads like INVENTRAK:PROD:1 scan fine
// inside the INVENTRAK apps, but a phone's NATIVE camera app cannot act on
// them (iOS shows "No usable data found" — a top demo-day failure). Printing
// tags as URLs to the public tag page makes every phone camera open a working
// product page, while the app scanners unwrap the URL to the same id.
const TAG_WEB_BASE = (process.env.INVENTRAK_TAG_URL_BASE || 'https://inventrak-api.onrender.com').replace(/\/+$/, '');
const TAG_WEB_PATH_RE = /^https:\/\/[^\s/]+\/t\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/;

// Matches the /api/inventory low_stock filter (total < 80) so the scanner
// agrees with the Inventory page and the OCR-era status bands.
const LOW_STOCK_THRESHOLD = 80;

// SKU shape: 2-32 chars of A-Z, 0-9 and dashes, starting and ending with an
// alphanumeric character. "PRD-000042", "MILK-001" and "TORANI-VAN-750" all
// fit; free text, spaces and symbols do not. Kept intentionally loose so the
// business can choose its own coding scheme — the system-generated default is
// `skuForProductId` below.
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,31}[A-Z0-9]$/;

// Deterministic system SKU for a product id: "PRD-000001". Derived from the
// id itself, so a backfill over any existing catalog can never collide with
// itself, and re-running the migration is idempotent.
function skuForProductId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  return `PRD-${String(n).padStart(6, '0')}`;
}

function isSkuShape(value) {
  return typeof value === 'string' && SKU_PATTERN.test(value);
}

/**
 * Decode a scanned string into a product identifier.
 * Accepts, in order of precision:
 *   1. a full product tag payload  "INVENTRAK:PROD:42"
 *   2. a camera-friendly tag URL   "https://…/t/42" (payload unchanged + path)
 *   3. a system or custom SKU      "PRD-000042" / "MILK-001"
 *   4. a bare numeric id (barcode fallback — the mobile scanners treat a pure
 *      number the same way, so scanning a legacy numeric barcode still works)
 * Anything else (a location tag, a URL, random text) is 'unknown'.
 * @returns {{kind:'id'|'sku'|'unknown', value:string|null}}
 */
function parseProductQrIdentifier(code) {
  const raw = String(code || '').trim();

  // Camera-friendly URL form (printed tags): unwrap to the plain payload and
  // recurse, so "https://host/t/42" and "INVENTRAK:PROD:42" are equivalent
  // everywhere — endpoint, admin scanner, and both mobile apps.
  const url = raw.match(TAG_WEB_PATH_RE);
  if (url) return parseProductQrIdentifier(url[1]);

  const tagged = raw.match(/^INVENTRAK:PROD:(.+)$/i);
  if (tagged) {
    const inner = tagged[1].trim();
    if (/^\d+$/.test(inner)) return { kind: 'id', value: inner };
    if (isSkuShape(inner.toUpperCase())) return { kind: 'sku', value: inner.toUpperCase() };
    return { kind: 'unknown', value: null };
  }

  if (/^\d+$/.test(raw) && raw.length <= 9) return { kind: 'id', value: raw };
  if (isSkuShape(raw.toUpperCase())) return { kind: 'sku', value: raw.toUpperCase() };

  return { kind: 'unknown', value: null };
}

// Stock status band shared with the inventory page ("ok" | "low" | "out").
function stockStatusOf(total) {
  const t = Number(total) || 0;
  if (t === 0) return 'out';
  if (t < LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

/**
 * Data for the PUBLIC tag page (GET /t/:code) — the camera-friendly landing
 * target printed on every tag. A phone's native camera app opens this URL and
 * sees a read-only product view, instead of "No usable data found" for a
 * plain-text payload. Read-only on purpose: the QR authorizes nothing, and
 * every workflow (scan-to-count, staff tools) stays inside authenticated apps.
 *
 * Same identifier grammar as the QR lookup; same 400/404/409 error contract;
 * a deliberately slim public projection (no cost/supplier/user fields).
 *
 * ctx = {
 *   code:        the tag identifier ("1", "PRD-000001", "INVENTRAK:PROD:1"…)
 *   products:    every product row, as in handleQrProductLookup
 *   stockLookup: (productId) => { locations, total }
 * }
 * Returns { status:number, body:object }.
 */
async function handleTagPageLookup(req, res, sendJson, ctx) {
  const raw = ctx && ctx.code !== undefined ? ctx.code : (req.params && req.params.code);
  const parsed = parseProductQrIdentifier(raw);

  if (parsed.kind === 'unknown') {
    return { status: 400, body: { error: 'Validation failed', details: ['Invalid QR code. Please scan a valid INVENTRAK QR code.'] } };
  }
  const products = Array.isArray(ctx.products) ? ctx.products : [];
  const product = products.find(p => {
    if (parsed.kind === 'id') return Number(p.id) === Number(parsed.value);
    const sku = p.sku || (p.Sku !== undefined ? p.Sku : null);
    return sku && String(sku).toUpperCase() === parsed.value;
  });
  if (!product) {
    return { status: 404, body: { error: 'Not found', details: ['QR code is not registered in INVENTRAK.'] } };
  }
  const status = product.status === undefined || product.status === null || product.status === '' ? 'active' : product.status;
  if (status !== 'active') {
    return { status: 409, body: { error: 'Conflict', details: ['This product is currently inactive.'] } };
  }

  const stock = ctx.stockLookup(product.id) || { locations: {}, total: 0 };
  const sku = product.sku || product.Sku || skuForProductId(product.id);
  const total = Number(stock.total) || 0;
  return {
    status: 200,
    body: {
      product: {
        id: product.id,
        name: product.name,
        category: product.category || null,
        brand: product.brand || null,
        description: product.description || null,
        size: product.size || null,
        unit: product.unit || null,
        image: product.image || null,
      },
      qr: { payload: `${PRODUCT_QR_PREFIX}${product.id}`, sku, tagUrl: `${TAG_WEB_BASE}/t/${product.id}` },
      stock: { total, status: stockStatusOf(total) },
    },
  };
}

/**
 * The QR product-lookup handler, expressed over a tiny context so the SQLite
 * (Express) and npm-free/Firestore servers can both mount it unchanged.
 *
 * ctx = {
 *   code:        the decoded scanned string (preferred); falls back to
 *                req.params.code for Express routers
 *   products:    EVERY product row (active and inactive), each with
 *                { id, sku, name, category, ... } — lookup may hit either.
 *   stockLookup: (productId) => { locations: {name: qty}, total: number }
 *   lotsFor:     (productId) => [open FIFO lots] (FEFO-ordered)
 * }
 *
 * Response (200):
 *   { product, qr: { payload, sku }, stock: { locations, total, status }, lots }
 *
 * Errors follow the capstone's user-facing wording:
 *   400 invalid QR  ·  404 not registered  ·  409 inactive product
 */
async function handleQrProductLookup(req, res, sendJson, ctx) {
  const raw = ctx && ctx.code !== undefined ? ctx.code : (req.params && req.params.code);
  const parsed = parseProductQrIdentifier(raw);

  if (parsed.kind === 'unknown') {
    return sendJson(res, 400, {
      error: 'Validation failed',
      details: ['Invalid QR code. Please scan a valid INVENTRAK QR code.'],
    });
  }

  const products = Array.isArray(ctx.products) ? ctx.products : [];
  const product = products.find(p => {
    if (parsed.kind === 'id') return Number(p.id) === Number(parsed.value);
    const sku = p.sku || (p.Sku !== undefined ? p.Sku : null);
    return sku && String(sku).toUpperCase() === parsed.value;
  });

  if (!product) {
    return sendJson(res, 404, {
      error: 'Not found',
      details: ['QR code is not registered in INVENTRAK.'],
    });
  }

  // Soft-deleted (or not-yet-activated) products must not scan into workflows.
  const status = product.status === undefined || product.status === null || product.status === '' ? 'active' : product.status;
  if (status !== 'active') {
    return sendJson(res, 409, {
      error: 'Conflict',
      details: ['This product is currently inactive.'],
    });
  }

  const stock = ctx.stockLookup(product.id) || { locations: {}, total: 0 };
  const sku = product.sku || product.Sku || skuForProductId(product.id);

  return sendJson(res, 200, {
    product,
    qr: { payload: `${PRODUCT_QR_PREFIX}${product.id}`, sku },
    stock: {
      locations: stock.locations || {},
      total: Number(stock.total) || 0,
      status: stockStatusOf(stock.total),
    },
    lots: typeof ctx.lotsFor === 'function' ? ctx.lotsFor(product.id) : [],
  });
}

// Minimal HTML renderer for the public tag page. Inline styles and zero
// dependencies: the page must render on any phone browser straight from the
// server, and the API's strict CSP is relaxed just for this one surface
// (images + inline styles) while staying frame-ancestors 'none'.
function renderTagPageHtml(result) {
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shell = (inner) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>INVENTRAK</title></head><body style="font-family:system-ui,-apple-system,sans-serif;background:#eef7e1;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box"><div style="max-width:420px;width:100%;background:#fff;border-radius:18px;padding:26px;box-shadow:0 8px 30px rgba(0,0,0,0.08);text-align:center">${inner}</div></body></html>`;

  if (!result || result.status !== 200) {
    const msg = result && result.body && Array.isArray(result.body.details) && result.body.details[0] ? result.body.details[0] : 'Tag not found.';
    return shell(
      `<div style="font-size:36px;line-height:1">▦</div>` +
      `<h1 style="font-size:19px;margin:10px 0 2px;color:#1a1a1a">INVENTRAK</h1>` +
      `<p style="color:#555;font-size:14px;line-height:1.5;margin:14px 0 0">${esc(msg)}</p>`,
    );
  }

  const p = result.body.product;
  const st = result.body.stock;
  const statusLabel = st.status === 'out' ? 'Out of stock' : st.status === 'low' ? 'Low stock' : 'In stock';
  const statusColor = st.status === 'out' ? '#c62828' : st.status === 'low' ? '#b26a00' : '#2e7d32';
  const price = p.price === undefined || p.price === null || p.price === '' ? '' : `<div style="font-size:20px;font-weight:800;color:#1a1a1a;margin-top:10px">₱${esc(p.price)}</div>`;
  const img = p.image ? `<img src="${esc(p.image)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:14px;background:#f2f2f2">` : '';
  const desc = p.description ? `<p style="color:#555;font-size:13px;line-height:1.55;margin:14px 0 0;text-align:left">${esc(p.description)}</p>` : '';
  return shell(
    img +
    `<h1 style="font-size:20px;margin:14px 0 2px;color:#1a1a1a;line-height:1.3">${esc(p.name)}</h1>` +
    `<div style="color:#777;font-size:12.5px">${esc([p.brand, p.category, p.size].filter(Boolean).join(' · '))}</div>` +
    price +
    `<div style="display:inline-block;margin-top:12px;padding:5px 14px;border-radius:999px;font-size:12.5px;font-weight:700;color:#fff;background:${statusColor}">${statusLabel} · ${esc(st.total)} on hand</div>` +
    desc +
    `<div style="margin-top:20px;padding-top:14px;border-top:1px dashed #ddd;color:#999;font-size:11px;line-height:1.6">Scanned from an INVENTRAK product tag (SKU ${esc(result.body.qr.sku)})<br>Staff tools live in the INVENTRAK apps.</div>`,
  );
}

module.exports = {
  PRODUCT_QR_PREFIX,
  TAG_WEB_BASE,
  TAG_WEB_PATH_RE,
  LOW_STOCK_THRESHOLD,
  SKU_PATTERN,
  skuForProductId,
  isSkuShape,
  parseProductQrIdentifier,
  stockStatusOf,
  handleQrProductLookup,
  handleTagPageLookup,
  renderTagPageHtml,
};
