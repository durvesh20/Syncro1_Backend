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
  getAuditLogs,
  updateJobStatusByAdmin,
  withdrawCandidateByAdmin
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
router.post(
  '/admins',
  authorize('admin'),
  createAdmin
);

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

router.put(
  '/jobs/:id/status',
  checkAnyPermission([PERMISSIONS.APPROVE_JOB, PERMISSIONS.DISCONTINUE_JOB]),
  updateJobStatusByAdmin
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

// Get all AI scoring logs for a candidate application
router.get(
  '/scoring-logs/:applicationId',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  async (req, res) => {
    try {
      const ScoringLog = require('../models/ScoringLog');
      const logs = await ScoringLog.find({ applicationId: req.params.applicationId })
        .sort({ createdAt: -1 });

      res.json({
        success: true,
        data: logs
      });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

router.post(
  '/candidates/:id/notes',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  async (req, res) => {
    try {
      const Candidate = require('../models/Candidate');
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ success: false, message: 'Note content is required' });
      }

      const candidate = await Candidate.findById(req.params.id);
      if (!candidate) {
        return res.status(404).json({ success: false, message: 'Candidate not found' });
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

// ==================== CANDIDATE QUEUE ====================

// @desc    Get all candidates pending admin review
// @route   GET /api/admin/candidates/queue
router.get(
  '/candidates/queue',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  async (req, res) => {
    try {
      const candidateQueueService = require('../services/candidateQueueService');

      const candidates = await candidateQueueService.getAdminQueue({
        jobId: req.query.jobId,
        partnerId: req.query.partnerId,
        scoreMin: req.query.scoreMin
      });

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
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  async (req, res) => {
    try {
      const Candidate = require('../models/Candidate');

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

      const JobPosition = require('../models/JobPosition');
      let jobPosition = await JobPosition.findOne({ jobId: candidate.job?._id });

      if (!jobPosition && candidate.job?._id) {
        console.log(`[QUEUE-DETAIL] JobPosition not found for job ${candidate.job._id}. Auto-creating/parsing...`);
        try {
          const { getOrParseJobPosition } = require('../services/jobPositionParser');
          const Job = require('../models/Job');
          const jobDoc = await Job.findById(candidate.job._id);
          if (jobDoc) {
            jobPosition = await getOrParseJobPosition(jobDoc);
          }
        } catch (err) {
          console.error(`[QUEUE-DETAIL] Error auto-creating JobPosition:`, err.message);
        }
      }

      res.json({
        success: true,
        data: {
          candidate,
          jobPosition,
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

// @desc    Trigger/Generate market intelligence for a job position manually
// @route   POST /api/admin/job-positions/:id/market-intel
router.post(
  '/job-positions/:id/market-intel',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  async (req, res) => {
    try {
      const JobPosition = require('../models/JobPosition');
      const { triggerMarketIntel } = require('../services/marketIntelService');

      let jobPosition = await JobPosition.findById(req.params.id);
      if (!jobPosition) {
        // Fallback 1: try finding by jobId
        jobPosition = await JobPosition.findOne({ jobId: req.params.id });
      }

      if (!jobPosition) {
        // Fallback 2: try parsing it from Job model
        const Job = require('../models/Job');
        const jobDoc = await Job.findById(req.params.id);
        if (jobDoc) {
          const { getOrParseJobPosition } = require('../services/jobPositionParser');
          jobPosition = await getOrParseJobPosition(jobDoc);
        }
      }

      if (!jobPosition) {
        return res.status(404).json({
          success: false,
          message: 'Job position not found or could not be initialized/parsed'
        });
      }

      console.log(`[ADMIN-MANUAL-INTEL] Triggering manual market intel for JobPosition ${jobPosition._id}`);
      
      const updated = await triggerMarketIntel(jobPosition._id, {
        title: jobPosition.title,
        category: jobPosition.category,
        subCategory: jobPosition.subCategory
      });

      if (!updated) {
        return res.status(500).json({
          success: false,
          message: 'Failed to generate market intelligence. Check server logs.'
        });
      }

      res.json({
        success: true,
        message: 'Market intelligence generated successfully',
        data: updated
      });
    } catch (err) {
      console.error('[ADMIN-MANUAL-INTEL] Error:', err.message);
      res.status(500).json({
        success: false,
        message: err.message
      });
    }
  }
);

// @desc    Manually re-run AI parsing/scoring for a candidate
// @route   POST /api/admin/candidates/:id/re-score
router.post(
  '/candidates/:id/re-score',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  async (req, res) => {
    try {
      const Candidate = require('../models/Candidate');
      const aiService = require('../services/aiService');

      const candidate = await Candidate.findById(req.params.id)
        .populate('job');

      if (!candidate) {
        return res.status(404).json({
          success: false,
          message: 'Candidate not found'
        });
      }

      if (!candidate.resume?.url) {
        return res.status(400).json({
          success: false,
          message: 'Candidate does not have a resume uploaded'
        });
      }

      console.log(`[ADMIN-RE-SCORE] Triggering manual AI re-scoring for candidate: ${candidate.firstName} ${candidate.lastName}`);

      const formData = {
        candidateId: candidate._id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email: candidate.email,
        mobile: candidate.mobile,
        location: candidate.profile?.location,
        totalExperience: candidate.profile?.totalExperience,
        relevantExperience: candidate.profile?.relevantExperience,
        noticePeriod: candidate.profile?.noticePeriod,
        currentSalary: candidate.profile?.currentSalary,
        expectedSalary: candidate.profile?.expectedSalary,
        writeup: candidate.profile?.writeup,
        skills: candidate.profile?.skills || [],
        education: candidate.profile?.education || [],
        certifications: candidate.profile?.certifications || [],
        languages: candidate.profile?.languages || []
      };

      const jobData = candidate.job?.toObject ? candidate.job.toObject() : candidate.job;

      const result = await aiService.parseResume(
        candidate.resume.url,
        candidate.resume.fileName,
        formData,
        jobData
      );

      if (!result.success || !result.fullAnalysis) {
        return res.status(500).json({
          success: false,
          message: result.message || 'AI parsing failed'
        });
      }

      const fullAnalysis = result.fullAnalysis;
      const screening = fullAnalysis.screening || {};
      const scoring = fullAnalysis.scoring || {};
      const validation = fullAnalysis.validation || {};
      const rec = fullAnalysis.recommendation || {};
      const ranking = fullAnalysis.rankingSignals || {};

      // Map AI scoring fields to DB shape
      const scoreBreakdown = {
        skills: {
          score: scoring.skillsMatch || 0,
          weight: 0.30,
          matchedRequired: ranking.mustHaveSkillsMatched || [],
          missingRequired: ranking.mustHaveSkillsMissing || [],
          matchedPreferred: ranking.preferredSkillsMatched || [],
          coveragePercent: scoring.skillCoveragePercent || 0
        },
        experience: {
          score: scoring.experienceMatch || 0,
          weight: 0.20,
          actual: screening.experienceRange?.actual || '',
          required: screening.experienceRange?.required || '',
          status: screening.experienceRange?.status || '',
          detail: validation.experienceDiscrepancyDetail || '',
          relevancePercent: 100
        },
        domain: {
          score: scoring.domainMatch || 0,
          weight: 0.15,
          jobDomain: screening.domainMatch?.jobDomain || '',
          candidateDomain: screening.domainMatch?.candidateDomain || '',
          status: screening.domainMatch?.status || ''
        },
        education: {
          score: scoring.educationMatch || 0,
          weight: 0.10,
          minimumRequired: screening.educationMatch?.minimumRequired || '',
          candidateEducation: screening.educationMatch?.candidateEducation || '',
          status: screening.educationMatch?.status || ''
        },
        salary: {
          score: scoring.salaryFit || 0,
          weight: 0.10,
          budget: screening.salaryFit?.budget || '',
          expected: screening.salaryFit?.expected || '',
          deltaPercent: screening.salaryFit?.deltaPercent || 0,
          status: screening.salaryFit?.status || '',
          withinBudget: ranking.salaryWithinBudget ?? true
        },
        location: {
          score: scoring.locationMatch || 0,
          weight: 0.05,
          jobLocation: screening.locationFit?.jobLocation || '',
          candidateLocation: screening.locationFit?.candidateLocation || '',
          status: screening.locationFit?.status || '',
          detail: validation.locationMatch || ''
        },
        noticePeriod: {
          score: scoring.noticePeriodFit || 0,
          weight: 0.05,
          required: screening.noticePeriod?.required || '',
          actual: screening.noticePeriod?.actual || '',
          days: ranking.noticePeriodDays || 0,
          status: screening.noticePeriod?.status || ''
        },
        stability: {
          score: scoring.stabilityScore || 0,
          weight: 0.05,
          averageTenureYears: screening.stabilityAnalysis?.averageTenureYears || 0,
          isJobHopper: screening.stabilityAnalysis?.isJobHopper || false,
          risk: screening.stabilityAnalysis?.stabilityRisk || 'LOW',
          detail: screening.stabilityAnalysis?.detail || ''
        },
        summary: {
          weightedScore: scoring.weightedScore || 0,
          riskPenalty: scoring.riskPenalty || 0,
          riskBreakdown: {
            careerGapPenalty: scoring.riskBreakdown?.careerGapPenalty || 0,
            jobHopperPenalty: scoring.riskBreakdown?.jobHopperPenalty || 0,
            domainMismatchPenalty: scoring.riskBreakdown?.domainMismatchPenalty || 0,
            experienceDiscrepancyPenalty: scoring.riskBreakdown?.experienceDiscrepancyPenalty || 0,
            salaryOverBudgetPenalty: scoring.riskBreakdown?.salaryOverBudgetPenalty || 0
          },
          finalAdjustedScore: scoring.finalAdjustedScore || 0
        }
      };

      // Update candidate's resume analysis
      candidate.resumeAnalysis = {
        parsed: true,
        parsedAt: new Date(),
        profileScore: scoring.finalAdjustedScore || 0,
        matchLevel: fullAnalysis.matchLevel || 'UNKNOWN',
        recommendation: rec.decision || 'HOLD',
        scoreBreakdown,
        flags: validation.redFlags?.map(msg => ({ type: 'RED', message: msg })) || [],
        advice: rec.suggestedActions?.map(msg => ({ message: msg })) || []
      };

      if (candidate.submissionMetadata) {
        candidate.submissionMetadata.matchScore = scoring.finalAdjustedScore || 0;
      }

      // Merge candidate profile fields if they were missing or updated
      candidate.firstName = result.data.firstName || candidate.firstName;
      candidate.lastName = result.data.lastName || candidate.lastName;
      candidate.email = result.data.email || candidate.email;
      candidate.mobile = result.data.mobile || candidate.mobile;
      if (result.data.profile) {
        candidate.profile.skills = result.data.profile.skills || candidate.profile.skills;
        candidate.profile.education = result.data.profile.education || candidate.profile.education;
        candidate.profile.languages = result.data.profile.languages || candidate.profile.languages;
        candidate.profile.certifications = result.data.profile.certifications || candidate.profile.certifications;
      }

      await candidate.save();

      // Return fully populated candidate details
      const updatedCandidate = await Candidate.findById(candidate._id)
        .populate('job', 'title category location experienceLevel salary skills')
        .populate('submittedBy', 'firmName firstName lastName uniqueId metrics')
        .populate('company', 'companyName kyc.industry')
        .populate('statusHistory.changedBy', 'email role')
        .populate('notes.addedBy', 'email role');

      res.json({
        success: true,
        message: 'AI re-scoring completed successfully',
        data: {
          candidate: updatedCandidate,
          queueInfo: {
            score: updatedCandidate.resumeAnalysis?.profileScore || 0,
            matchLevel: updatedCandidate.resumeAnalysis?.matchLevel || 'UNKNOWN',
            recommendation: updatedCandidate.resumeAnalysis?.recommendation,
            breakdown: updatedCandidate.resumeAnalysis?.scoreBreakdown || {}
          }
        }
      });
    } catch (err) {
      console.error('[ADMIN-RE-SCORE] Error:', err.message);
      res.status(500).json({
        success: false,
        message: err.message
      });
    }
  }
);

// @desc    Admin approves candidate → send to company
// @route   PUT /api/admin/candidates/queue/:id/approve
router.put(
  '/candidates/queue/:id/approve',
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
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
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
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
  checkPermission(PERMISSIONS.VIEW_ALL_CANDIDATES),
  withdrawCandidateByAdmin
);

// ==================== JOBS WITH CANDIDATES ====================

// All jobs with candidate counts and arrays
router.get(
  '/jobs-with-candidates',
  checkPermission(PERMISSIONS.VIEW_ALL_JOBS),
  require('../controllers/adminController').getAllJobsWithCandidates
);

// Single job with all candidates
router.get(
  '/jobs/:id/candidates',
  checkPermission(PERMISSIONS.VIEW_ALL_JOBS),
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