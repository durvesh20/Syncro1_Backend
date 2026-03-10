// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getPendingVerifications,
  verifyPartner,
  verifyCompany,
  // getPayouts,      // ❌ DISABLED - Payout system inactive
  // processPayout,   // ❌ DISABLED - Payout system inactive
  getUsers,
  updateUserStatus,
  getAnalytics
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('admin'));

// ==================== DASHBOARD & ANALYTICS ====================
router.get('/dashboard', getDashboard);
router.get('/analytics', getAnalytics);

// ==================== VERIFICATIONS ====================
router.get('/verifications', getPendingVerifications);
router.put('/verify/partner/:id', verifyPartner);
router.put('/verify/company/:id', verifyCompany);

// ==================== PAYOUT ROUTES - DISABLED ====================
// router.get('/payouts', getPayouts);
// router.put('/payouts/:id', processPayout);
// ========== Payout system is currently inactive ==========

// ==================== USER MANAGEMENT ====================
router.get('/users', getUsers);
router.put('/users/:id/status', updateUserStatus);

module.exports = router;