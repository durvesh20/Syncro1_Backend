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
  checkAnyPermission([PERMISSIONS.ASSIGN_USERS]),
  assignVerification
);

router.put(
  '/verifications/:type/:id/revoke',
  checkAnyPermission([PERMISSIONS.ASSIGN_USERS]),
  revokeVerificationAssignment
);

router.post(
  '/verifications/bulk-assign',
  checkAnyPermission([PERMISSIONS.ASSIGN_USERS]),
  bulkAssignVerification
);

router.post(
  '/verifications/bulk-revoke',
  checkAnyPermission([PERMISSIONS.ASSIGN_USERS]),
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
  checkAnyPermission([PERMISSIONS.ASSIGN_JOBS]),
  assignJob
);

router.put(
  '/jobs/:id/revoke',
  checkAnyPermission([PERMISSIONS.ASSIGN_JOBS]),
  revokeJobAssignment
);

router.put(
  '/jobs/bulk-assign',
  checkAnyPermission([PERMISSIONS.ASSIGN_JOBS]),
  bulkAssignJobs
);

router.put(
  '/jobs/bulk-revoke',
  checkAnyPermission([PERMISSIONS.ASSIGN_JOBS]),
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

// Revoke company rejection and resubmit candidate
router.put(
  '/candidates/:id/revoke-resubmit',
  async (req, res) => {
    try {
      const Candidate = require('../models/Candidate');
      const candidate = await Candidate.findById(req.params.id);

      if (!candidate) {
        return res.status(404).json({ success: false, message: 'Candidate not found' });
      }

      const rejectedStatuses = ['REJECTED', 'ROUND_REJECTED', 'HR_REJECTED', 'OFFER_REJECTED', 'ASSESSMENT_FAILED'];
      if (!rejectedStatuses.includes(candidate.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot revoke: candidate is currently in status "${candidate.status}" and is not rejected by company.`
        });
      }

      const { notes } = req.body;
      const prevStatus = candidate.status;

      // Reset pipeline rejection outcomes to keep flowchart/details clean
      if (candidate.status === 'ROUND_REJECTED') {
        if (candidate.interviews && candidate.interviews.length > 0) {
          const lastRound = candidate.interviews[candidate.interviews.length - 1];
          if (lastRound.outcome && lastRound.outcome.decision === 'REJECTED') {
            lastRound.outcome = undefined;
          }
        }
      } else if (candidate.status === 'HR_REJECTED') {
        if (candidate.hrRound) {
          candidate.hrRound = undefined;
        }
      }

      candidate.status = 'SUBMITTED';
      candidate.statusHistory.push({
        status: 'SUBMITTED',
        changedBy: req.user._id,
        changedAt: new Date(),
        notes: notes?.trim() || `Rejection (previous status: ${prevStatus}) revoked and resubmitted to company by Admin`
      });

      await candidate.save();

      res.json({
        success: true,
        message: 'Candidate rejection revoked and resubmitted successfully.',
        data: candidate
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to revoke and resubmit candidate',
        error: error.message
      });
    }
  }
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

      /*
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
      */

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

      /*
      if (req.user.role === 'sub_admin') {
        const hasViewAll = req.user.permissions?.includes('VIEW_ALL_CANDIDATES');
        if (!hasViewAll) {
          const assignedJobs = await Job.find({ assignedTo: req.user._id }).select('_id');
          filters.assignedJobIds = assignedJobs.map(j => j._id);
        }
      }
      */

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
      const JobPosition = require('../models/JobPosition');

      const candidate = await Candidate.findById(req.params.id)
        .populate({
          path: 'job',
          select: 'title uniqueId category subCategory location experienceLevel experienceRange salary skills education assignedTo description requirements responsibilities commission vacancies applicationDeadline expectedJoiningDate employmentType',
          populate: { path: 'assignedTo', select: 'email role' }
        })
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

      const jobPosition = await JobPosition.findOne({ jobId: candidate.job?._id || candidate.job });

      /*
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
      */

      const rawBreakdown = candidate.resumeAnalysis?.scoreBreakdown ? (candidate.resumeAnalysis.scoreBreakdown.toObject ? candidate.resumeAnalysis.scoreBreakdown.toObject() : JSON.parse(JSON.stringify(candidate.resumeAnalysis.scoreBreakdown))) : {};
      const computedRelocate = candidate.willingToRelocate ?? candidate.profile?.willingToRelocate ?? candidate.resumeAnalysis?.aiData?.profile?.willingToRelocate ?? candidate.resumeAnalysis?.fullAnalysis?.screening?.locationFit?.willingToRelocate ?? candidate.resumeAnalysis?.fullAnalysis?.screening?.locationFit?.relocationWilling ?? null;

      if (rawBreakdown && rawBreakdown.location) {
        rawBreakdown.location.willingToRelocate = rawBreakdown.location.willingToRelocate ?? computedRelocate;
      }

      // Dynamic stability backfill for legacy records
      if (rawBreakdown && candidate.profile) {
        try {
          const candidateScoringService = require('../services/candidateScoringService');
          const computedStab = candidateScoringService._scoreStability({
            jobHistory: candidate.resumeAnalysis?.aiData?.profile?.jobHistory || candidate.profile?.experience || [],
            experience: candidate.profile?.experience || []
          });

          if (!rawBreakdown.stability || rawBreakdown.stability.last5YearAverageTenureYears === undefined || rawBreakdown.stability.last5YearAverageTenureYears === 0) {
            rawBreakdown.stability = {
              score: candidate.resumeAnalysis?.scoreBreakdown?.stability?.score ?? computedStab.score,
              weight: 0.10,
              totalAverageTenureYears: computedStab.totalAverageTenureYears,
              last5YearAverageTenureYears: computedStab.last5YearAverageTenureYears,
              averageTenureYears: computedStab.last5YearAverageTenureYears,
              isJobHopper: computedStab.isJobHopper,
              risk: computedStab.risk,
              detail: computedStab.detail
            };
          }
        } catch (stabErr) {
          console.error('[ADMIN] Stability backfill failed:', stabErr.message);
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
            breakdown: rawBreakdown,
            flags: candidate.resumeAnalysis?.flags || [],
            advice: candidate.resumeAnalysis?.advice || [],
            aiParsedData: candidate.resumeAnalysis?.aiData,
            parsed: candidate.resumeAnalysis?.parsed || false,
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
          matchedPreferred: ranking.shouldHaveSkillsMatched || ranking.preferredSkillsMatched || [],
          missingPreferred: ranking.shouldHaveSkillsMissing || ranking.preferredSkillsMissing || [],
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

      // Build flags from validation
      let flags = [];
      if (validation.redFlags && validation.redFlags.length > 0) {
        flags = flags.concat(validation.redFlags.map(f => ({
          type: 'WARNING',
          message: f
        })));
      }
      if (validation.greenFlags && validation.greenFlags.length > 0) {
        flags = flags.concat(validation.greenFlags.map(f => ({
          type: 'SUCCESS',
          message: f
        })));
      }

      const advice = [
        ...(rec.suggestedActions || []),
        ...(rec.interviewFocusAreas || [])
      ];

      // Update candidate's resume analysis
      candidate.resumeAnalysis = {
        parsed: true,
        parsedAt: new Date(),
        profileScore: scoring.finalAdjustedScore || 0,
        matchLevel: fullAnalysis.matchLevel || 'UNKNOWN',
        recommendation: rec.decision || 'HOLD',
        scoreBreakdown,
        flags,
        advice
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


// ==================== PIPELINE (Admin read-only + Audit Log + Write Access) ====================
const { 
  adminGetPipeline, 
  adminGetPipelineAuditLog, 
  getJobPipelineTemplate,
  definePipelineTemplate,
  defineJobPipelineTemplate,
  pipelinePublishSlots,
  pipelineShareDetails
} = require('../controllers/pipelineController');
const { getJobInterviewSlots } = require('../controllers/companyController');
const { adminAssignCandidateToSlot, adminCreateJobInterviewSlots, adminCancelJobInterviewSlot } = require('../controllers/adminController');

router.get('/candidates/:id/pipeline', adminGetPipeline);
router.get('/jobs/:jobId/pipeline/template', getJobPipelineTemplate);
router.get('/jobs/:jobId/interview-slots', getJobInterviewSlots);
router.post('/jobs/:jobId/interview-slots', adminCreateJobInterviewSlots);
router.delete('/jobs/:jobId/interview-slots/:slotId', adminCancelJobInterviewSlot);

// Admin write access to pipeline templates
router.post('/candidates/:id/pipeline/template', definePipelineTemplate);
router.post('/jobs/:jobId/pipeline/template', defineJobPipelineTemplate);

// Admin slot creation access (same as company)
router.post('/candidates/:id/pipeline/publish-slots', pipelinePublishSlots);

// Admin candidate assignment access (same as company/partner)
router.post('/candidates/:id/pipeline/share-details', pipelineShareDetails);
router.post('/jobs/:jobId/interview-slots/:slotId/assign', adminAssignCandidateToSlot);

// Phase 4: cross-candidate pipeline audit trail
// GET /api/admin/pipeline/audit-log?page=1&limit=30&search=&action=&status=
router.get('/pipeline/audit-log', adminGetPipelineAuditLog);

// Resend interview consent (WhatsApp + Email) – Admin/Sub-admin
const { pipelineResendInterviewConsent } = require('../controllers/pipelineResendConsent');
router.post('/candidates/:id/pipeline/resend-interview-consent', pipelineResendInterviewConsent);

module.exports = router;