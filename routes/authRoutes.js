// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
  initStaffingPartnerRegistration,
  initCompanyRegistration,
  verifyEmailByToken,
  verifyMobileOTP,
  login,
  changePassword,
  resendOTP,
  resendEmailVerification,
  getMe,
  forgotPassword,
  resetPassword,
  logout,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Registration routes
router.post('/register/staffing-partner/init', initStaffingPartnerRegistration);
router.post('/register/company/init', initCompanyRegistration);

// Verification routes
router.get('/verify-email', verifyEmailByToken);
router.post('/verify/mobile', verifyMobileOTP);
router.post('/resend-otp', resendOTP);
router.post('/resend-email-verification', resendEmailVerification);

// Login & Password
router.post('/login', login);
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// User
router.get('/me', protect, getMe);

// Logout route
router.post('/logout', protect, logout);

module.exports = router;