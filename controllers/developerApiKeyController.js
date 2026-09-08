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
      .select('key_prefix key_hash client_id label environment scopes status last_used_at created_at')
      .sort({ created_at: -1 })
      .lean();

    const formattedKeys = (apiKeys || []).map((k) => {
      const prefix = k.key_prefix || (k.client_id ? k.client_id.slice(0, 16) : 'syncro_live_');
      return {
        ...k,
        id: k._id ? k._id.toString() : '',
        _id: k._id ? k._id.toString() : '',
        prefix: prefix,
        key_prefix: prefix,
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
