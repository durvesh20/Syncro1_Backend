// backend/controllers/developerAuthController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const DeveloperAccount = require('../models/DeveloperAccount');
const Integration = require('../models/Integration');
const Company = require('../models/Company');

const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

/**
 * Generate Developer JWT tokens
 */
const generateTokens = (developerAccount) => {
  const payload = {
    id: developerAccount._id,
    email: developerAccount.email,
    company_id: developerAccount.company_id,
    integration_id: developerAccount.integration_id,
    type: 'developer_portal'
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
 * @desc    Authenticate developer portal login
 * @route   POST /api/developer/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
  const { email, password } = req.body;
  const requestId = req.requestId || null;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'email and password are required'
      },
      request_id: requestId
    });
  }

  try {
    const account = await DeveloperAccount.findOne({ email: email.toLowerCase().trim() });
    if (!account) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials'
        },
        request_id: requestId
      });
    }

    if (account.status !== 'ACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_INACTIVE',
          message: 'This account is inactive'
        },
        request_id: requestId
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, account.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials'
        },
        request_id: requestId
      });
    }

    // Verify Integration status
    const integration = await Integration.findById(account.integration_id);
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

    // Update last_login_at
    account.last_login_at = new Date();
    await account.save({ validateModifiedOnly: true });

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(account);

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        developer: {
          email: account.email,
          name: account.name
        }
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
 * @desc    Refresh Developer portal access token
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
    if (decoded.type !== 'developer_portal' || decoded.token_type !== 'refresh') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid refresh token'
        },
        request_id: requestId
      });
    }

    const account = await DeveloperAccount.findById(decoded.id);

    if (!account || account.status !== 'ACTIVE') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Account not found or inactive'
        },
        request_id: requestId
      });
    }

    const integration = await Integration.findById(account.integration_id);
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

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(account);

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
 * @desc    Get current developer profile
 * @route   GET /api/developer/auth/me
 * @access  Protected (Developer Portal)
 */
exports.me = async (req, res) => {
  const requestId = req.requestId || null;

  try {
    const company = await Company.findById(req.developer.company_id).select(
      'companyName legalName logo location industry website contact'
    );
    const integration = await Integration.findById(req.developer.integration_id);

    return res.status(200).json({
      success: true,
      data: {
        developer: {
          id: req.developer.id,
          email: req.developer.email,
          name: req.developer.name
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

/**
 * @desc    Change developer password
 * @route   POST /api/developer/auth/change-password
 * @access  Protected (Developer Portal)
 */
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  const requestId = req.requestId || null;

  if (!current_password || !new_password) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'current_password and new_password are required'
      },
      request_id: requestId
    });
  }

  try {
    const account = await DeveloperAccount.findById(req.developer.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Account not found'
        },
        request_id: requestId
      });
    }

    const isMatch = await bcrypt.compare(current_password, account.password_hash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Incorrect current password'
        },
        request_id: requestId
      });
    }

    const salt = await bcrypt.genSalt(10);
    account.password_hash = await bcrypt.hash(new_password, salt);
    await account.save();

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      request_id: requestId
    });
  } catch (error) {
    console.error('[Developer Auth Change Password Error]:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to change password'
      },
      request_id: requestId
    });
  }
};
