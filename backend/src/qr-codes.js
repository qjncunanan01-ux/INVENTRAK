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
 *   2. a system or custom SKU      "PRD-000042" / "MILK-001"
 *   3. a bare numeric id (barcode fallback — the mobile scanners treat a pure
 *      number the same way, so scanning a legacy numeric barcode still works)
 * Anything else (a location tag, a URL, random text) is 'unknown'.
 * @returns {{kind:'id'|'sku'|'unknown', value:string|null}}
 */
function parseProductQrIdentifier(code) {
  const raw = String(code || '').trim();

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

module.exports = {
  PRODUCT_QR_PREFIX,
  LOW_STOCK_THRESHOLD,
  SKU_PATTERN,
  skuForProductId,
  isSkuShape,
  parseProductQrIdentifier,
  stockStatusOf,
  handleQrProductLookup,
};
