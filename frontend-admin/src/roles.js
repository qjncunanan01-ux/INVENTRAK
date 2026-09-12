// Frontend mirror of backend/src/roles.js. The surface is tiny and stable, but
// it MUST stay in lockstep with the backend — if a role or tier changes there,
// change it here too (the role/RBAC test suite guards the backend side).
//
//   customer    end customer / café owner (mobile only)
//   staff       Inventory Staff — counts, QR scanning, requests (NO money)
//   admin       Admin — products, prices, inventory, approvals, reports
//   super_admin Super Admin — adds account / role / permission management
//   owner       Business Owner — full oversight + access decisions
export const ADMIN_TIER = ['admin', 'super_admin', 'owner'];
export const MANAGEMENT_TIER = ['super_admin', 'owner'];
export const STAFF_TIER = ['staff', ...ADMIN_TIER];

// Label + chip colour per role, used by the top-bar badge, the login quick-fill
// buttons and the demo credential hints so all three can never drift apart.
export const ROLE_META = {
  owner: { label: 'OWNER', color: '#1f640e', blurb: 'full oversight + access decisions' },
  super_admin: { label: 'SUPER ADMIN', color: '#1565c0', blurb: 'accounts, roles & permissions' },
  admin: { label: 'ADMIN', color: '#2e7d32', blurb: 'products, stock, approvals & reports' },
  staff: { label: 'STAFF', color: '#e66a0d', blurb: 'counts, scanning & requests' },
};

export function roleMeta(role) {
  return ROLE_META[role] || { label: String(role || '').toUpperCase(), color: '#666', blurb: '' };
}

export function isAdminTier(role) {
  return ADMIN_TIER.includes(role);
}

export function isManagement(role) {
  return MANAGEMENT_TIER.includes(role);
}

export function isStaffTier(role) {
  return STAFF_TIER.includes(role);
}

/** Money, pricing and revenue visibility — Owner, Super Admin and Admin only. */
export function canSeeMoney(role) {
  return ADMIN_TIER.includes(role);
}
