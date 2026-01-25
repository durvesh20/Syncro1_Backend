// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const {
  initStaffingPartnerRegistration,
  initCompanyRegistration,
  verifyEmailOTP,
  verifyMobileOTP,
  completeRegistration,
  login,
  changePassword,
  resendOTP,
  getMe,
  forgotPassword,
  resetPassword,
  logout, // <-- added logout here
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Registration routes
router.post('/register/staffing-partner/init', initStaffingPartnerRegistration);
router.post('/register/company/init', initCompanyRegistration);
router.post('/verify/email', verifyEmailOTP);
router.post('/verify/mobile', verifyMobileOTP);
router.post('/register/complete', completeRegistration);
router.post('/resend-otp', resendOTP);

// Login & Password
router.post('/login', login);
router.post('/change-password', protect, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// User
router.get('/me', protect, getMe);

// Logout route
router.post('/logout', protect, logout); // <-- added logout endpoint

module.exports = router;
