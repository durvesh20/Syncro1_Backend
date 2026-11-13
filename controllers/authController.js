// backend/controllers/authController.js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');
const generateToken = require('../utils/generateToken');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const otpService = require('../services/otpService');
const sendTokenResponse = require('../utils/sendTokenResponse');
const notifyCRM = require('../utils/notifyCRM')
const auditService = require('../services/auditService');
const { validateEmail, validateMobile, isWorkEmail } = require('../utils/validators');

// Check if we should skip mobile OTP (for development)
const skipMobileOTP = process.env.WHATSAPP_ENABLED !== 'true';

/**
 * Helper: determine verification state for frontend
 */
const getVerificationState = (user) => {
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
  // For talent_partner and company, keep their onboarding lifecycle status
  if (user.role === 'talent_partner' || user.role === 'company') {
    return;
  }
  if (user.emailVerified) {
    user.status = 'ACTIVE';
  } else {
    user.status = 'PENDING_EMAIL_VERIFICATION';
  }
};

/**
 * Helper: get onboarding next step after successful login
 */
const getPostLoginNextStep = async (user) => {
  // If user has not changed their temporary password, password change is mandatory first
  if (user.isPasswordChanged === false || user.status === 'TEMP_PASS_SENT') {
    return {
      profile: null,
      profileMeta: {
        completionPercentage: 0,
        verificationStatus: 'PENDING'
      },
      nextStep: 'CHANGE_PASSWORD'
    };
  }

  // Admin and sub_admin go straight to dashboard
  if (user.role === 'admin' || user.role === 'sub_admin') {
    return {
      profile: null,
      profileMeta: {
        completionPercentage: 100,
        verificationStatus: 'APPROVED'
      },
      nextStep: 'GO_TO_DASHBOARD'
    };
  }

  let profile = null;

  if (user.role === 'talent_partner') {
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

  const completion = profile.profileCompletion ? (profile.profileCompletion.toObject ? profile.profileCompletion.toObject() : { ...profile.profileCompletion }) : {};
  if (!user.emailVerified || !user.mobileVerified) {
    completion.basicInfo = false;
  }
  const total = Object.keys(completion).filter(k => !k.startsWith('$') && k !== '_id' && k !== 'id').length || 1;
  const completed = Object.keys(completion).filter(k => !k.startsWith('$') && k !== '_id' && k !== 'id').filter(k => !!completion[k]).length;
  const completionPercentage = Math.round((completed / total) * 100);

  let nextStep = 'COMPLETE_PROFILE';

  if (completionPercentage < 100) {
    nextStep = 'COMPLETE_PROFILE';
  } else if (['PENDING', 'UNDER_REVIEW'].includes(profile.verificationStatus)) {
    nextStep = 'WAITING_APPROVAL';
  } else if (profile.verificationStatus === 'REJECTED') {
    nextStep = 'PROFILE_REJECTED';
  } else if (profile.verificationStatus === 'APPROVED' || profile.verificationStatus === 'ACTIVE') {
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

// @desc Register Talent Partner - Step 1 (Basic Info + Send Verification)
// @route POST /api/auth/register/talent-partner/init
exports.initTalentPartnerRegistration = async (req, res) => {
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
      state,
      termsAccepted,
      termsAgreed
    } = req.body;

    // Check & log Terms & MSA Agreement (Date/Time & True/False status)
    const isTermsAgreed = termsAccepted === true || termsAgreed === true || termsAccepted === 'true' || termsAgreed === 'true';
    const agreementTimestamp = new Date().toISOString();
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    console.log(`[Terms & MSA Agreement Log] [${agreementTimestamp}] Role: TALENT_PARTNER | Email: ${email} | Terms Agreed: ${isTermsAgreed} | IP: ${clientIp}`);

    if (!isTermsAgreed) {
      console.warn(`[Terms & MSA Agreement Log] [${agreementTimestamp}] Registration rejected: Terms not accepted (termsAgreed=false) for email: ${email}`);
      return res.status(400).json({
        success: false,
        message: 'You must agree to the Terms of Service & Master Service Agreement to register.'
      });
    }

    if (!firstName || !lastName || !email || !mobile || !firmName) {
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

    const passwordToUse = password && password.length >= 8 ? password : crypto.randomBytes(16).toString('hex');

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "An account with this email address already exists. Please sign in or use a different email."
      });
    }

    const existingMobile = await User.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(400).json({
        success: false,
        message: "An account with this mobile number already exists. Please sign in or use a different mobile number."
      });
    }

    // Custom domain check: only one talent partner allowed per custom domain
    const domain = normalizedEmail.split('@')[1];
    const genericEmailDomains = new Set([
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
      'icloud.com', 'zoho.com', 'protonmail.com', 'yandex.com', 'proton.me',
      'mail.com', 'gmx.com', 'live.com', 'msn.com'
    ]);
    if (!genericEmailDomains.has(domain)) {
      const domainExists = await User.findOne({
        role: 'talent_partner',
        email: new RegExp(`@${domain}$`, 'i')
      });
      if (domainExists) {
        return res.status(400).json({
          success: false,
          message: `The email domain ${domain} is already registered by another Talent partner.`
        });
      }
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

    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: passwordToUse,
      role: 'talent_partner',
      status: 'REGISTERED',
      emailVerified: false,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      mobileVerified: false,
      isPasswordChanged: false
    });

    const partner = await StaffingPartner.create({
      user: user._id,
      firstName,
      lastName,
      firmName,
      designation: designation || '',
      linkedinProfile: linkedinProfile || '',
      city: city || '',
      state: state || '',
      profileCompletion: {
        basicInfo: false,
        firmDetails: false,
        Syncro1Competency: false,
        geographicReach: false,
        compliance: false,
        commercialDetails: false,
        documents: false
      }
    });

    // ── CRM: Partner Registered ───────────────────────────────
    notifyCRM({
      name: `${firstName} ${lastName}`,
      email: normalizedEmail,
      phone: normalizedMobile,
      whatsapp: normalizedMobile,
      company: firmName,
      designation: designation || '',
      city: city || '',
      state: state || '',
      type: 'TALENT_PARTNER',
      channel: 'PLATFORM_REGISTRATION',
      crmStatus: 'NEW',
      crmSubStatus: 'JUST_REGISTERED',
      profileCompletion: {
        basicInfo: false,
        firmDetails: false,
        Syncro1Competency: false,
        geographicReach: false,
        compliance: false,
        commercialDetails: false,
        documents: false
      },
      profilePercent: 0,
      journeyEvent: {
        type: 'PLATFORM_REGISTERED',
        channel: 'PLATFORM_REGISTRATION',
        description: `Talent Partner registered: ${firmName}`,
        data: {
          partnerId: partner._id.toString(),
          userId: user._id.toString(),
          firmName,
          plan: 'FREE'
        }
      },
      platformRef: {
        type: 'StaffingPartner',
        entityId: partner._id.toString(),
        userId: user._id.toString(),
        registeredAt: new Date()
      }
    });
    // ─────────────────────────────────────────────────────────

    res.status(201).json({
      success: true,
      message: 'Thank you for reaching out to us! We’re glad to connect with you. Our team will get in touch within 24–48 hours to understand your needs and guide you through the next steps.',
      data: {
        userId: user._id,
        role: user.role,
        email: user.email,
        mobile: user.mobile,
        firmName,
        name: `${firstName} ${lastName}`
      }
    });
  } catch (error) {
    console.error('Talent Partner registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

exports.initStaffingPartnerRegistration = exports.initTalentPartnerRegistration;

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
      state,
      termsAccepted,
      termsAgreed
    } = req.body;

    // Check & log Terms & MSA Agreement (Date/Time & True/False status)
    const isTermsAgreed = termsAccepted === true || termsAgreed === true || termsAccepted === 'true' || termsAgreed === 'true';
    const agreementTimestamp = new Date().toISOString();
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    console.log(`[Terms & MSA Agreement Log] [${agreementTimestamp}] Role: COMPANY | Email: ${email} | Terms Agreed: ${isTermsAgreed} | IP: ${clientIp}`);

    if (!isTermsAgreed) {
      console.warn(`[Terms & MSA Agreement Log] [${agreementTimestamp}] Registration rejected: Terms not accepted (termsAgreed=false) for email: ${email}`);
      return res.status(400).json({
        success: false,
        message: 'You must agree to the Terms of Service & Master Service Agreement to register.'
      });
    }

    if (!firstName || !lastName || !email || !mobile || !companyName) {
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

    if (!isWorkEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please use an official company work email address.'
      });
    }

    if (!validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number. Please provide 10-digit number'
      });
    }
    const passwordToUse = password && password.length >= 8 ? password : crypto.randomBytes(16).toString('hex');

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "An account with this work email already exists. Please sign in or use a different email."
      });
    }

    const existingMobile = await User.findOne({ mobile: normalizedMobile });
    if (existingMobile) {
      return res.status(400).json({
        success: false,
        message: "An account with this mobile number already exists. Please sign in or use a different mobile number."
      });
    }

    const emailToken = crypto.randomBytes(32).toString('hex');

    const user = await User.create({
      firstName,
      lastName,
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: passwordToUse,
      role: 'company',
      status: 'REGISTERED',
      emailVerified: false,
      emailVerificationToken: emailToken,
      emailVerificationExpires: Date.now() + 24 * 60 * 60 * 1000,
      mobileVerified: false,
      isPasswordChanged: false
    });
    const company = await Company.create({
      user: user._id,
      companyName,
      decisionMakerName: `${firstName} ${lastName}`,
      designation: designation || '',
      department: department || '',
      linkedinProfile: linkedinProfile || '',
      city: city || '',
      state: state || '',
      profileCompletion: {
        basicInfo: false,
        kyc: false,
        hiringPreferences: false,
        billing: false,
        legalConsents: false,
        documents: false
      }
    });

    // ── CRM: Company Registered ───────────────────────────────
    notifyCRM({
      name: `${firstName} ${lastName}`,
      email: normalizedEmail,
      phone: normalizedMobile,
      whatsapp: normalizedMobile,
      company: companyName,
      designation: designation || '',
      city: city || '',
      state: state || '',
      type: 'COMPANY',
      channel: 'PLATFORM_REGISTRATION',
      crmStatus: 'NEW',
      crmSubStatus: 'JUST_REGISTERED',
      profileCompletion: {
        basicInfo: false,
        kyc: false,
        hiringPreferences: false,
        billing: false,
        legalConsents: false,
        documents: false
      },
      profilePercent: 0,
      journeyEvent: {
        type: 'PLATFORM_REGISTERED',
        channel: 'PLATFORM_REGISTRATION',
        description: `Company registered: ${companyName}`,
        data: {
          companyId: company._id.toString(),
          userId: user._id.toString(),
          companyName
        }
      },
      platformRef: {
        type: 'Company',
        entityId: company._id.toString(),
        userId: user._id.toString(),
        registeredAt: new Date()
      }
    });
    // ─────────────────────────────────────────────────────────

    res.status(201).json({
      success: true,
      message: 'Thank you for reaching out to us! We’re glad to connect with you. Our team will get in touch within 24–48 hours to understand your needs and guide you through the next steps.',
      data: {
        userId: user._id,
        role: user.role,
        email: user.email,
        mobile: user.mobile,
        companyName,
        name: `${firstName} ${lastName}`
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
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    syncUserStatusAfterVerification(user);
    await user.save();

    // ── CRM: Email Verified ───────────────────────────────────
    if (user.role === 'talent_partner') {
      notifyCRM.partnerEmailVerified(user)
    } else if (user.role === 'company') {
      notifyCRM.companyEmailVerified(user)
    }
    // ─────────────────────────────────────────────────────────

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
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    syncUserStatusAfterVerification(user);
    await user.save();

    // ── CRM: Email Verified ───────────────────────────────────
    if (user.role === 'talent_partner') {
      notifyCRM.partnerEmailVerified(user)
    } else if (user.role === 'company') {
      notifyCRM.companyEmailVerified(user)
    }
    // ─────────────────────────────────────────────────────────

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
      user.mobileVerifiedAt = new Date();
      user.mobileOTP = undefined;
      syncUserStatusAfterVerification(user);
      await user.save();

      // ── CRM: Mobile Verified ──────────────────────────────────
      if (user.mobileVerified && user.emailVerified) {
        if (user.role === 'talent_partner') {
          notifyCRM.partnerMobileVerified(user)
        } else if (user.role === 'company') {
          notifyCRM.companyMobileVerified(user)
        }
      }
      // ─────────────────────────────────────────────────────────

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
    user.mobileVerifiedAt = new Date();
    user.mobileOTP = undefined;

    syncUserStatusAfterVerification(user);
    await user.save();

    // ── CRM: Mobile Verified ──────────────────────────────────
    if (user.mobileVerified && user.emailVerified) {
      if (user.role === 'talent_partner') {
        notifyCRM.partnerMobileVerified(user)
      } else if (user.role === 'company') {
        notifyCRM.companyMobileVerified(user)
      }
    }
    // ─────────────────────────────────────────────────────────

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

    let isMatch = false;
    try {
      isMatch = await user.comparePassword(password);
      if (!isMatch && typeof password === 'string' && password.trim() !== password) {
        isMatch = await user.comparePassword(password.trim());
      }
    } catch (e) {
      isMatch = false;
    }

    // Self-healing fallback: If user.password in DB was saved as plain text from previous hook issue
    if (!isMatch && user.password && (user.password === password || user.password === (typeof password === 'string' ? password.trim() : password))) {
      isMatch = true;
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(typeof password === 'string' ? password.trim() : password, salt);
      await user.save();
    }

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const isInitialFlow = user.isPasswordChanged === false ||
      ['TEMP_PASS_SENT', 'PASS_CHANGED', 'ONBOARDING_UNDERPROGRESS'].includes(user.status);

    if (!user.emailVerified && !isInitialFlow) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in.',
        code: 'EMAIL_NOT_VERIFIED',
        data: {
          userId: user._id,
          verification: {
            emailVerified: false,
            mobileVerified: user.mobileVerified
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

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        message: 'Your account is suspended. Please contact support.',
        code: 'ACCOUNT_SUSPENDED'
      });
    }



    if (user.role === 'staffing' || user.role === 'staffing_partner') {
      user.role = 'talent_partner';
    }
    user.lastLogin = new Date();
    await user.save();

    const isTempPassword = user.isPasswordChanged === false || user.status === 'TEMP_PASS_SENT';
    const { profile, profileMeta, nextStep } = await getPostLoginNextStep(user);

    // Self-healing: if in pre-onboarding / Step 1 and email was never legitimately verified via token, keep emailVerified false
    // Self-heal: If user is talent_partner or company and status is 'ACTIVE', but profile is not approved, correct to 'ONBOARDING_UNDERPROGRESS'
    if (['talent_partner', 'company'].includes(user.role) && user.status === 'ACTIVE') {
      const isApproved = profile && ['APPROVED', 'VERIFIED'].includes(profile.verificationStatus);
      if (!isApproved) {
        user.status = 'ONBOARDING_UNDERPROGRESS';
        await User.updateOne({ _id: user._id }, { $set: { status: 'ONBOARDING_UNDERPROGRESS' } });
      }
    }

    const isPreOnboarding = ['REGISTERED', 'TEMP_PASS_SENT', 'PASS_CHANGED'].includes(user.status) ||
      (!profile?.profileCompletion?.basicInfo && user.status === 'ONBOARDING_UNDERPROGRESS');

    if (isPreOnboarding && !user.emailVerifiedAt && user.emailVerified) {
      user.emailVerified = false;
      await User.updateOne({ _id: user._id }, { $set: { emailVerified: false } });
    }

    const token = generateToken(user._id, user.role);

    const userPayload = {
      id: user._id,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: user.permissions || [],
      emailVerified: user.emailVerified,
      mobileVerified: user.mobileVerified,
      isPasswordChanged: user.isPasswordChanged,
      createdBy: user.createdBy,
      firstName: user.firstName,
      lastName: user.lastName
    };

    return sendTokenResponse(res, token, userPayload, {
      profile,
      profileMeta,
      requirePasswordChange: isTempPassword,
      canLogin: !isTempPassword,
      nextStep: isTempPassword ? 'CHANGE_PASSWORD' : nextStep
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

    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isFirstTimeTempPassword = user.isPasswordChanged === false || user.status === 'TEMP_PASS_SENT';

    if (!newPassword || !confirmPassword || (!currentPassword && !isFirstTimeTempPassword)) {
      return res.status(400).json({
        success: false,
        message: isFirstTimeTempPassword
          ? 'Please provide new password and confirm password'
          : 'Please provide current password, new password, and confirm password'
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

    if (currentPassword) {
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }
    }

    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from current password'
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.isPasswordChanged = true;
    user.passwordChangedAt = new Date();
    user.status = 'PASS_CHANGED';

    // On password change during onboarding, ensure email is not auto-marked as verified unless verified via token
    if (isFirstTimeTempPassword && !user.emailVerifiedAt) {
      user.emailVerified = false;
    }

    await user.save();

    await auditService.log({
      actor: user._id,
      actorRole: user.role || 'user',
      actorEmail: user.email,
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: user._id,
      description: `User successfully changed password, status transitioned to PASS_CHANGED`,
      after: { status: 'PASS_CHANGED', isPasswordChanged: true },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const token = generateToken(user._id, user.role);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SECURE === 'true' ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    const { profile, profileMeta, nextStep } = await getPostLoginNextStep(user);

    const userPayload = {
      id: user._id,
      email: user.email,
      role: user.role,
      status: user.status,
      permissions: user.permissions || [],
      emailVerified: user.emailVerified,
      mobileVerified: user.mobileVerified,
      isPasswordChanged: true,
      createdBy: user.createdBy,
      firstName: user.firstName,
      lastName: user.lastName
    };

    res.json({
      success: true,
      message: 'Password changed successfully',
      data: {
        token,
        user: userPayload,
        profile,
        profileMeta,
        nextStep,
        status: user.status,
        isPasswordChanged: true
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
      if (user.emailVerified && user.emailVerifiedAt) {
        return res.status(400).json({
          success: false,
          message: 'Email already verified'
        });
      }

      if (user.emailVerified && !user.emailVerifiedAt) {
        user.emailVerified = false;
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
      // ✅ Use user.mobile (already in DB) and otp (just generated above)
      await whatsappService.sendOTP(user.mobile, otp, {
        action: 'creating',
        platform: 'Syncro1',
        merchantName: 'Syncro1',
        supportContact: process.env.SUPPORT_PHONE || '+919920468129'
      });
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

    if (user.emailVerified && user.emailVerifiedAt) {
      return res.status(400).json({
        success: false,
        message: 'Email already verified'
      });
    }

    if (user.emailVerified && !user.emailVerifiedAt) {
      user.emailVerified = false;
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
    // ✅ Use user.mobile (already in DB) and otp (just generated above)
    await whatsappService.sendOTP(user.mobile, otp, {
      action: 'creating',
      platform: 'Syncro1',
      merchantName: 'Syncro1',
      supportContact: process.env.SUPPORT_PHONE || '+919920468129'
    });
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

    if (user && (user.role === 'staffing' || user.role === 'staffing_partner')) {
      user.role = 'talent_partner';
      await user.save();
    }

    let profile = null;
    if (user.role === 'talent_partner') {
      profile = await StaffingPartner.findOne({ user: user._id });
    } else if (user.role === 'company') {
      profile = await Company.findOne({ user: user._id });
    }

    const { profileMeta, nextStep } = await getPostLoginNextStep(user);

    // Self-healing: if in pre-onboarding / Step 1 and email was never legitimately verified via token, ensure emailVerified is false
    // Self-heal: If user is talent_partner or company and status is 'ACTIVE', but profile is not approved, correct to 'ONBOARDING_UNDERPROGRESS'
    if (['talent_partner', 'company'].includes(user.role) && user.status === 'ACTIVE') {
      const isApproved = profile && ['APPROVED', 'VERIFIED'].includes(profile.verificationStatus);
      if (!isApproved) {
        user.status = 'ONBOARDING_UNDERPROGRESS';
        await User.updateOne({ _id: user._id }, { $set: { status: 'ONBOARDING_UNDERPROGRESS' } });
      }
    }

    const isPreOnboarding = ['REGISTERED', 'TEMP_PASS_SENT', 'PASS_CHANGED'].includes(user.status) ||
      (!profile?.profileCompletion?.basicInfo && user.status === 'ONBOARDING_UNDERPROGRESS');

    if (isPreOnboarding && !user.emailVerifiedAt && user.emailVerified) {
      user.emailVerified = false;
      await User.updateOne({ _id: user._id }, { $set: { emailVerified: false } });
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
          permissions: user.permissions || [],
          emailVerified: user.emailVerified,
          mobileVerified: user.mobileVerified,
          isPasswordChanged: user.isPasswordChanged,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          createdBy: user.createdBy,
          firstName: user.firstName,
          lastName: user.lastName
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

// @desc Register Lead (Talent Partner or Company)
// @route POST /api/auth/register-lead
exports.registerLead = async (req, res, next) => {
  try {
    const { type, workEmail, email, phoneNumber, mobile } = req.body;
    if (workEmail && !email) req.body.email = workEmail;
    if (phoneNumber && !mobile) req.body.mobile = phoneNumber;

    if (type === 'talent-partner' || type === 'talent_partner') {
      return exports.initTalentPartnerRegistration(req, res, next);
    }
    return exports.initCompanyRegistration(req, res, next);
  } catch (error) {
    console.error('Register lead error:', error);
    return res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};