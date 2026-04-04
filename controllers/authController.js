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
const { validateEmail, validateMobile } = require('../utils/validators');

// Check if we should skip mobile OTP (for development)
const skipMobileOTP = process.env.WHATSAPP_ENABLED !== 'true';

/**
 * Helper: determine verification state for frontend
 */
const getVerificationState = (user) => {
  if (!user.emailVerified && !user.mobileVerified) {
    return {
      canLogin: false,
      nextStep: 'VERIFY_CONTACTS',
      allowedActions: [
        'RESEND_EMAIL_VERIFICATION',
        'RESEND_MOBILE_OTP',
        'CHECK_VERIFICATION_STATUS'
      ]
    };
  }

  if (!user.emailVerified) {
    return {
      canLogin: false,
      nextStep: 'VERIFY_EMAIL',
      allowedActions: [
        'RESEND_EMAIL_VERIFICATION',
        'CHECK_VERIFICATION_STATUS'
      ]
    };
  }

  if (!user.mobileVerified) {
    return {
      canLogin: false,
      nextStep: 'VERIFY_MOBILE',
      allowedActions: [
        'RESEND_MOBILE_OTP',
        'CHECK_VERIFICATION_STATUS'
      ]
    };
  }

  return {
    canLogin: true,
    nextStep: 'LOGIN',
    allowedActions: []
  };
};

/**
 * Helper: set user status based on verification state
 */
const syncUserStatusAfterVerification = (user) => {
  if (user.emailVerified && user.mobileVerified) {
    user.status = 'ACTIVE';
  } else {
    user.status = 'PENDING_EMAIL_VERIFICATION';
  }
};

/**
 * Helper: get onboarding next step after successful login
 */
