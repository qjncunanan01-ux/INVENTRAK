import { describe, expect, test } from 'vitest';
import { ADMIN_TIER, MANAGEMENT_TIER, STAFF_TIER, canSeeMoney, isAdminTier, isManagement, roleMeta } from './roles';

// These tiers are a mirror of backend/src/roles.js. The backend suite proves
// the server side; these lock the frontend side so a divergence (e.g. hiding
// money from an Admin in the UI but not on the API) fails loudly.
describe('role tiers', () => {
  test('the admin tier is exactly admin, super_admin and owner', () => {
    expect([...ADMIN_TIER].sort()).toEqual(['admin', 'owner', 'super_admin']);
  });

  test('the management tier is exactly the two most privileged roles', () => {
    expect([...MANAGEMENT_TIER].sort()).toEqual(['owner', 'super_admin']);
  });

  test('the staff tier is staff plus every admin-tier role', () => {
    expect([...STAFF_TIER].sort()).toEqual(['admin', 'owner', 'staff', 'super_admin']);
  });
});

describe('money visibility', () => {
  test('Owner, Super Admin and Admin may see money', () => {
    for (const role of ADMIN_TIER) {
      expect(canSeeMoney(role), `${role} may see money`).toBe(true);
    }
  });

  test('Inventory Staff and customers never see money', () => {
    expect(canSeeMoney('staff')).toBe(false);
    expect(canSeeMoney('customer')).toBe(false);
    expect(canSeeMoney(undefined)).toBe(false);
  });
});

describe('tier membership', () => {
  test('isAdminTier matches the money policy', () => {
    for (const role of ['admin', 'super_admin', 'owner']) expect(isAdminTier(role)).toBe(true);
    for (const role of ['staff', 'customer', '', undefined]) expect(isAdminTier(role)).toBe(false);
  });

  test('only owner and super_admin are management', () => {
    expect(isManagement('owner')).toBe(true);
    expect(isManagement('super_admin')).toBe(true);
    expect(isManagement('admin')).toBe(false);
    expect(isManagement('staff')).toBe(false);
  });
});

describe('role labels', () => {
  test('every sign-in role has a distinct badge label', () => {
    const labels = ['owner', 'super_admin', 'admin', 'staff'].map((r) => roleMeta(r).label);
    expect(labels).toEqual(['OWNER', 'SUPER ADMIN', 'ADMIN', 'STAFF']);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('an unknown role still renders a readable label', () => {
    expect(roleMeta('weird_role').label).toBe('WEIRD_ROLE');
    expect(roleMeta(undefined).label).toBe('');
  });
});
