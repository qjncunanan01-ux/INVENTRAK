const { db } = require('./db');
const { criticalLevelOf } = require('./critical-level');

function resolveLocation(value) {
  if (!value && value !== 0) return null;
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric)) return numeric;
  const row = db.prepare('SELECT id FROM locations WHERE name = ?').get(value);
  return row ? row.id : null;
}

// Consumes `quantity` from the lots at one location, expiring-first, and
// returns a MANIFEST of what actually left.
//
// Each entry carries the lot's `lot_id` and `received_at` alongside the
// expiry. They are additive: `groupManifestByExpiry` (used by transfers) keys
// on expiry_date only, so grouping is unchanged. They exist so a caller can
// TELL THE CUSTOMER WHICH BATCH WENT — the counter sale reports it back, and
// that is the only way to demonstrate FEFO without reading the sort order.
//
// The final entry is the "legacy/overflow" remainder: stock that sits on the
// shelf without a covering lot. It carries lot_id: null so a UI can say so
// rather than inventing a batch number.
function consumeStockLots(productId, locationId, quantity) {
  let remaining = quantity;
  const manifest = [];

  const lots = db.prepare('SELECT id, qty, expiry_date, received_at FROM stock_lots WHERE product_id = ? AND location_id = ? AND qty > 0 ORDER BY (expiry_date IS NULL) ASC, expiry_date ASC, received_at ASC, id ASC').all(productId, locationId);

  for (const lot of lots) {
    if (remaining <= 0) break;
    const consume = Math.min(lot.qty, remaining);
    db.prepare('UPDATE stock_lots SET qty = qty - ? WHERE id = ?').run(consume, lot.id);
    remaining -= consume;
    manifest.push({
      lot_id: lot.id,
      expiry_date: lot.expiry_date == null ? null : lot.expiry_date,
      received_at: lot.received_at == null ? null : lot.received_at,
      qty: consume,
    });
  }

  if (remaining > 0) {
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(remaining, productId, locationId);
    manifest.push({ lot_id: null, expiry_date: null, received_at: null, qty: remaining });
  }

  return manifest;
}

function groupManifestByExpiry(manifest) {
  const groups = [];
  for (const entry of manifest) {
    const expiry = entry.expiry_date == null ? null : entry.expiry_date;
    const existing = groups.find(g => g.expiry_date === expiry);
    if (existing) existing.qty += entry.qty;
    else groups.push({ expiry_date: expiry, qty: entry.qty });
  }
  return groups;
}

// Applies a movement's effect on stock, the lot ledger and the low-stock
// alert. Returns `{ manifest, lowStockAlert }` so the caller can REPORT what
// happened — the counter sale hands the manifest straight back to the till.
function applyMovementEffect({ product_id, qty, type, srcId, dstId, now, expiryDate = null }) {
  const ensureStockRow = db.prepare('INSERT OR IGNORE INTO stock (product_id, location_id, quantity) VALUES (?, ?, 0)');

  if (srcId) ensureStockRow.run(product_id, srcId);
  if (dstId) ensureStockRow.run(product_id, dstId);

  // Only stock-out and transfer REMOVE lots, so only they produce a manifest.
  let manifest = [];

  if (type === 'stock-in' && dstId) {
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at, expiry_date) VALUES (?, ?, ?, ?, ?)').run(product_id, dstId, qty, now, expiryDate);
  } else if (type === 'stock-out' && srcId) {
    manifest = consumeStockLots(product_id, srcId, qty);
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
  } else if (type === 'transfer' && srcId && dstId) {
    const manifest = groupManifestByExpiry(consumeStockLots(product_id, srcId, qty));
    const dstGroups = manifest.some(g => g.expiry_date != null) ? manifest : expiryDate ? [{ expiry_date: expiryDate, qty }] : manifest;
    db.prepare('UPDATE stock SET quantity = quantity - ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, srcId);
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, dstId);
    for (const g of dstGroups) {
      db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at, expiry_date) VALUES (?, ?, ?, ?, ?)').run(product_id, dstId, g.qty, now, g.expiry_date);
    }
  } else if (type === 'adjustment' && (srcId || dstId)) {
    const loc = dstId || srcId;
    db.prepare('UPDATE stock SET quantity = ? WHERE product_id = ? AND location_id = ?').run(qty, product_id, loc);
    db.prepare('DELETE FROM stock_lots WHERE product_id = ? AND location_id = ?').run(product_id, loc);
    db.prepare('INSERT INTO stock_lots (product_id, location_id, qty, received_at, expiry_date) VALUES (?, ?, ?, ?, ?)').run(product_id, loc, qty, now, expiryDate);
  }

  const threshold = criticalLevelOf(product_id);
  let lowStockAlert = null;
  if (srcId) {
    const updated = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND location_id = ?').get(product_id, srcId);
    if (updated && updated.quantity < threshold) {
      const existingAlert = db.prepare('SELECT id FROM inventory_alerts WHERE product_id = ? AND location_id = ? AND alert_type = ? AND status = ?').get(product_id, srcId, 'low_stock', 'active');
      if (!existingAlert) {
        db.prepare('INSERT INTO inventory_alerts (product_id, location_id, alert_type, threshold, current_qty, status) VALUES (?, ?, ?, ?, ?, ?)').run(product_id, srcId, 'low_stock', threshold, updated.quantity, 'active');
      } else {
        db.prepare('UPDATE inventory_alerts SET current_qty = ? WHERE id = ?').run(updated.quantity, existingAlert.id);
      }
      lowStockAlert = {
        threshold,
        current_qty: updated.quantity,
        raised: !existingAlert,
      };
    }
  }

  return { manifest, lowStockAlert };
}

module.exports = { applyMovementEffect, consumeStockLots, groupManifestByExpiry, resolveLocation };