const getPostLoginNextStep = async (user) => {
  let profile = null;

  if (user.role === 'staffing_partner') {
    profile = await StaffingPartner.findOne({ user: user._id });
  } else if (user.role === 'company') {
    profile = await Company.findOne({ user: user._id });
  }

  if (!profile) {
    return {
      profile,
      profileMeta: {
        completionPercentage: 0,
        verificationStatus: 'PENDING'
      },
      nextStep: 'COMPLETE_PROFILE'
    };
  }

  const completion = profile.profileCompletion || {};
  const total = Object.keys(completion).length || 1;
  const completed = Object.values(completion).filter(Boolean).length;
  const completionPercentage = Math.round((completed / total) * 100);

  let nextStep = 'COMPLETE_PROFILE';

  if (completionPercentage < 100) {
    nextStep = 'COMPLETE_PROFILE';
  } else if (['PENDING', 'UNDER_REVIEW'].includes(profile.verificationStatus)) {
    nextStep = 'WAITING_APPROVAL';
  } else if (profile.verificationStatus === 'REJECTED') {
    nextStep = 'PROFILE_REJECTED';
  } else if (profile.verificationStatus === 'APPROVED') {
    nextStep = 'GO_TO_DASHBOARD';
  }

  return {
    profile,
    profileMeta: {
      completionPercentage,
      verificationStatus: profile.verificationStatus
    },
    nextStep
  };
};

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

    if (!firstName || !lastName || !email || !mobile || !password || !firmName || !designation || !city || !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (!validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number. Please provide 10-digit number'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { mobile: normalizedMobile }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or mobile already exists'
      });
    }

    const existingFirm = await StaffingPartner.findOne({
      firmName: new RegExp(`^${firmName.trim()}$`, 'i')
    });

    if (existingFirm) {
      return res.status(400).json({
        success: false,
        message: 'A firm with this name is already registered'
      });
    }

    const emailToken = crypto.randomBytes(32).toString('hex');
    const mobileOTP = otpService.generateOTP();

    const user = await User.create({
      email: normalizedEmail,
      mobile: normalizedMobile,
      password,
      role: 'staffing_partner',
      status: 'PENDING_EMAIL_VERIFICATION',
      emailVerified: false,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      mobileOTP: {
        code: mobileOTP,
        expiresAt: otpService.getExpiryTime()
      },
      mobileVerified: skipMobileOTP,
      isPasswordChanged: true
    });

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

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken}`;
    await emailService.sendVerificationLink(normalizedEmail, verifyUrl);
    await whatsappService.sendOTP(normalizedMobile, mobileOTP);

    const verificationState = getVerificationState(user);

    res.status(201).json({
      success: true,
      message: skipMobileOTP
        ? 'Registration successful. Please verify your email. Mobile OTP skipped in development.'
        : 'Registration successful. Please verify your email and mobile.',
      data: {
        userId: user._id,
        role: user.role,
        email: user.email,
        mobile: user.mobile,
        verification: {
          emailRequired: true,
          mobileRequired: !skipMobileOTP,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        },
        canLogin: verificationState.canLogin,
        nextStep: verificationState.nextStep,
        allowedActions: verificationState.allowedActions,
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
    console.error('Staffing partner registration error:', error);
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

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (!validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number. Please provide 10-digit number'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { mobile: normalizedMobile }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or mobile already exists'
      });
    }

    const emailToken = crypto.randomBytes(32).toString('hex');
    const mobileOTP = otpService.generateOTP();

    const user = await User.create({
      email: normalizedEmail,
      mobile: normalizedMobile,
      password,
      role: 'company',
      status: 'PENDING_EMAIL_VERIFICATION',
      emailVerified: false,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      mobileOTP: {
        code: mobileOTP,
        expiresAt: otpService.getExpiryTime()
      },
      mobileVerified: skipMobileOTP,
      isPasswordChanged: true
    });
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

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailToken}`;
    await emailService.sendVerificationLink(normalizedEmail, verifyUrl);
    await whatsappService.sendOTP(normalizedMobile, mobileOTP);

    const verificationState = getVerificationState(user);

    res.status(201).json({
      success: true,
      message: skipMobileOTP
        ? 'Registration successful. Please verify your email. Mobile OTP skipped in development.'
        : 'Registration successful. Please verify your email and mobile.',
      data: {
        userId: user._id,
        role: user.role,
        email: user.email,
        mobile: user.mobile,
        verification: {
          emailRequired: true,
          mobileRequired: !skipMobileOTP,
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        },
        canLogin: verificationState.canLogin,
        nextStep: verificationState.nextStep,
        allowedActions: verificationState.allowedActions,
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

// @desc Verify Email via Token (Legacy GET route support)
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

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
        code: 'INVALID_OR_EXPIRED_TOKEN'
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    syncUserStatusAfterVerification(user);
    await user.save();

    const verificationState = getVerificationState(user);

    return res.status(200).json({
      success: true,
      message: verificationState.canLogin
        ? 'Email verified successfully. You can now login.'
        : 'Email verified successfully. Please complete remaining verification.',
      data: {
        verification: {
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        },
        status: user.status,
        canLogin: verificationState.canLogin,
        nextStep: verificationState.nextStep,
        allowedActions: verificationState.allowedActions
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Email verification failed',
      error: error.message
    });
  }
};

// @desc Verify Email via Token (Recommended POST route)
// @route POST /api/auth/verify-email
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification token',
        code: 'INVALID_OR_EXPIRED_TOKEN'
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    syncUserStatusAfterVerification(user);
    await user.save();

    const verificationState = getVerificationState(user);

    return res.status(200).json({
      success: true,
      message: verificationState.canLogin
        ? 'Email verified successfully. You can now login.'
        : 'Email verified successfully. Please complete remaining verification.',
      data: {
        verification: {
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        },
        status: user.status,
        canLogin: verificationState.canLogin,
        nextStep: verificationState.nextStep,
        allowedActions: verificationState.allowedActions
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'Email verification failed',
      error: error.message
    });
  }
};

// @desc Get Verification Status
// @route GET /api/auth/verification-status/:userId
exports.getVerificationStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select(
      'email mobile role status emailVerified mobileVerified'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const verificationState = getVerificationState(user);

    res.json({
      success: true,
      data: {
        userId: user._id,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        verification: {
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        },
        canLogin: verificationState.canLogin,
        nextStep: verificationState.nextStep,
        allowedActions: verificationState.allowedActions
      }
    });
  } catch (error) {
    console.error('Verification status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verification status',
      error: error.message
    });
  }
};

