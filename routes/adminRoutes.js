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
  checkPayoutEligibility,

  // NEW
  getAllJobs,
  getJobDetail,
  getAllCandidates,
  getCandidateDetail,
  getAllPartners,
  getPartnerDetail,
  getAllCompanies,
  getCompanyDetail,
  getAuditLogs
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

// ==================== REGISTRY ROUTES ====================

// All jobs
router.get(
  '/jobs',
  checkPermission(PERMISSIONS.VIEW_ALL_JOBS),
  getAllJobs
);

router.get(
  '/jobs/:id/detail',
  checkPermission(PERMISSIONS.VIEW_ALL_JOBS),
  getJobDetail
);

// All candidates
router.get(
  '/candidates',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  getAllCandidates
);

router.get(
  '/candidates/:id',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  getCandidateDetail
);

// All partners
router.get(
  '/partners',
  checkPermission(PERMISSIONS.VIEW_ALL_PARTNERS),
  getAllPartners
);

router.get(
  '/partners/:id',
  checkPermission(PERMISSIONS.VIEW_ALL_PARTNERS),
  getPartnerDetail
);

// All companies
router.get(
  '/companies',
  checkPermission(PERMISSIONS.VIEW_ALL_COMPANIES),
  getAllCompanies
);

router.get(
  '/companies/:id',
  checkPermission(PERMISSIONS.VIEW_ALL_COMPANIES),
  getCompanyDetail
);

// Audit logs
router.get(
  '/audit-logs',
  checkPermission(PERMISSIONS.VIEW_AUDIT_LOGS),
  getAuditLogs
);

// Agreement queries via admin
router.get(
  '/agreement-queries',
  checkPermission(PERMISSIONS.VIEW_AGREEMENT_QUERIES),
  async (req, res) => {
    try {
      const AgreementQuery = require('../models/AgreementQuery');
      const { status, page = 1, limit = 20 } = req.query;

      const query = {};
      if (status) query.status = status;

      const sanitizedPage = Math.max(1, parseInt(page));
      const sanitizedLimit = Math.min(50, Math.max(1, parseInt(limit)));
      const skip = (sanitizedPage - 1) * sanitizedLimit;

      const [queries, total] = await Promise.all([
        AgreementQuery.find(query)
          .populate({ path: 'partner', select: 'firstName lastName firmName' })
          .populate('user', 'email mobile')
          .populate('respondedBy', 'email role')
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(sanitizedLimit),
        AgreementQuery.countDocuments(query)
      ]);

      const summary = await AgreementQuery.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);

      res.json({
        success: true,
        data: {
          queries,
          summary: summary.reduce((acc, item) => {
            acc[item._id] = item.count;
            return acc;
          }, {}),
          pagination: {
            current: sanitizedPage,
            pages: Math.ceil(total / sanitizedLimit),
            total
          }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
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

// WhatsApp test route — Admin only
router.post('/whatsapp/test', async (req, res) => {
  try {
    const { phone, type = 'otp' } = req.body;
    const whatsappService = require('../services/whatsappService');

    let result;

    switch (type) {
      case 'otp':
        result = await whatsappService.sendOTP(phone, '123456');
        break;
      case 'connection':
        result = await whatsappService.testConnection();
        break;
      case 'profile_verified':
        result = await whatsappService.sendProfileVerified(phone, 'Test Partner');
        break;
      default:
        result = await whatsappService.sendOTP(phone, '123456');
    }

    res.json({
      success: true,
      message: 'WhatsApp test executed',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});



module.exports = router;