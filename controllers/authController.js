// backend/controllers/authController.js
const User = require('../models/User');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');
const generateToken = require('../utils/generateToken');
const { generateTempPassword } = require('../utils/generatePassword');
const emailService = require('../services/emailService');
const whatsappService = require('../services/whatsappService');
const otpService = require('../services/otpService');
const sendTokenResponse = require('../utils/sendTokenResponse');

// Check if we should skip mobile OTP (for development)
const skipMobileOTP = process.env.WHATSAPP_ENABLED !== 'true';

// backend/controllers/authController.js

// @desc    Register Staffing Partner - Step 1 (Basic Info + Send OTPs)
// @route   POST /api/auth/register/staffing-partner/init
exports.initStaffingPartnerRegistration = async (req, res) => {
  try {
    const { 
      firstName, 
      lastName, 
      email, 
      mobile, 
      firmName,
      designation,
      linkedinProfile, 
      city, 
      state 
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !mobile || !firmName || !designation || !city || !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields'
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

    // Generate OTPs
    const emailOTP = otpService.generateOTP();
    const mobileOTP = otpService.generateOTP();

    // Create user with pending verification
    const tempPassword = generateTempPassword();
    const user = await User.create({
      email,
      mobile,
      password: tempPassword,
      role: 'staffing_partner',
      status: 'REGISTERED',
      emailOTP: {
        code: emailOTP,
        expiresAt: otpService.getExpiryTime()
      },
      mobileOTP: {
        code: mobileOTP,
        expiresAt: otpService.getExpiryTime()
      },
      tempPassword,
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

    // Send Email OTP
    await emailService.sendOTP(email, emailOTP);

    // Send Mobile OTP (or mock it)
    await whatsappService.sendOTP(mobile, mobileOTP);

    res.status(201).json({
      success: true,
      message: skipMobileOTP 
        ? 'Registration initiated. Please verify your email. (Mobile OTP skipped in development)'
        : 'Registration initiated. Please verify your email and mobile.',
      data: {
        userId: user._id,
        email: user.email,
        mobile: user.mobile,
        skipMobileOTP,
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            emailOTP,
            mobileOTP,
            note: 'OTPs shown only in development mode'
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

// @desc    Verify Email OTP
// @route   POST /api/auth/verify/email
exports.verifyEmailOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

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

    const verification = user.verifyOTP('email', otp);
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    user.emailVerified = true;
    user.emailOTP = undefined;
    await user.save();

    // Check if both verifications are complete
    const bothVerified = user.emailVerified && user.mobileVerified;

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: {
        emailVerified: true,
        mobileVerified: user.mobileVerified,
        bothVerified,
        canProceed: bothVerified
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

// @desc    Verify Mobile OTP
// @route   POST /api/auth/verify/mobile
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
      await user.save();

      return res.json({
        success: true,
        message: 'Mobile auto-verified (WhatsApp disabled in development)',
        data: {
          emailVerified: user.emailVerified,
          mobileVerified: true,
          bothVerified: user.emailVerified,
          canProceed: user.emailVerified
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
    await user.save();

    const bothVerified = user.emailVerified && user.mobileVerified;

    res.json({
      success: true,
      message: 'Mobile verified successfully',
      data: {
        emailVerified: user.emailVerified,
        mobileVerified: true,
        bothVerified,
        canProceed: bothVerified
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

// @desc    Complete Registration (after OTPs verified)
// @route   POST /api/auth/register/complete
exports.completeRegistration = async (req, res) => {
  try {
    const { userId } = req.body;

    const user = await User.findById(userId).select('+tempPassword');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (!user.emailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Please verify your email first'
      });
    }

    // In development with WhatsApp disabled, skip mobile verification check
    if (!skipMobileOTP && !user.mobileVerified) {
      return res.status(400).json({
        success: false,
        message: 'Please verify your mobile first'
      });
    }

    // Get profile based on role
    let profile;
    let name;
    if (user.role === 'staffing_partner') {
      profile = await StaffingPartner.findOne({ user: user._id });
      name = `${profile.firstName} ${profile.lastName}`;
    } else if (user.role === 'company') {
      profile = await Company.findOne({ user: user._id });
      name = profile.decisionMakerName;
    }

    // Store temp password before clearing
    const tempPasswordToSend = user.tempPassword;

    // Update status
    user.status = 'PROFILE_INCOMPLETE';
    user.tempPassword = undefined;
    await user.save();

    // Send temporary password email
    await emailService.sendTempPassword(user.email, tempPasswordToSend, name);

    res.json({
      success: true,
      message: 'Registration complete. Temporary password sent to your email.',
      data: {
        email: user.email,
        // In development, show temp password for easy testing
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            tempPassword: tempPasswordToSend,
            note: 'Temp password shown only in development mode'
          }
        })
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Registration completion failed',
      error: error.message
    });
  }
};

// @desc    Login
// @route   POST /api/auth/login
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

// @desc    Change Password (First Login / Force Change)
// @route   POST /api/auth/change-password
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

// @desc    Resend OTP
// @route   POST /api/auth/resend-otp
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

    const otp = otpService.generateOTP();
    
    if (type === 'email') {
      user.emailOTP = {
        code: otp,
        expiresAt: otpService.getExpiryTime()
      };
      await user.save();
      await emailService.sendOTP(user.email, otp);
    } else if (type === 'mobile') {
      user.mobileOTP = {
        code: otp,
        expiresAt: otpService.getExpiryTime()
      };
      await user.save();
      await whatsappService.sendOTP(user.mobile, otp);
    }

    res.json({
      success: true,
      message: `OTP sent to your ${type}`,
      // In development, return OTP for testing
      ...(process.env.NODE_ENV === 'development' && {
        devInfo: {
          otp,
          note: 'OTP shown only in development mode'
        }
      })
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: error.message
    });
  }
};

// @desc    Get Current User
// @route   GET /api/auth/me
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

// @desc    Register Company - Step 1
// @route   POST /api/auth/register/company/init
exports.initCompanyRegistration = async (req, res) => {
  try {
    const { 
      firstName,           
      lastName,            
      email, 
      mobile,
      companyName,         
      designation,         
      department,          
      linkedinProfile, 
      city, 
      state 
    } = req.body;

    // ✅ FIXED: Validate form fields (NOT decisionMakerName)
    if (!firstName || !lastName || !email || !mobile || !companyName || !designation || !department || !city || !state) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields',
        required: {
          firstName: !firstName ? 'missing' : 'ok',
          lastName: !lastName ? 'missing' : 'ok',
          email: !email ? 'missing' : 'ok',
          mobile: !mobile ? 'missing' : 'ok',
          companyName: !companyName ? 'missing' : 'ok',
          designation: !designation ? 'missing' : 'ok',
          department: !department ? 'missing' : 'ok',
          city: !city ? 'missing' : 'ok',
          state: !state ? 'missing' : 'ok'
        }
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

    // Generate OTPs
    const emailOTP = otpService.generateOTP();
    const mobileOTP = otpService.generateOTP();

    // Create user
    const tempPassword = generateTempPassword();
    const user = await User.create({
      email,
      mobile,
      password: tempPassword,
      role: 'company',
      status: 'REGISTERED',
      emailOTP: {
        code: emailOTP,
        expiresAt: otpService.getExpiryTime()
      },
      mobileOTP: {
        code: mobileOTP,
        expiresAt: otpService.getExpiryTime()
      },
      tempPassword,
      mobileVerified: skipMobileOTP
    });

    // ✅ Create company profile - combine firstName + lastName
    await Company.create({
      user: user._id,
      companyName,
      decisionMakerName: `${firstName} ${lastName}`,  // ✅ Combine names
      designation,
      department,
      linkedinProfile: linkedinProfile || '',
      city,
      state,
      profileCompletion: { basicInfo: true }
    });

    // Send OTPs
    await emailService.sendOTP(email, emailOTP);
    await whatsappService.sendOTP(mobile, mobileOTP);

    res.status(201).json({
      success: true,
      message: skipMobileOTP 
        ? 'Registration initiated. Please verify your email.'
        : 'Registration initiated. Please verify your email and mobile.',
      data: {
        userId: user._id,
        email: user.email,
        mobile: user.mobile,
        skipMobileOTP,
        ...(process.env.NODE_ENV === 'development' && {
          devInfo: {
            emailOTP,
            mobileOTP,
            note: 'OTPs shown only in development mode'
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

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
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

// @desc    Reset Password
// @route   POST /api/auth/reset-password
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

// @desc    Logout - Clear JWT cookie
// @route   POST /api/auth/logout
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


