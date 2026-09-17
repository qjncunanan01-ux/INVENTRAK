'use strict';

// INVENTRAK role model — one strict hierarchy, least → most privileged:
//
//   customer     end customer / café owner (mobile: browse, inquire, track)
//   staff        Inventory Staff — physical counts, QR scanning, requests only
//   admin        Admin — products, prices, inventory, inquiries, approvals, reports
//   super_admin  Super Admin — adds system account / role / permission management
//   owner        Business Owner — full oversight + authorizes access decisions
//
// Capability tiers say WHICH roles pass a gate. They live in this one module on
// each backend (mirrored by frontend-admin/src/roles.js) so adding a role or
// moving a boundary is a one-line change instead of a hunt through 40 guards.
//
// Why tiers instead of `role === 'admin'` checks: the OLD code hardcoded
// 'admin' everywhere, so a new privileged role would silently lose access to
// every admin route (and skip its own MFA challenge). Tiers make that
// impossible — every guard reads from this list.

const ROLE_ORDER = ['customer', 'staff', 'admin', 'super_admin', 'owner'];

// Full operations tier. Everything money, pricing or revenue touches, plus
// approvals, products and orders. Inventory Staff is deliberately absent: the
// spec forbids them from seeing sales, prices, customers, orders, reports or
// business analytics.
const ADMIN_TIER = ['admin', 'super_admin', 'owner'];

// System administration: accounts, roles, permissions, configuration.
const MANAGEMENT_TIER = ['super_admin', 'owner'];

// Daily inventory work — staff plus everyone above them. This is the tier for
// read/request routes staff legitimately need (stock levels, movements,
// adjustments, transfers, scanning, OCR).
const STAFF_TIER = ['staff', ...ADMIN_TIER];

// Roles an Admin may grant; only management may grant privileged roles.
const ASSIGNABLE_BY_ADMIN = ['staff', 'admin'];
const ASSIGNABLE_BY_MANAGEMENT = ROLE_ORDER.concat(['customer']);

// The set of roles permitted to sign into the web admin portal (desktop).
// Inventory Staff is deliberately EXCLUDED: per the role spec the staff
// experience is the MOBILE application only (QR scanning, physical counts,
// adjustment requests). The web admin is a desktop surface for the admin
// tier — a staff login there is refused with a pointer to the mobile app.
const ADMIN_PORTAL_ROLES = ADMIN_TIER;

// The STAFF app is exclusively for Inventory Staff: admin-tier accounts (and
// customers) are refused there — they work in the web admin / customer app.
// Mirror of ADMIN_PORTAL_ROLES so each portal has one exact allowed set.
const STAFF_PORTAL_ROLES = ['staff'];

function isKnownRole(role) {
  return ROLE_ORDER.includes(role);
}

/**
 * Whether `role` may sign into the web admin portal (desktop).
 * Staff accounts authenticate fine but are mobile-only, so the login
 * endpoint refuses them with a `portal_mobile_only` error code.
 * @param {string} role
 * @returns {boolean}
 */
function canAccessAdminPortal(role) {
  return ADMIN_PORTAL_ROLES.includes(role);
}

/**
 * Whether `role` may sign into the dedicated staff mobile app.
 * Exclusively Inventory Staff: admins/owners manage from the web admin,
 * customers shop in the customer app — both are refused with
 * `staff_app_exclusive` so a shared device can never hold the wrong session.
 * @param {string} role
 * @returns {boolean}
 */
function canAccessStaffPortal(role) {
  return STAFF_PORTAL_ROLES.includes(role);
}

function hasRole(user, allowed) {
  return Boolean(user) && allowed.includes(user.role);
}

/** Money, pricing and revenue visibility (Total Sales, prices, reports). */
function canSeeMoney(user) {
  return hasRole(user, ADMIN_TIER);
}

/** Account / role / permission management. */
function isManagement(user) {
  return hasRole(user, MANAGEMENT_TIER);
}

module.exports = {
  ROLE_ORDER,
  ADMIN_TIER,
  MANAGEMENT_TIER,
  STAFF_TIER,
  ADMIN_PORTAL_ROLES,
  STAFF_PORTAL_ROLES,
  ASSIGNABLE_BY_ADMIN,
  ASSIGNABLE_BY_MANAGEMENT,
  isKnownRole,
  hasRole,
  canSeeMoney,
  isManagement,
  canAccessAdminPortal,
  canAccessStaffPortal,
};
