// backend/controllers/authController.js
const crypto = require('crypto');
const User = require('../models/User');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');
const generateToken = require('../utils/generateToken');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const otpService = require('../services/otpService');
const sendTokenResponse = require('../utils/sendTokenResponse');

// Check if we should skip mobile OTP (for development)
const skipMobileOTP = process.env.WHATSAPP_ENABLED !== 'true';

// @desc Register Staffing Partner - Step 1 (Basic Info + Send Verification)
// @route POST /api/auth/register/staffing-partner/init
exports.initStaffingPartnerRegistration = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      mobile,
      password,
      firmName,
      designation,
      linkedinProfile,
      city,
      state
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !mobile || !password || !firmName || !designation || !city || !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    // Validate password
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or mobile already exists'
      });
    }

    // Generate email verification token & mobile OTP
    const emailToken = crypto.randomBytes(32).toString('hex');
    const mobileOTP = otpService.generateOTP();

    // Create user with pending verification
    const user = await User.create({
      email,
      mobile,
      password,
      role: 'staffing_partner',
      status: 'PENDING_EMAIL_VERIFICATION',
      emailVerified: false,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 30 * 60 * 1000, // 30 min
      mobileOTP: {
        code: mobileOTP,
        expiresAt: otpService.getExpiryTime()
      },
      mobileVerified: skipMobileOTP
    });

    // Create staffing partner profile with registration fields only
    await StaffingPartner.create({
      user: user._id,
      firstName,
      lastName,
      firmName,
      designation,
      linkedinProfile: linkedinProfile || '',
      city,
      state,
      profileCompletion: { basicInfo: true }
    });

    // Send Email Verification Link
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken}`;
    await emailService.sendVerificationLink(email, verifyUrl);

    // Send Mobile OTP (or mock it)
    await whatsappService.sendOTP(mobile, mobileOTP);

    res.status(201).json({
      success: true,
      message: skipMobileOTP 
        ? 'Registration successful! Check your email for verification link. (Mobile OTP skipped in development)'
        : 'Registration successful! Check your email for verification link and verify your mobile.',
      data: {
        userId: user._id,
        email: user.email,
        mobile: user.mobile,
        skipMobileOTP,
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            emailToken,
            mobileOTP,
            verifyUrl,
            note: 'Tokens shown only in development mode'
          }
        })
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

// @desc Register Company - Step 1
// @route POST /api/auth/register/company/init
exports.initCompanyRegistration = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      mobile,
      password,
      companyName,
      designation,
      department,
      linkedinProfile,
      city,
      state
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !mobile || !password || !companyName || !designation || !department || !city || !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
        required: {
          firstName: !firstName ? 'missing' : 'ok',
          lastName: !lastName ? 'missing' : 'ok',
          email: !email ? 'missing' : 'ok',
          mobile: !mobile ? 'missing' : 'ok',
          password: !password ? 'missing' : 'ok',
          companyName: !companyName ? 'missing' : 'ok',
          designation: !designation ? 'missing' : 'ok',
          department: !department ? 'missing' : 'ok',
          city: !city ? 'missing' : 'ok',
          state: !state ? 'missing' : 'ok'
        }
      });
    }

    // Validate password
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or mobile already exists'
      });
    }

    // Generate email verification token & mobile OTP
    const emailToken = crypto.randomBytes(32).toString('hex');
    const mobileOTP = otpService.generateOTP();

    // Create user
    const user = await User.create({
      email,
      mobile,
      password,
      role: 'company',
      status: 'PENDING_EMAIL_VERIFICATION',
      emailVerified: false,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 30 * 60 * 1000,
      mobileOTP: {
        code: mobileOTP,
        expiresAt: otpService.getExpiryTime()
      },
      mobileVerified: skipMobileOTP
    });

    // Create company profile - combine firstName + lastName
    await Company.create({
      user: user._id,
      companyName,
      decisionMakerName: `${firstName} ${lastName}`,
      designation,
      department,
      linkedinProfile: linkedinProfile || '',
      city,
      state,
      profileCompletion: { basicInfo: true }
    });

    // Send email verification link
    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken}`;
    await emailService.sendVerificationLink(email, verifyUrl);

    // Send mobile OTP
    await whatsappService.sendOTP(mobile, mobileOTP);

    res.status(201).json({
      success: true,
      message: skipMobileOTP 
        ? 'Registration successful! Check your email for verification link.'
        : 'Registration successful! Check your email for verification link and verify your mobile.',
      data: {
        userId: user._id,
        email: user.email,
        mobile: user.mobile,
        skipMobileOTP,
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            emailToken,
            mobileOTP,
            verifyUrl,
            note: 'Tokens shown only in development mode'
          }
        })
      }
    });

  } catch (error) {
    console.error('Company registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

// @desc Verify Email via Token (from link)
// @route GET /api/auth/verify-email
exports.verifyEmailByToken = async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    // Find user by email verification token
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token'
      });
    }

    // Update user status
    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    
    // Update status based on mobile verification
    if (user.isMobileVerified) {
      user.status = 'VERIFIED';
    }
    
    await user.save();

    // ✅ CORRECT: Return JSON response
    return res.status(200).json({
      success: true,
      message: 'Email verified successfully! You can now login.',
      data: {
        emailVerified: true,
        status: user.status
      }
    });

  } catch (error) {
    console.error('Email verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Email verification failed'
    });
  }
};

