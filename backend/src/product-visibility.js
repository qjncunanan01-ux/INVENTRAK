// Who may see a product's cost of goods.
//
// `cost` is what the café PAYS; `price` is what the customer pays. The gap
// between them is the business's margin, so it is never public data.
//
// Adding `cost` to the products table therefore had to be paired with a
// visibility rule, or `GET /api/products` — which is unauthenticated, because
// the customer catalog has to work for guests — would have published the whole
// cost basis to the internet. The rule:
//
//   - Public reads (catalog list, single product, QR lookup, public tag page)
//     NEVER include `cost`, whoever is asking.
//   - Only the admin tier sees it, and only because the admin console has to be
//     able to SHOW a cost in order to EDIT one.
//
// Note the QR lookup is staff-gated, not admin-gated, and still strips it:
// "authenticated" is not "entitled to the margin".
const { ADMIN_TIER } = require('./roles');

// Remove `cost` from a product row. Works on both catalog shapes
// ({ cost } in SQLite, { cost } via formatProduct in the npm-free backend).
function stripCost(row) {
  if (!row || typeof row !== 'object') return row;
  if (!('cost' in row)) return row;
  const { cost, ...rest } = row; // eslint-disable-line no-unused-vars
  return rest;
}

function stripCostAll(rows) {
  return Array.isArray(rows) ? rows.map(stripCost) : rows;
}

// Only the admin tier may read `cost`. Staff (physical counts, QR scans) and
// customers never may.
function costVisibleTo(role) {
  return ADMIN_TIER.includes(role);
}

module.exports = { stripCost, stripCostAll, costVisibleTo };