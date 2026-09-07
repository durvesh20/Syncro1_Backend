// backend/controllers/developerAuthController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ApiClient = require('../models/ApiClient');
const Integration = require('../models/Integration');
const Company = require('../models/Company');

const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

/**
 * Generate Developer JWT tokens
 */
const generateTokens = (client) => {
  const payload = {
    id: client._id,
    client_id: client.client_id,
    company_id: client.company_id,
    integration_id: client.integration_id,
    scopes: client.scopes,
    type: 'developer'
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN
  });

  const refreshToken = jwt.sign(
    { ...payload, token_type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );

  return { accessToken, refreshToken };
};

/**
 * @desc    Authenticate with client_id and client_secret
 * @route   POST /api/developer/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
  const { client_id, client_secret } = req.body;
  const requestId = req.requestId || null;

  if (!client_id || !client_secret) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'client_id and client_secret are required'
      },
      request_id: requestId
    });
  }

  try {
    const client = await ApiClient.findOne({ client_id });
    if (!client) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid client credentials'
        },
        request_id: requestId
      });
    }

    if (client.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'CREDENTIAL_REVOKED',
          message: 'This API key has been revoked'
        },
        request_id: requestId
      });
    }

    // Verify secret
    const isMatch = await bcrypt.compare(client_secret, client.client_secret_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid client credentials'
        },
        request_id: requestId
      });
    }

    // Verify Integration status
    const integration = await Integration.findById(client.integration_id);
    if (!integration || integration.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INTEGRATION_INACTIVE',
          message: 'Developer API access for this company is disabled or suspended'
        },
        request_id: requestId
      });
    }

    // Update last_used_at
    client.last_used_at = new Date();
    await client.save({ validateModifiedOnly: true });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(client);

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scopes: client.scopes,
        client_id: client.client_id,
        label: client.label
      },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer Auth Login Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error during authentication'
      },
      request_id: requestId
    });
  }
};

/**
 * @desc    Refresh Developer API access token
 * @route   POST /api/developer/auth/refresh
 * @access  Public
 */
exports.refresh = async (req, res) => {
  const { refresh_token } = req.body;
  const requestId = req.requestId || null;

  if (!refresh_token) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'refresh_token is required'
      },
      request_id: requestId
    });
  }

  try {
    const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
    if (decoded.type !== 'developer' || decoded.token_type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid refresh token'
        },
        request_id: requestId
      });
    }

    const client = await ApiClient.findOne({
      client_id: decoded.client_id,
      status: 'ACTIVE'
    });

    if (!client) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Client credentials not found or revoked'
        },
        request_id: requestId
      });
    }

    const integration = await Integration.findById(client.integration_id);
    if (!integration || integration.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INTEGRATION_INACTIVE',
          message: 'Developer API access is disabled or suspended'
        },
        request_id: requestId
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(client);

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: newRefreshToken,
        token_type: 'Bearer',
        expires_in: 3600
      },
      request_id: requestId
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Refresh token expired or invalid'
      },
      request_id: requestId
    });
  }
};

/**
 * @desc    Get current developer client context
 * @route   GET /api/developer/auth/me
 * @access  Developer Protected
 */
exports.me = async (req, res) => {
  const requestId = req.requestId || null;

  try {
    const client = await ApiClient.findOne({ client_id: req.developer.client_id });
    const company = await Company.findById(req.developer.company_id).select(
      'companyName legalName logo location industry website contact'
    );
    const integration = await Integration.findById(req.developer.integration_id);

    return res.status(200).json({
      success: true,
      data: {
        client: {
          client_id: client.client_id,
          label: client.label,
          scopes: client.scopes,
          status: client.status,
          last_used_at: client.last_used_at,
          created_at: client.created_at
        },
        company: company || null,
        integration: {
          status: integration?.status || 'INACTIVE',
          environment: integration?.environment || 'PRODUCTION',
          last_sync_at: integration?.last_sync_at || null,
          settings: integration?.settings || {}
        }
      },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer Auth Me Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve developer profile'
      },
      request_id: requestId
    });
  }
};