// @desc Verify Mobile OTP
// @route POST /api/auth/verify/mobile
exports.verifyMobileOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If mobile OTP is skipped, auto-verify
    if (skipMobileOTP) {
      user.mobileVerified = true;
      user.mobileOTP = undefined;

      // Update status if both verified
      if (user.emailVerified) {
        user.status = 'ACTIVE';
      }

      await user.save();

      return res.json({
        success: true,
        message: 'Mobile auto-verified (WhatsApp disabled in development)',
        data: {
          emailVerified: user.emailVerified,
          mobileVerified: true,
          status: user.status
        }
      });
    }

    if (user.mobileVerified) {
      return res.status(400).json({
        success: false,
        message: 'Mobile already verified'
      });
    }

    const verification = user.verifyOTP('mobile', otp);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    user.mobileVerified = true;
    user.mobileOTP = undefined;

    // Update status if both verified
    if (user.emailVerified && user.mobileVerified) {
      user.status = 'ACTIVE';
    }

    await user.save();

    res.json({
      success: true,
      message: 'Mobile verified successfully',
      data: {
        emailVerified: user.emailVerified,
        mobileVerified: true,
        status: user.status
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: error.message
    });
  }
};

// @desc Login
// @route POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Find user
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check mobile verification
    if (!user.mobileVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your mobile number first',
        requiresVerification: 'mobile',
        userId: user._id
      });
    }

    // Check email verification
    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in. Check your inbox for the verification link.',
        requiresVerification: 'email',
        userId: user._id
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Get profile
    let profile = null;
    if (user.role === 'staffing_partner') {
      profile = await StaffingPartner.findOne({ user: user._id });
    } else if (user.role === 'company') {
      profile = await Company.findOne({ user: user._id });
    }

    // Generate token
    const token = generateToken(user._id, user.role);

    // Build user payload (no password)
    const userPayload = {
      id: user._id,
      email: user.email,
      role: user.role,
      status: user.status,
      isPasswordChanged: user.isPasswordChanged
    };

    // Send token in cookie
    return sendTokenResponse(res, token, userPayload, {
      profile,
      requirePasswordChange: !user.isPasswordChanged
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
};

// @desc Change Password (First Login / Force Change)
// @route POST /api/auth/change-password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validate
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current and new password'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New passwords do not match'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const user = await User.findById(req.user._id).select('+password');

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Check if new password is same as old
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    // Update password
    user.password = newPassword;
    user.isPasswordChanged = true;

    // Update status if it was PASSWORD_CHANGED or earlier
    if (['REGISTERED', 'PROFILE_INCOMPLETE'].includes(user.status)) {
      user.status = 'PASSWORD_CHANGED';
    }

    await user.save();

    // Generate new token
    const token = generateToken(user._id, user.role);

    // Refresh auth cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
      data: {
        status: user.status
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Password change failed',
      error: error.message
    });
  }
};

