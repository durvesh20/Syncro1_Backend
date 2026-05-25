// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  let token;

  // 1) Check Authorization header (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2) Check cookie if token not found in header
  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    if (req.user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended'
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

// Generic role authorization
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user?.role} is not authorized to access this route`
      });
    }
    next();
  };
};

// Status check middleware
exports.checkStatus = (...statuses) => {
  return (req, res, next) => {
    if (!statuses.includes(req.user.status)) {
      return res.status(403).json({
        success: false,
        message: `Account status must be one of: ${statuses.join(', ')}`
      });
    }
    next();
  };
};

// Allow admin and sub-admin into admin CMS area
exports.authorizeAdminAccess = (req, res, next) => {
  if (!req.user || !['admin', 'sub_admin'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Only admin or sub-admin can access this route'
    });
  }

  next();
};

// Check a single permission
exports.checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Admin bypasses all permission checks
    if (req.user.role === 'admin') {
      return next();
    }

    // Only sub-admin should be permission-checked here
    if (req.user.role !== 'sub_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin or sub-admin can access this route'
      });
    }

    const userPermissions = req.user.permissions || [];

    if (!userPermissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Missing required permission: ${permission}`
      });
    }

    next();
  };
};

// Check if user has at least one of the given permissions
exports.checkAnyPermission = (permissions = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Admin bypasses all permission checks
    if (req.user.role === 'admin') {
      return next();
    }

    if (req.user.role !== 'sub_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin or sub-admin can access this route'
      });
    }

    const userPermissions = req.user.permissions || [];
    const hasAnyPermission = permissions.some((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasAnyPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource',
        requiredAnyOf: permissions
      });
    }

    next();
  };
};

// Optional helper if needed later
exports.checkAllPermissions = (permissions = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (req.user.role === 'admin') {
      return next();
    }

    if (req.user.role !== 'sub_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admin or sub-admin can access this route'
      });
    }

    const userPermissions = req.user.permissions || [];
    const hasAllPermissions = permissions.every((permission) =>
      userPermissions.includes(permission)
    );

    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        message: 'You do not have all required permissions',
        requiredAllOf: permissions
      });
    }

    next();
  };
};