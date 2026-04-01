// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const {
  // Dashboard & Analytics
  getDashboard,
  getPendingVerifications,
  verifyPartner,
  verifyCompany,
  // getPayouts,      // ❌ DISABLED - Payout system inactive
  // processPayout,   // ❌ DISABLED - Payout system inactive
  getUsers,
  updateUserStatus,
  getAnalytics,

  // Job Approval Workflow
  getPendingJobs,
  approveJob,
  rejectJob,
  getPendingEditRequests,
  getEditRequest,
  approveEditRequest,
  rejectEditRequest,
  discontinueJob,
  getJobEditHistory,
  // ✅ NEW: Payout management
  getPayouts,
  getPayout,
  approvePayout,
  processPayout,
  holdPayout,
  releasePayout,
  forfeitPayout,
  checkPayoutEligibility


} = require('../controllers/adminController');

const { protect, authorize } = require('../middleware/auth');

// Apply admin auth middleware
router.use(protect);
router.use(authorize('admin'));

// ==================== DASHBOARD & ANALYTICS ====================
router.get('/dashboard', getDashboard);
router.get('/analytics', getAnalytics);

// ==================== VERIFICATIONS ====================
router.get('/verifications', getPendingVerifications);
router.put('/verify/partner/:id', verifyPartner);
router.put('/verify/company/:id', verifyCompany);

// ==================== PAYOUT MANAGEMENT  ====================
router.get('/payouts', getPayouts);
router.get('/payouts/:id', getPayout);
router.put('/payouts/:id/approve', approvePayout);
router.put('/payouts/:id/process', processPayout);
router.put('/payouts/:id/hold', holdPayout);
router.put('/payouts/:id/release', releasePayout);
router.post('/payouts/:id/forfeit', forfeitPayout);
router.post('/payouts/check-eligibility', checkPayoutEligibility);

// ==================== USER MANAGEMENT ====================
router.get('/users', getUsers);
router.put('/users/:id/status', updateUserStatus);

// ==================== JOB APPROVAL ====================
router.get('/jobs/pending', getPendingJobs);
router.put('/jobs/:id/approve', approveJob);
router.put('/jobs/:id/reject', rejectJob);
router.get('/jobs/:id/edit-history', getJobEditHistory);

// ==================== EDIT REQUESTS ====================
router.get('/edit-requests/pending', getPendingEditRequests);
router.get('/edit-requests/:id', getEditRequest);
router.put('/edit-requests/:id/approve', approveEditRequest);
router.put('/edit-requests/:id/reject', rejectEditRequest);

// ==================== JOB DISCONTINUATION ====================
router.post('/jobs/:id/discontinue', discontinueJob);

module.exports = router;