// @desc Resend OTP
// @route POST /api/auth/resend-otp
exports.resendOTP = async (req, res) => {
  try {
    const { userId, type } = req.body; // type: 'email' or 'mobile'

    if (!userId || !type) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId and type'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already verified
    if (type === 'email' && user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    if (type === 'mobile' && user.mobileVerified) {
      return res.status(400).json({
        success: false,
        message: 'Mobile already verified'
      });
    }

    if (type === 'email') {
      // Generate new email token
      const emailToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = emailToken;
      user.emailVerificationExpires = Date.now() + 30 * 60 * 1000;
      await user.save();

      const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken}`;
      await emailService.sendVerificationLink(user.email, verifyUrl);

      return res.json({
        success: true,
        message: 'Verification email sent',
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            emailToken,
            verifyUrl,
            note: 'Token shown only in development mode'
          }
        })
      });

    } else if (type === 'mobile') {
      const otp = otpService.generateOTP();
      user.mobileOTP = {
        code: otp,
        expiresAt: otpService.getExpiryTime()
      };
      await user.save();
      await whatsappService.sendOTP(user.mobile, otp);

      return res.json({
        success: true,
        message: 'OTP sent to your mobile',
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            otp,
            note: 'OTP shown only in development mode'
          }
        })
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: error.message
    });
  }
};

// @desc Resend Email Verification Link
// @route POST /api/auth/resend-email-verification
exports.resendEmailVerification = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    const emailToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = emailToken;
    user.emailVerificationExpires = Date.now() + 30 * 60 * 1000;

    await user.save();

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken}`;
    await emailService.sendVerificationLink(user.email, verifyUrl);

    res.json({
      success: true,
      message: 'Verification email resent. Please check your inbox.',
      ...(process.env.NODE_ENV === 'development' && {
        devInfo: { 
          emailToken,
          verifyUrl 
        }
      })
    });

  } catch (error) {
    console.error('Resend email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend verification email',
      error: error.message
    });
  }
};

// @desc Get Current User
// @route GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    let profile = null;
    if (user.role === 'staffing_partner') {
      profile = await StaffingPartner.findOne({ user: user._id });
    } else if (user.role === 'company') {
      profile = await Company.findOne({ user: user._id });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
          status: user.status,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified,
          isPasswordChanged: user.isPasswordChanged,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt
        },
        profile
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
};

// @desc Forgot Password
// @route POST /api/auth/forgot-password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if user exists
      return res.json({
        success: true,
        message: 'If an account exists with this email, you will receive a password reset OTP'
      });
    }

    const otp = otpService.generateOTP();
    user.emailOTP = {
      code: otp,
      expiresAt: otpService.getExpiryTime()
    };
    await user.save();

    await emailService.sendOTP(email, otp, 'reset');

    res.json({
      success: true,
      message: 'Password reset OTP sent to your email',
      data: { 
        userId: user._id,
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: { otp }
        })
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to process request',
      error: error.message
    });
  }
};

// @desc Reset Password
// @route POST /api/auth/reset-password
exports.resetPassword = async (req, res) => {
  try {
    const { userId, otp, newPassword, confirmPassword } = req.body;

    if (!userId || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match'
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const verification = user.verifyOTP('email', otp);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    user.password = newPassword;
    user.emailOTP = undefined;
    user.isPasswordChanged = true;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: error.message
    });
  }
};

// @desc Logout - Clear JWT cookie
// @route POST /api/auth/logout
exports.logout = async (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
};