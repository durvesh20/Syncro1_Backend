// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();

const {
  // Dashboard & Analytics
  getDashboard,
  getPendingVerifications,
  verifyPartner,
  verifyCompany,
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

  // Payout management
  getPayouts,
  getPayout,
  approvePayout,
  processPayout,
  holdPayout,
  releasePayout,
  forfeitPayout,
  checkPayoutEligibility
} = require('../controllers/adminController');

const {
  protect,
  authorizeAdminAccess,
  checkPermission
} = require('../middleware/auth');

const { PERMISSIONS } = require('../utils/permissions');

// Apply protection for admin CMS access
router.use(protect);
router.use(authorizeAdminAccess);

// ==================== DASHBOARD & ANALYTICS ====================
router.get(
  '/dashboard',
  checkPermission(PERMISSIONS.VIEW_ADMIN_DASHBOARD),
  getDashboard
);

router.get(
  '/analytics',
  checkPermission(PERMISSIONS.VIEW_ANALYTICS),
  getAnalytics
);

// ==================== VERIFICATIONS ====================
router.get(
  '/verifications',
  checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
  getPendingVerifications
);

// NOTE:
// verifyPartner / verifyCompany currently use action in req.body (approve/reject)
// We will add action-based permission checks inside controller in next step if needed.
router.put(
  '/verify/partner/:id',
  checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
  verifyPartner
);

router.put(
  '/verify/company/:id',
  checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
  verifyCompany
);

// ==================== USER MANAGEMENT ====================
router.get(
  '/users',
  checkPermission(PERMISSIONS.VIEW_USERS),
  getUsers
);

router.put(
  '/users/:id/status',
  checkPermission(PERMISSIONS.UPDATE_USER_STATUS),
  updateUserStatus
);

// ==================== JOB APPROVAL ====================
router.get(
  '/jobs/pending',
  checkPermission(PERMISSIONS.VIEW_PENDING_JOBS),
  getPendingJobs
);

router.put(
  '/jobs/:id/approve',
  checkPermission(PERMISSIONS.APPROVE_JOB),
  approveJob
);

router.put(
  '/jobs/:id/reject',
  checkPermission(PERMISSIONS.REJECT_JOB),
  rejectJob
);

router.get(
  '/jobs/:id/edit-history',
  checkPermission(PERMISSIONS.VIEW_JOB_EDIT_HISTORY),
  getJobEditHistory
);

router.post(
  '/jobs/:id/discontinue',
  checkPermission(PERMISSIONS.DISCONTINUE_JOB),
  discontinueJob
);

// ==================== EDIT REQUESTS ====================
router.get(
  '/edit-requests/pending',
  checkPermission(PERMISSIONS.VIEW_EDIT_REQUESTS),
  getPendingEditRequests
);

router.get(
  '/edit-requests/:id',
  checkPermission(PERMISSIONS.VIEW_EDIT_REQUEST_DETAILS),
  getEditRequest
);

router.put(
  '/edit-requests/:id/approve',
  checkPermission(PERMISSIONS.APPROVE_EDIT_REQUEST),
  approveEditRequest
);

router.put(
  '/edit-requests/:id/reject',
  checkPermission(PERMISSIONS.REJECT_EDIT_REQUEST),
  rejectEditRequest
);

// ==================== PAYOUT MANAGEMENT ====================
router.get(
  '/payouts',
  checkPermission(PERMISSIONS.VIEW_PAYOUTS),
  getPayouts
);

router.get(
  '/payouts/:id',
  checkPermission(PERMISSIONS.VIEW_PAYOUT_DETAILS),
  getPayout
);

router.put(
  '/payouts/:id/approve',
  checkPermission(PERMISSIONS.APPROVE_PAYOUT),
  approvePayout
);

router.put(
  '/payouts/:id/process',
  checkPermission(PERMISSIONS.PROCESS_PAYOUT),
  processPayout
);

router.put(
  '/payouts/:id/hold',
  checkPermission(PERMISSIONS.HOLD_PAYOUT),
  holdPayout
);

router.put(
  '/payouts/:id/release',
  checkPermission(PERMISSIONS.RELEASE_PAYOUT),
  releasePayout
);

router.post(
  '/payouts/:id/forfeit',
  checkPermission(PERMISSIONS.FORFEIT_PAYOUT),
  forfeitPayout
);

router.post(
  '/payouts/check-eligibility',
  checkPermission(PERMISSIONS.RUN_PAYOUT_ELIGIBILITY),
  checkPayoutEligibility
);

module.exports = router;