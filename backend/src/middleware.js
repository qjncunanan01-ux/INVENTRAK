const {
  ADMIN_TIER,
  STAFF_TIER,
  MANAGEMENT_TIER,
  ASSIGNABLE_BY_ADMIN,
  ASSIGNABLE_BY_MANAGEMENT,
  isKnownRole,
  canAccessAdminPortal,
  canAccessStaffPortal,
  isManagement,
} = require('./roles');

function adminOnly(req, res, next) {
  if (!ADMIN_TIER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

function managementOnly(req, res, next) {
  if (!MANAGEMENT_TIER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Owner or Super Admin access required' });
  }
  next();
}

function staffOrAdmin(req, res, next) {
  if (!STAFF_TIER.includes(req.user.role)) {
    return res.status(403).json({ error: 'Staff or admin access required' });
  }
  next();
}

module.exports = {
  adminOnly,
  managementOnly,
  staffOrAdmin,
  ADMIN_TIER,
  STAFF_TIER,
  MANAGEMENT_TIER,
  ASSIGNABLE_BY_ADMIN,
  ASSIGNABLE_BY_MANAGEMENT,
  isKnownRole,
  canAccessAdminPortal,
  canAccessStaffPortal,
  isManagement,
};