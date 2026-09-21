// backend/controllers/developerApiKeyController.js
const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiClient = require('../models/ApiClient');

/**
 * @desc    List all API keys for the company
 * @route   GET /api/developer/auth/api-keys
 * @access  Protected (Developer Portal)
 */
exports.listApiKeys = async (req, res) => {
  const requestId = req.requestId || null;

  try {
    const apiKeys = await ApiClient.find({ company_id: req.developer.company_id })
      .select('api_key key_prefix key_hash client_id label environment scopes status last_used_at created_at')
      .sort({ created_at: -1 })
      .lean();

    const formattedKeys = (apiKeys || []).map((k) => {
      const prefix = k.key_prefix || (k.client_id ? k.client_id.slice(0, 16) : 'syncro_live_');
      const completeKey = k.api_key || null;
      return {
        ...k,
        id: k._id ? k._id.toString() : '',
        _id: k._id ? k._id.toString() : '',
        prefix: prefix,
        key_prefix: prefix,
        api_key: completeKey,
        key: completeKey,
        createdAt: k.created_at || null,
        created_at: k.created_at || null
      };
    });

    return res.status(200).json({
      success: true,
      data: { api_keys: formattedKeys },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer API Key List Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch API keys'
      },
      request_id: requestId
    });
  }
};

/**
 * @desc    Create a new API key
 * @route   POST /api/developer/auth/api-keys
 * @access  Protected (Developer Portal)
 */
exports.createApiKey = async (req, res) => {
  const { label, environment = 'PRODUCTION', scopes } = req.body;
  const requestId = req.requestId || null;

  try {
    const rawKey = crypto.randomBytes(32).toString('hex');
    const prefix = environment === 'SANDBOX' ? 'syncro_test_' : 'syncro_live_';
    const fullKey = prefix + rawKey;
    const keyPrefix = fullKey.substring(0, prefix.length + 8); // e.g., 'syncro_live_a1b2c3d4'
    const keyHash = crypto.createHash('sha256').update(fullKey).digest('hex');

    const defaultScopes = [
      'jobs:read', 'jobs:write', 'candidates:read', 'statuses:read',
      'statuses:write', 'interviews:read', 'interviews:write',
      'webhooks:read', 'webhooks:write', 'integration:read',
      'integration:write', 'logs:read'
    ];

    const newApiKey = await ApiClient.create({
      key_prefix: keyPrefix,
      key_hash: keyHash,
      api_key: fullKey,
      client_id: fullKey.substring(0, 24),
      integration_id: req.developer.integration_id,
      company_id: req.developer.company_id,
      label: label || 'New API Key',
      environment: environment,
      scopes: scopes || defaultScopes,
      created_by: req.developer.id
    });

    const keyId = newApiKey._id.toString();

    return res.status(201).json({
      success: true,
      message: 'Copy your API key now. It will not be shown again.',
      data: {
        id: keyId,
        _id: keyId,
        api_key: fullKey,
        key: fullKey,
        key_prefix: newApiKey.key_prefix,
        prefix: newApiKey.key_prefix,
        label: newApiKey.label,
        environment: newApiKey.environment,
        scopes: newApiKey.scopes,
        created_at: newApiKey.created_at,
        createdAt: newApiKey.created_at
      },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer API Key Create Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create API key'
      },
      request_id: requestId
    });
  }
};

/**
 * @desc    Revoke an API key
 * @route   DELETE /api/developer/auth/api-keys/:id
 * @access  Protected (Developer Portal)
 */
exports.revokeApiKey = async (req, res) => {
  const requestId = req.requestId || null;
  const keyId = req.params.id;

  if (!keyId || !mongoose.Types.ObjectId.isValid(keyId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_ID',
        message: 'Invalid API key ID format'
      },
      request_id: requestId
    });
  }

  try {
    const client = await ApiClient.findById(keyId);

    if (!client) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found'
        },
        request_id: requestId
      });
    }

    // Verify company ownership if company_id is present
    if (client.company_id && req.developer.company_id) {
      if (client.company_id.toString() !== req.developer.company_id.toString()) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to revoke this API key'
          },
          request_id: requestId
        });
      }
    }

    // Atomically update status to REVOKED without full-schema revalidation
    await ApiClient.updateOne(
      { _id: client._id },
      { $set: { status: 'REVOKED' } }
    );

    return res.status(200).json({
      success: true,
      message: 'API key revoked successfully',
      data: {
        id: client._id.toString(),
        status: 'REVOKED'
      },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer API Key Revoke Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to revoke API key'
      },
      request_id: requestId
    });
  }
};

/**
 * @desc    Activate or Deactivate an API key
 * @route   PATCH /api/developer/auth/api-keys/:id/status
 * @access  Protected (Developer Portal)
 */
exports.updateApiKeyStatus = async (req, res) => {
  const requestId = req.requestId || null;
  const keyId = req.params.id;
  const { status } = req.body;

  if (!keyId || !mongoose.Types.ObjectId.isValid(keyId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_ID',
        message: 'Invalid API key ID format'
      },
      request_id: requestId
    });
  }

  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STATUS',
        message: 'Status must be either ACTIVE or INACTIVE'
      },
      request_id: requestId
    });
  }

  try {
    const client = await ApiClient.findById(keyId);

    if (!client) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found'
        },
        request_id: requestId
      });
    }

    if (client.status === 'REVOKED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'KEY_REVOKED',
          message: 'Revoked API keys cannot be re-activated'
        },
        request_id: requestId
      });
    }

    if (client.company_id && req.developer.company_id) {
      if (client.company_id.toString() !== req.developer.company_id.toString()) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to modify this API key'
          },
          request_id: requestId
        });
      }
    }

    await ApiClient.updateOne(
      { _id: client._id },
      { $set: { status } }
    );

    return res.status(200).json({
      success: true,
      message: `API key has been ${status === 'ACTIVE' ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: client._id.toString(),
        _id: client._id.toString(),
        status: status,
        label: client.label
      },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer API Key Status Update Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to update API key status'
      },
      request_id: requestId
    });
  }
};

/**
 * @desc    Get request logs for a specific API key
 * @route   GET /api/developer/auth/api-keys/:id/logs
 * @access  Protected (Developer Portal)
 */
exports.getApiKeyLogs = async (req, res) => {
  const requestId = req.requestId || null;
  const keyId = req.params.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  if (!keyId || !mongoose.Types.ObjectId.isValid(keyId)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_ID',
        message: 'Invalid API key ID format'
      },
      request_id: requestId
    });
  }

  try {
    const client = await ApiClient.findById(keyId);

    if (!client) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found'
        },
        request_id: requestId
      });
    }

    if (client.company_id && req.developer.company_id) {
      if (client.company_id.toString() !== req.developer.company_id.toString()) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to view logs for this API key'
          },
          request_id: requestId
        });
      }
    }

    const ApiLog = require('../models/ApiLog');
    const query = {
      company_id: req.developer.company_id,
      $or: [
        { client_id: keyId },
        { client_id: client.client_id || '' }
      ]
    };

    const [logs, total] = await Promise.all([
      ApiLog.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
      ApiLog.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: {
        logs: (logs || []).map((l) => ({
          id: String(l._id),
          request_id: l.request_id,
          method: l.method,
          path: l.path,
          status_code: l.status_code,
          latency_ms: l.latency_ms,
          error_code: l.error_code,
          created_at: l.created_at,
          ip: l.ip
        })),
        key: {
          id: keyId,
          label: client.label,
          prefix: client.key_prefix,
          status: client.status
        }
      },
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer API Key Logs Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'Failed to fetch API key logs'
      },
      request_id: requestId
    });
  }
};