// @desc Verify Mobile OTP
// @route POST /api/auth/verify/mobile
exports.verifyMobileOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide userId and otp'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (skipMobileOTP) {
      user.mobileVerified = true;
      user.mobileOTP = undefined;
      syncUserStatusAfterVerification(user);
      await user.save();

      const verificationState = getVerificationState(user);

      return res.json({
        success: true,
        message: verificationState.canLogin
          ? 'Mobile verified successfully. You can now login.'
          : 'Mobile verified successfully. Please verify your email to continue.',
        data: {
          verification: {
            emailVerified: user.emailVerified,
            mobileVerified: user.mobileVerified
          },
          status: user.status,
          canLogin: verificationState.canLogin,
          nextStep: verificationState.nextStep,
          allowedActions: verificationState.allowedActions
        }
      });
    }

    if (user.mobileVerified) {
      return res.status(400).json({
        success: false,
        message: 'Mobile already verified'
      });
    }

    if (user.otpAttempts && user.otpAttempts.mobile >= 5) {
      const timeSinceLastAttempt = Date.now() - new Date(user.otpAttempts.lastAttempt).getTime();
      if (timeSinceLastAttempt < 3600000) {
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please try again after 1 hour.'
        });
      }
    }

    const verification = user.verifyOTP('mobile', otp);
    if (!verification.valid) {
      user.otpAttempts = user.otpAttempts || { email: 0, mobile: 0 };
      user.otpAttempts.mobile += 1;
      user.otpAttempts.lastAttempt = new Date();
      await user.save();

      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    user.otpAttempts = user.otpAttempts || { email: 0, mobile: 0 };
    user.otpAttempts.mobile = 0;
    user.mobileVerified = true;
    user.mobileOTP = undefined;

    syncUserStatusAfterVerification(user);
    await user.save();

    const verificationState = getVerificationState(user);

    res.json({
      success: true,
      message: verificationState.canLogin
        ? 'Mobile verified successfully. You can now login.'
        : 'Mobile verified successfully. Please verify your email to continue.',
      data: {
        verification: {
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified
        },
        status: user.status,
        canLogin: verificationState.canLogin,
        nextStep: verificationState.nextStep,
        allowedActions: verificationState.allowedActions
      }
    });
  } catch (error) {
    console.error('Mobile verification error:', error);
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

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    if (!user.emailVerified && !user.mobileVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email and mobile number before logging in.',
        code: 'CONTACTS_NOT_VERIFIED',
        data: {
          userId: user._id,
          verification: {
            emailVerified: false,
            mobileVerified: false
          },
          canLogin: false,
          nextStep: 'VERIFY_CONTACTS',
          allowedActions: [
            'RESEND_EMAIL_VERIFICATION',
            'RESEND_MOBILE_OTP',
            'CHECK_VERIFICATION_STATUS'
          ]
        }
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in.',
        code: 'EMAIL_NOT_VERIFIED',
        data: {
          userId: user._id,
          verification: {
            emailVerified: false,
            mobileVerified: true
          },
          canLogin: false,
          nextStep: 'VERIFY_EMAIL',
          allowedActions: [
            'RESEND_EMAIL_VERIFICATION',
            'CHECK_VERIFICATION_STATUS'
          ]
        }
      });
    }

    if (!user.mobileVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your mobile number before logging in.',
        code: 'MOBILE_NOT_VERIFIED',
        data: {
          userId: user._id,
          verification: {
            emailVerified: true,
            mobileVerified: false
          },
          canLogin: false,
          nextStep: 'VERIFY_MOBILE',
          allowedActions: [
            'RESEND_MOBILE_OTP',
            'CHECK_VERIFICATION_STATUS'
          ]
        }
      });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended. Please contact support.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }

    if (user.status === 'REJECTED') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been rejected.',
        code: 'ACCOUNT_REJECTED'
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const { profile, profileMeta, nextStep } = await getPostLoginNextStep(user);

    const token = generateToken(user._id, user.role);

    const userPayload = {
      id: user._id,
      email: user.email,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      mobileVerified: user.mobileVerified,
      isPasswordChanged: user.isPasswordChanged
    };

    return sendTokenResponse(res, token, userPayload, {
      profile,
      profileMeta,
      canLogin: true,
      nextStep
    });
  } catch (error) {
    console.error('Login error:', error);
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

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password, new password, and confirm password'
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

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    user.password = newPassword;
    user.isPasswordChanged = true;
    await user.save();

    const token = generateToken(user._id, user.role);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SECURE === 'true' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({
      success: true,
      message: 'Password changed successfully',
      data: {
        status: user.status
      }
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password change failed',
      error: error.message
    });
  }
};

