// Shared normalizer for order-inquiry line items (used by BOTH the SQLite and
// the npm-free backend so the stored records — and every response — are
// byte-identical).
//
// The mobile checkout sends structured lines:
//   { name, qty, price, original_price }
//   - price          = the unit price the customer actually pays (the day's
//                      DEAL price when the item was a flash pick, else the
//                      catalog price) — snapshotted at add-to-cart time
//   - original_price = the catalog price BEFORE the deal discount (only for
//                      pick items; omitted/null when no discount applied)
//
// Legacy entries (older clients, tests) are plain strings like "Butterscotch
// x2" — the normalizer parses those into the same shape (without prices).
// normalizeLines() returns the canonical array AND the order total computed
// from the line subtotals, so the stored estimated_cost always matches what
// the customer was charged.

// Parse a legacy string entry ("Widget x3" / "Widget" / "Widget (2)") into a
// { name, qty } pair. Unknown shapes stay as plain names with qty 1.
function parseLegacyString(entry) {
  const trimmed = String(entry).trim();
  const m = trimmed.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
  if (m) return { name: m[1].trim(), qty: Number(m[2]) };
  return { name: trimmed, qty: 1 };
}

// Normalize one raw entry into the canonical line shape:
//   { id?, name, qty, unit_price, original_price, subtotal }
// Prices default to null when the client did not send them (legacy strings),
// so totals are only derived from lines that actually carry prices.
function normalizeLine(entry, index) {
  if (entry && typeof entry === 'object') {
    const name = String(entry.name || entry.product_name || 'Item').trim() || `Item ${index + 1}`;
    const qty = Math.max(1, Math.floor(Number(entry.qty) || 1));
    const unitPrice = Number(entry.price) > 0 ? Number(entry.price) : null;
    const originalPrice = Number(entry.original_price) > 0 ? Number(entry.original_price) : null;
    return {
      id: entry.id !== undefined && entry.id !== null ? entry.id : null,
      name,
      qty,
      unit_price: unitPrice,
      original_price: originalPrice,
      subtotal: unitPrice !== null ? Math.round(unitPrice * qty * 100) / 100 : null,
    };
  }
  const { name, qty } = parseLegacyString(entry);
  return { id: null, name, qty, unit_price: null, original_price: null, subtotal: null };
}

// Normalize the raw `products` array sent to POST /api/order-inquiries.
// Returns { lines, total, hasPrices }.
//   - lines       — the canonical array (stored as the inquiry's products)
//   - total       — sum of the priced line subtotals, or null when no line
//                   carries a price (the caller then falls back to the
//                   submitted estimated_cost, preserving legacy behavior)
//   - hasPrices   — true when at least one line has a unit price
function normalizeLines(raw) {
  const entries = Array.isArray(raw) ? raw : [];
  const lines = entries.map(normalizeLine);
  const priced = lines.filter((l) => l.subtotal !== null);
  const hasPrices = priced.length > 0;
  const total = hasPrices
    ? Math.round(priced.reduce((sum, l) => sum + l.subtotal, 0) * 100) / 100
    : null;
  return { lines, total, hasPrices };
}

// Friendly one-line-per-product rendering used by the mobile history screen
// and the admin table for legacy rows that predate structured lines.
function summarizeLines(lines) {
  return lines
    .map((l) => (l.qty > 1 ? `${l.name} x${l.qty}` : l.name))
    .join(', ');
}

module.exports = { normalizeLines, summarizeLines };
