// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();

const {
  initStaffingPartnerRegistration,
  initCompanyRegistration,
  verifyEmailByToken,     // Legacy GET support
  verifyEmail,            // Recommended POST
  getVerificationStatus,
  verifyMobileOTP,
  resendOTP,              // Legacy combined resend
  resendEmailVerification,
  resendMobileOTP,
  login,
  changePassword,
  getMe,
  forgotPassword,
  resetPassword,
  logout
} = require('../controllers/authController');

const { protect } = require('../middleware/auth');

// ==================== REGISTRATION ====================
router.post('/register/staffing-partner/init', initStaffingPartnerRegistration);
router.post('/register/company/init', initCompanyRegistration);

// ==================== VERIFICATION ====================

// Legacy GET route for email verification from link
router.get('/verify-email', verifyEmailByToken);

// Recommended POST route for frontend-driven verification
router.post('/verify-email', verifyEmail);

// Mobile OTP verify
router.post('/verify/mobile', verifyMobileOTP);

// Verification status
router.get('/verification-status/:userId', getVerificationStatus);

// Resend routes
router.post('/resend-otp', resendOTP); // legacy
router.post('/resend-email-verification', resendEmailVerification);
router.post('/resend-mobile-otp', resendMobileOTP);

// ==================== AUTH ====================
router.post('/login', login);
router.post('/logout', protect, logout);

// ==================== PASSWORD ====================
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// ==================== USER ====================
router.get('/me', protect, getMe);

module.exports = router;