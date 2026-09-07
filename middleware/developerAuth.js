// backend/middleware/developerAuth.js
const jwt = require('jsonwebtoken');
const ApiClient = require('../models/ApiClient');
const Integration = require('../models/Integration');

/**
 * Protect middleware for developer API routes.
 * Expects Authorization: Bearer <token>
 */
exports.protectDeveloper = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Authentication token is required in Authorization header as Bearer token'
      },
      request_id: req.requestId || null
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'developer' || !decoded.client_id) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token is not a valid developer API token'
        },
        request_id: req.requestId || null
      });
    }

    // Verify ApiClient is still active in database
    const client = await ApiClient.findOne({
      client_id: decoded.client_id,
      status: 'ACTIVE'
    });

    if (!client) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Client credentials are invalid or have been revoked'
        },
        request_id: req.requestId || null
      });
    }

    // Verify Integration is active
    const integration = await Integration.findById(client.integration_id);
    if (!integration || integration.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INTEGRATION_INACTIVE',
          message: 'Developer API access for this company is disabled or suspended'
        },
        request_id: req.requestId || null
      });
    }

    // Attach developer context to request
    req.developer = {
      client_id: client.client_id,
      company_id: client.company_id,
      integration_id: client.integration_id,
      scopes: client.scopes || [],
      label: client.label
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Authentication token has expired. Please refresh your token.'
        },
        request_id: req.requestId || null
      });
    }

    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token'
      },
      request_id: req.requestId || null
    });
  }
};

/**
 * Require specific scope for developer API route
 * @param {string} scope e.g., 'jobs:read', 'jobs:write'
 */
exports.requireScope = (scope) => {
  return (req, res, next) => {
    if (!req.developer) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Not authorized'
        },
        request_id: req.requestId || null
      });
    }

    const scopes = req.developer.scopes || [];
    if (!scopes.includes(scope) && !scopes.includes('*')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `This endpoint requires the '${scope}' scope`
        },
        request_id: req.requestId || null
      });
    }

    next();
  };
};

