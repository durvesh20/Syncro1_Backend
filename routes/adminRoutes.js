// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getPendingVerifications,
  verifyPartner,
  verifyCompany,
  getPayouts,
  processPayout,
  getUsers,
  updateUserStatus,
  getAnalytics
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);
router.use(authorize('admin'));

router.get('/dashboard', getDashboard);
router.get('/verifications', getPendingVerifications);
router.put('/verify/partner/:id', verifyPartner);
router.put('/verify/company/:id', verifyCompany);
router.get('/payouts', getPayouts);
router.put('/payouts/:id', processPayout);
router.get('/users', getUsers);
router.put('/users/:id/status', updateUserStatus);
router.get('/analytics', getAnalytics);

module.exports = router;