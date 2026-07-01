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
  createAdmin,

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
  assignJob,
  revokeJobAssignment,
  bulkAssignJobs,
  bulkRevokeJobs,

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
  updateJobStatusByAdmin,
  withdrawCandidateByAdmin,
  assignVerification,
  revokeVerificationAssignment,
  bulkAssignVerification,
  bulkRevokeVerificationAssignment
} = require('../controllers/adminController');

const {
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
  seedPlans
} = require('../controllers/adminPlanController');

const {
  protect,
  authorizeAdminAccess,
  authorize,
  checkPermission,
  checkAnyPermission
} = require('../middleware/auth');

const { PERMISSIONS } = require('../utils/permissions');

// Apply protection for admin CMS access
router.use(protect);
router.use(authorizeAdminAccess);

// ==================== DASHBOARD & ANALYTICS ====================
router.get(
  '/dashboard',
  checkAnyPermission([PERMISSIONS.VIEW_ADMIN_DASHBOARD, PERMISSIONS.VIEW_SUBADMIN_DASHBOARD]),
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
  getPendingVerifications
);

router.put(
  '/verify/partner/:id',
  verifyPartner
);

router.put(
  '/verify/company/:id',
  verifyCompany
);

router.put(
  '/verifications/:type/:id/assign',
  assignVerification
);

router.put(
  '/verifications/:type/:id/revoke',
  revokeVerificationAssignment
);

router.post(
  '/verifications/bulk-assign',
  bulkAssignVerification
);

router.post(
  '/verifications/bulk-revoke',
  bulkRevokeVerificationAssignment
);

// ==================== USER MANAGEMENT ====================
router.post(
  '/admins',
  authorize('admin'),
  createAdmin
);

