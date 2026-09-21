// backend/middleware/developerAuth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const ApiClient = require('../models/ApiClient');
const DeveloperAccount = require('../models/DeveloperAccount');
const Integration = require('../models/Integration');

/**
 * Protect middleware for Developer Portal routes (Portal login/management)
 * Expects Authorization: Bearer <jwt>
 */
exports.protectDeveloperPortal = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Authentication token is required in Authorization header as Bearer token' },
      request_id: req.requestId || null
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'developer_portal' || !decoded.id) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Token is not a valid developer portal token' },
        request_id: req.requestId || null
      });
    }

    const account = await DeveloperAccount.findById(decoded.id);
    if (!account || account.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Account is invalid or inactive' },
        request_id: req.requestId || null
      });
    }

    const integration = await Integration.findById(account.integration_id);
    if (!integration || integration.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: { code: 'INTEGRATION_INACTIVE', message: 'Developer API access for this company is disabled or suspended' },
        request_id: req.requestId || null
      });
    }

    req.developer = {
      id: account._id,
      client_id: `portal_${account._id}`,
      email: account.email,
      name: account.name,
      company_id: account.company_id,
      integration_id: account.integration_id
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Authentication token has expired. Please refresh your token.' },
        request_id: req.requestId || null
      });
    }
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid authentication token' },
      request_id: req.requestId || null
    });
  }
};

/**
 * Protect middleware for developer API routes (Programmatic access via /api/v1/*)
 * Accepts either X-API-Key or Bearer <token_or_jwt>
 */
exports.protectDeveloper = async (req, res, next) => {
  let apiKey = req.headers['x-api-key'];
  let jwtToken = null;

  if (!apiKey && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    const token = req.headers.authorization.split(' ')[1];
    if (token.startsWith('syncro_live_') || token.startsWith('syncro_test_')) {
      apiKey = token;
    } else {
      jwtToken = token;
    }
  }

  if (!apiKey && !jwtToken) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Authentication required. Provide an API key via X-API-Key header or Bearer token, or a valid JWT.'
      },
      request_id: req.requestId || null
    });
  }

  try {
    if (apiKey) {
      // API Key based access
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const client = await ApiClient.findOne({
        $or: [
          { key_hash: keyHash },
          { api_key: apiKey }
        ]
      });
      
      if (!client || client.status === 'REVOKED') {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'API key is invalid or has been revoked' },
          request_id: req.requestId || null
        });
      }

      if (client.status === 'INACTIVE') {
        return res.status(401).json({
          success: false,
          error: { code: 'KEY_DEACTIVATED', message: 'API key is currently deactivated. Please re-activate it in the Developer Portal.' },
          request_id: req.requestId || null
        });
      }

      const integration = await Integration.findById(client.integration_id);
      if (!integration || integration.status !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          error: { code: 'INTEGRATION_INACTIVE', message: 'Developer API access for this company is disabled or suspended' },
          request_id: req.requestId || null
        });
      }

      client.last_used_at = new Date();
      await client.save({ validateModifiedOnly: true });

      req.developer = {
        client_id: client._id,
        company_id: client.company_id,
        integration_id: client.integration_id,
        scopes: client.scopes || [],
        label: client.label,
        environment: client.environment
      };

      return next();
    } else if (jwtToken) {
      // JWT based access
      const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET);
      if (decoded.type !== 'developer_portal' || !decoded.id) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Token is not a valid developer token' },
          request_id: req.requestId || null
        });
      }

      const account = await DeveloperAccount.findOne({ _id: decoded.id, status: 'ACTIVE' });
      if (!account) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Account is invalid or inactive' },
          request_id: req.requestId || null
        });
      }

      const integration = await Integration.findById(account.integration_id);
      if (!integration || integration.status !== 'ACTIVE') {
        return res.status(403).json({
          success: false,
          error: { code: 'INTEGRATION_INACTIVE', message: 'Developer API access for this company is disabled or suspended' },
          request_id: req.requestId || null
        });
      }

      req.developer = {
        id: account._id,
        client_id: `portal_${account._id}`,
        company_id: account.company_id,
        integration_id: account.integration_id,
        scopes: ['*'], // Full scopes for portal users accessing programmatic APIs
        label: 'Developer Portal Token'
      };

      return next();
    }
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Authentication token has expired. Please refresh your token.' },
        request_id: req.requestId || null
      });
    }

    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Invalid authentication token or API key' },
      request_id: req.requestId || null
    });
  }
};

/**
 * Require specific scope for developer API route
 * @param {string|string[]} scope e.g., 'jobs:read', ['candidates:write', 'statuses:write']
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
    const required = Array.isArray(scope) ? scope : [scope];
    const hasPermission = scopes.includes('*') || required.some(s => scopes.includes(s));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `This endpoint requires one of the following scopes: ${required.join(', ')}`
        },
        request_id: req.requestId || null
      });
    }

    next();
  };
};
