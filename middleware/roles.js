const Admin = require('../models/Admin');

// Check if current user has a specific permission
function requirePermission(permission) {
  return async (req, res, next) => {
    if (!req.session.admin) {
      req.session.error = 'Please log in';
      return res.redirect('/auth/login');
    }

    const admin = await Admin.findById(req.session.admin.id);
    if (!admin || !admin.active) {
      req.session.error = 'Account not found or disabled';
      return res.redirect('/auth/login');
    }

    if (!admin.can(permission)) {
      req.session.error = 'You do not have permission to access this page';
      return res.redirect('/dashboard');
    }

    req.admin = admin;
    next();
  };
}

// Check if user has one of multiple permissions
function requireAnyPermission(...permissions) {
  return async (req, res, next) => {
    if (!req.session.admin) {
      req.session.error = 'Please log in';
      return res.redirect('/auth/login');
    }

    const admin = await Admin.findById(req.session.admin.id);
    if (!admin || !admin.active) {
      req.session.error = 'Account not found or disabled';
      return res.redirect('/auth/login');
    }

    const hasAny = permissions.some(p => admin.can(p));
    if (!hasAny) {
      req.session.error = 'You do not have permission to access this page';
      return res.redirect('/dashboard');
    }

    req.admin = admin;
    next();
  };
}

// Require super or admin role
function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    req.session.error = 'Please log in';
    return res.redirect('/auth/login');
  }
  if (!['super', 'admin'].includes(req.session.admin.role)) {
    req.session.error = 'Admin access required';
    return res.redirect('/dashboard');
  }
  next();
}

// Make role info available in templates
function roleHelpers(req, res, next) {
  if (req.session.admin) {
    res.locals.userRole = req.session.admin.role;
    res.locals.canManageUsers = ['super', 'admin'].includes(req.session.admin.role);
    res.locals.canManageSites = ['super', 'admin'].includes(req.session.admin.role);
    res.locals.canCreateCampaigns = ['super', 'admin', 'editor'].includes(req.session.admin.role);
    res.locals.canSendCampaigns = ['super', 'admin', 'editor'].includes(req.session.admin.role);
    res.locals.canManageWebhooks = ['super', 'admin'].includes(req.session.admin.role);
    res.locals.canManageRss = ['super', 'admin'].includes(req.session.admin.role);
    res.locals.canDeleteData = ['super', 'admin'].includes(req.session.admin.role);
  }
  next();
}

module.exports = { requirePermission, requireAnyPermission, requireAdmin, roleHelpers };
