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
  getJobEditHistory
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

// ==================== PAYOUT ROUTES - DISABLED ====================
// router.get('/payouts', getPayouts);
// router.put('/payouts/:id', processPayout);
// ========== Payout system is currently inactive ==========

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