// @desc Resend OTP (legacy email/mobile combined)
// @route POST /api/auth/resend-otp
exports.resendOTP = async (req, res) => {
  try {
    const { userId, type } = req.body;

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

    if (type === 'email') {
      if (user.emailVerified) {
        return res.status(400).json({
          success: false,
          message: 'Email already verified'
        });
      }

      const emailToken = crypto.randomBytes(32).toString('hex');
      user.emailVerificationToken = emailToken;
      user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
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
    }

    if (type === 'mobile') {
      if (user.mobileVerified) {
        return res.status(400).json({
          success: false,
          message: 'Mobile already verified'
        });
      }

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

    return res.status(400).json({
      success: false,
      message: 'Invalid type. Use "email" or "mobile"'
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
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
    user.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
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

// @desc Resend Mobile OTP
// @route POST /api/auth/resend-mobile-otp
exports.resendMobileOTP = async (req, res) => {
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

    if (user.mobileVerified) {
      return res.status(400).json({
        success: false,
        message: 'Mobile already verified'
      });
    }

    const otp = otpService.generateOTP();
    user.mobileOTP = {
      code: otp,
      expiresAt: otpService.getExpiryTime()
    };
    await user.save();

    await whatsappService.sendOTP(user.mobile, otp);

    res.json({
      success: true,
      message: 'Mobile OTP resent successfully.',
      ...(process.env.NODE_ENV === 'development' && {
        devInfo: {
          otp
        }
      })
    });
  } catch (error) {
    console.error('Resend mobile OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend mobile OTP',
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

    const { profileMeta, nextStep } = await getPostLoginNextStep(user);

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
        profile,
        profileMeta,
        nextStep
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
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

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
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

    await emailService.sendOTP(user.email, otp, 'reset');

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
    console.error('Forgot password error:', error);
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

    if (!userId || !otp || !newPassword || !confirmPassword) {
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

    const user = await User.findById(userId).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.otpAttempts && user.otpAttempts.email >= 5) {
      const timeSinceLastAttempt = Date.now() - new Date(user.otpAttempts.lastAttempt).getTime();
      if (timeSinceLastAttempt < 3600000) {
        return res.status(400).json({
          success: false,
          message: 'Too many failed attempts. Please try again after 1 hour.'
        });
      }
    }

    const verification = user.verifyOTP('email', otp);
    if (!verification.valid) {
      user.otpAttempts = user.otpAttempts || { email: 0, mobile: 0 };
      user.otpAttempts.email += 1;
      user.otpAttempts.lastAttempt = new Date();
      await user.save();

      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    user.otpAttempts = user.otpAttempts || { email: 0, mobile: 0 };
    user.otpAttempts.email = 0;
    user.password = newPassword;
    user.emailOTP = undefined;
    user.isPasswordChanged = true;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
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
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SECURE === 'true' ? 'none' : 'lax',
    path: '/'
  });

  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};