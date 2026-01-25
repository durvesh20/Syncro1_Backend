// backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const {
  getPlans,
  createOrder,
  verifyPayment,
  getSubscriptions,
  getCurrentSubscription,
  mockActivatePlan
} = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/auth');

// Public route - view plans
router.get('/plans', getPlans);

// Protected routes
router.use(protect);
router.use(authorize('staffing_partner'));

router.post('/create-order', createOrder);
router.post('/verify', verifyPayment);
router.post('/mock-activate', mockActivatePlan); // Development only
router.get('/subscriptions', getSubscriptions);
router.get('/current', getCurrentSubscription);

module.exports = router;