router.get(
  '/users',
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

router.put(
  '/jobs/:id/assign',
  authorize('admin'),
  assignJob
);

router.put(
  '/jobs/:id/revoke',
  authorize('admin'),
  revokeJobAssignment
);

router.put(
  '/jobs/bulk-assign',
  authorize('admin'),
  bulkAssignJobs
);

router.put(
  '/jobs/bulk-revoke',
  authorize('admin'),
  bulkRevokeJobs
);

router.get(
  '/jobs/:id/edit-history',
  checkPermission(PERMISSIONS.VIEW_JOB_EDIT_HISTORY),
  getJobEditHistory
);

router.post(
  '/jobs/:id/discontinue',
  checkPermission(PERMISSIONS.UPDATE_JOB_STATUS),
  discontinueJob
);

router.put(
  '/jobs/:id/status',
  checkPermission(PERMISSIONS.UPDATE_JOB_STATUS),
  updateJobStatusByAdmin
);

// ==================== EDIT REQUESTS ====================
router.get(
  '/edit-requests/pending',
  getPendingEditRequests
);

router.get(
  '/edit-requests/:id',
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
  getAllJobs
);

router.get(
  '/jobs/:id/detail',
  getJobDetail
);

// All candidates
router.get(
  '/candidates',
  getAllCandidates
);

router.get(
  '/candidates/:id',
  getCandidateDetail
);

router.post(
  '/candidates/:id/notes',
  async (req, res) => {
    try {
      const Candidate = require('../models/Candidate');
      const Job = require('../models/Job');
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: 'Note content is required' });
      }

      const candidate = await Candidate.findById(req.params.id);
      if (!candidate) {
        return res.status(404).json({ success: false, message: 'Candidate not found' });
      }

      if (req.user.role === 'sub_admin') {
        const hasViewAll = req.user.permissions?.includes('VIEW_ALL_CANDIDATES');
        if (!hasViewAll) {
          const jobObj = await Job.findById(candidate.job?._id || candidate.job);
          if (!jobObj || !jobObj.assignedTo || jobObj.assignedTo.toString() !== req.user._id.toString()) {
            return res.status(403).json({
              success: false,
              message: 'You are not assigned to this candidate\'s job post. Access denied.'
            });
          }
        }
      }

      candidate.notes.push({
        content,
        addedBy: req.user._id,
        addedAt: new Date(),
        isInternal: true
      });

      await candidate.save();

      const updatedCandidate = await Candidate.findById(candidate._id)
        .populate('notes.addedBy', 'email role');

      res.json({
        success: true,
        message: 'Internal note added successfully',
        data: updatedCandidate.notes
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// All partners
router.get(
  '/partners',
  getAllPartners
);

router.get(
  '/partners/:id',
  getPartnerDetail
);

// All companies
router.get(
  '/companies',
  getAllCompanies
);

router.get(
  '/companies/:id',
  getCompanyDetail
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
  checkPermission(PERMISSIONS.VIEW_PAYOUTS),
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

// ==================== CANDIDATE QUEUE ====================

// @desc    Get all candidates pending admin review
// @route   GET /api/admin/candidates/queue
router.get(
  '/candidates/queue',
  async (req, res) => {
    try {
      const candidateQueueService = require('../services/candidateQueueService');
      const Job = require('../models/Job');

      const filters = {
        jobId: req.query.jobId,
        partnerId: req.query.partnerId,
        scoreMin: req.query.scoreMin
      };

      if (req.user.role === 'sub_admin') {
        const hasViewAll = req.user.permissions?.includes('VIEW_ALL_CANDIDATES');
        if (!hasViewAll) {
          const assignedJobs = await Job.find({ assignedTo: req.user._id }).select('_id');
          filters.assignedJobIds = assignedJobs.map(j => j._id);
        }
      }

      const candidates = await candidateQueueService.getAdminQueue(filters);

      res.json({
        success: true,
        data: {
          candidates,
          total: candidates.length,
          summary: {
            strongMatch: candidates.filter(
              c => c._queueMeta.score >= 80
            ).length,
            goodMatch: candidates.filter(
              c => c._queueMeta.score >= 60 && c._queueMeta.score < 80
            ).length,
            partialMatch: candidates.filter(
              c => c._queueMeta.score >= 40 && c._queueMeta.score < 60
            ).length,
            weakMatch: candidates.filter(
              c => c._queueMeta.score < 40
            ).length
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch candidate queue',
        error: error.message
      });
    }
  }
);

// @desc    Get single candidate in queue with full details
// @route   GET /api/admin/candidates/queue/:id
router.get(
  '/candidates/queue/:id',
  async (req, res) => {
    try {
      const Candidate = require('../models/Candidate');
      const Job = require('../models/Job');

      const candidate = await Candidate.findById(req.params.id)
        .populate('job', 'title category location experienceLevel salary skills')
        .populate('submittedBy', 'firmName firstName lastName uniqueId metrics')
        .populate('company', 'companyName kyc.industry')
        .populate('statusHistory.changedBy', 'email role')
        .populate('notes.addedBy', 'email role');

      if (!candidate) {
        return res.status(404).json({
          success: false,
          message: 'Candidate not found'
        });
      }

      if (req.user.role === 'sub_admin') {
        const hasViewAll = req.user.permissions?.includes('VIEW_ALL_CANDIDATES');
        if (!hasViewAll) {
          const jobObj = await Job.findById(candidate.job?._id || candidate.job);
          if (!jobObj || !jobObj.assignedTo || jobObj.assignedTo.toString() !== req.user._id.toString()) {
            return res.status(403).json({
              success: false,
              message: 'You are not assigned to this candidate\'s job post. Access denied.'
            });
          }
        }
      }

      res.json({
        success: true,
        data: {
          candidate,
          queueInfo: {
            score: candidate.resumeAnalysis?.profileScore || 0,
            matchLevel: candidate.resumeAnalysis?.matchLevel || 'UNKNOWN',
            recommendation: candidate.resumeAnalysis?.recommendation,
            breakdown: candidate.resumeAnalysis?.scoreBreakdown,
            flags: candidate.resumeAnalysis?.flags || [],
            advice: candidate.resumeAnalysis?.advice || [],
            aiParsedData: candidate.resumeAnalysis?.aiData,
            resumeParsed: candidate.resumeAnalysis?.parsed || false
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch candidate',
        error: error.message
      });
    }
  }
);

// @desc    Admin approves candidate → send to company
// @route   PUT /api/admin/candidates/queue/:id/approve
router.put(
  '/candidates/queue/:id/approve',
  async (req, res) => {
    try {
      const candidateQueueService = require('../services/candidateQueueService');
      const { notes } = req.body;

      const candidate = await candidateQueueService.approveCandidate(
        req.params.id,
        req.user._id,
        notes
      );

      res.json({
        success: true,
        message: 'Candidate approved and sent to company. Candidate notified.',
        data: {
          candidateId: candidate._id,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          status: candidate.status,
          approvedAt: candidate.adminQueue.reviewedAt
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to approve candidate',
        error: error.message
      });
    }
  }
);

// @desc    Admin rejects candidate → not sent to company
// @route   PUT /api/admin/candidates/queue/:id/reject
router.put(
  '/candidates/queue/:id/reject',
  async (req, res) => {
    try {
      const candidateQueueService = require('../services/candidateQueueService');
      const { reason } = req.body;

      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required (minimum 5 characters)'
        });
      }

      const candidate = await candidateQueueService.rejectCandidate(
        req.params.id,
        req.user._id,
        reason
      );

      res.json({
        success: true,
        message: 'Candidate rejected. Partner has been notified.',
        data: {
          candidateId: candidate._id,
          candidateName: `${candidate.firstName} ${candidate.lastName}`,
          status: candidate.status,
          rejectionReason: reason
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to reject candidate',
        error: error.message
      });
    }
  }
);

// @desc    Admin withdraws a submitted candidate at ANY pipeline stage
// @route   PUT /api/admin/candidates/:id/withdraw
router.put(
  '/candidates/:id/withdraw',
  withdrawCandidateByAdmin
);

// ==================== JOBS WITH CANDIDATES ====================

// All jobs with candidate counts and arrays
router.get(
  '/jobs-with-candidates',
  require('../controllers/adminController').getAllJobsWithCandidates
);

// Single job with all candidates
router.get(
  '/jobs/:id/candidates',
  require('../controllers/adminController').getJobWithCandidates
);

// ==================== SUBSCRIPTION PLANS ====================
router.get(
  '/plans',
  checkPermission(PERMISSIONS.MANAGE_PLANS),
  getAllPlans
);

router.post(
  '/plans',
  checkPermission(PERMISSIONS.MANAGE_PLANS),
  createPlan
);

router.put(
  '/plans/:id',
  checkPermission(PERMISSIONS.MANAGE_PLANS),
  updatePlan
);

router.delete(
  '/plans/:id',
  checkPermission(PERMISSIONS.MANAGE_PLANS),
  deletePlan
);




module.exports = router;