// backend/routes/staffingPartnerRoutes.js
const express = require('express');
const router = express.Router();
const StaffingPartner = require('../models/StaffingPartner');
const jobOnHoldGuard = require('../middleware/jobOnHoldGuard');
const { partnerGetPipeline, partnerRequestReschedule } = require('../controllers/pipelineController');

const {
  getProfile,
  getProfileCompletion,
  updateBasicInfo,
  updateFirmDetails,
  updateSyncro1Competency,
  updateGeographicReach,
  updateCompliance,
  updateCommercialDetails,
  updateTeamAccess,
  addTeamMember,
  removeTeamMember,
  updateTeamMember,
  getTeamMembers,
  submitProfile,
  getAvailableJobs,
  getJobDetails,
  submitCandidate,
  withdrawCandidate,
  uploadResume,
  getMySubmissions,
  getSubmission,
  getDashboard,
  getEarnings,
  getPayoutDetails,
  getInvoices,
  getInvoice,
  getAvailableSlots,
  selectInterviewSlot,
  proposeInterviewSlots,
  getAvailableSlotsForPartner,
  assignCandidateToSlot,
  removeCandidateFromSlot,
  confirmTaggedSlot,
  rejectTaggedSlotByCandidate,
  getWorkedJobs,
  resendConsent,
  updateSubmission,
  getJobScreeningQuestionsForPartner,
  downloadJobPositionPdf,
  // Sub-admin Management
  createSubAdmin,
  getSubAdmins,
  getSubAdminById,
  updateSubAdmin,
  updateSubAdminStatus,
  getPermissionsMeta
} = require('../controllers/staffingPartnerController');

const {
  listPoolCandidates,
  createPoolCandidate,
  getPoolCandidate,
  updatePoolCandidate,
  deletePoolCandidate,
  applyFromPool
} = require('../controllers/partnerCandidateController');

const { protect, authorize, checkStatus, checkTalentPartnerPermission } = require('../middleware/auth');

const {
  uploadResume: uploadResumeMiddleware,
  uploadPartnerDocuments,
  handleUploadError
} = require('../middleware/upload');

// ✅ Helper: wrap multer in a proper Express middleware that catches errors
// (including non-Error Cloudinary rejections) and passes them to next()
const safeUpload = (multerFn) => (req, res, next) => {
  multerFn(req, res, (err) => {
    if (err) {
      const uploadErr = err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : JSON.stringify(err));
      console.error('[UPLOAD] Error during file upload:', uploadErr.message);
      return next(uploadErr);
    }
    next();
  });
};

// ==================== AUTH MIDDLEWARE ====================
// Applied to ALL routes below
router.use(protect);
router.use(authorize('talent_partner', 'staffing', 'staffing_partner'));

// Middleware to block sub-admins from managing sub-admins
const blockSubAdmins = (req, res, next) => {
  if (req.user && req.user.createdBy) {
    return res.status(403).json({
      success: false,
      message: 'Only the main talent partner account is authorized to manage sub-admins.'
    });
  }
  next();
};

// ==================== TALENT PARTNER SUB-ADMIN ROUTES ====================
router.get('/sub-admins/permissions', blockSubAdmins, getPermissionsMeta);
router.post('/sub-admins', blockSubAdmins, createSubAdmin);
router.get('/sub-admins', blockSubAdmins, getSubAdmins);
router.get('/sub-admins/:id', blockSubAdmins, getSubAdminById);
router.put('/sub-admins/:id', blockSubAdmins, updateSubAdmin);
router.put('/sub-admins/:id/status', blockSubAdmins, updateSubAdminStatus);

// Middleware to override req.user._id for sub-admins so they act on behalf of the parent talent partner
router.use((req, res, next) => {
  if (req.user && (req.user.role === 'talent_partner' || req.user.role === 'staffing' || req.user.role === 'staffing_partner') && req.user.createdBy) {
    req.subAdminUser = req.user;
    const userObj = req.user.toObject ? req.user.toObject() : req.user;
    req.user = {
      ...userObj,
      _id: req.user.createdBy,
      permissions: req.user.permissions,
      createdBy: req.user.createdBy
    };
  }
  next();
});

// ==================== DASHBOARD ====================
router.get('/dashboard', checkTalentPartnerPermission(['VIEW_DASHBOARD_SELF', 'VIEW_DASHBOARD_MASTER']), getDashboard);

// ==================== PROFILE ROUTES ====================
router.get('/profile', checkTalentPartnerPermission(['MANAGE_PROFILE_SELF', 'MANAGE_PROFILE_MASTER', 'MANAGE_SETTINGS']), getProfile);
router.get('/profile/completion', checkTalentPartnerPermission(['MANAGE_PROFILE_SELF', 'MANAGE_PROFILE_MASTER', 'MANAGE_SETTINGS']), getProfileCompletion);

// Section 1: Basic Info
router.put('/profile/basic-info', updateBasicInfo);

// Section 2: Firm Details
router.put('/profile/firm-details', updateFirmDetails);

// Section 3: Recruitment Competency
router.put('/profile/Syncro1-competency', updateSyncro1Competency);

// Section 4: Geographic Reach
router.put('/profile/geographic-reach', updateGeographicReach);

// Section 5: Compliance
router.put('/profile/compliance', updateCompliance);

// Section 6: Commercial Details
router.put('/profile/commercial-details', updateCommercialDetails);

// Section 7: Documents Upload
// Accepts: multipart/form-data with partner document files
router.post(
  '/profile/documents',
  uploadPartnerDocuments,
  handleUploadError,
  async (req, res) => {
    try {
      const partner = await StaffingPartner.findOne({ user: req.user._id });

      if (!partner) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      const documents = {};

      if (req.files) {
        Object.keys(req.files).forEach((fieldName) => {
          const file = req.files[fieldName][0];
          documents[fieldName] = file.path; // Cloudinary URL
        });
      }

      partner.documents = { ...partner.documents, ...documents };
      partner.profileCompletion.documents = true;

      await partner.save();

      res.json({
        success: true,
        message: 'Documents uploaded successfully',
        data: partner.documents
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Upload failed',
        error: error.message
      });
    }
  }
);

// ==================== TEAM ACCESS ROUTES ====================
// Only accessible after partner is VERIFIED or ACTIVE

router.put(
  '/profile/team-access',
  checkStatus('VERIFIED', 'ACTIVE'),
  updateTeamAccess
);

router.post(
  '/profile/team-access/member',
  checkStatus('VERIFIED', 'ACTIVE'),
  addTeamMember
);

router.delete(
  '/profile/team-access/member/:memberId',
  checkStatus('VERIFIED', 'ACTIVE'),
  removeTeamMember
);

router.get(
  '/profile/team-access/members',
  checkStatus('VERIFIED', 'ACTIVE'),
  getTeamMembers
);

router.put(
  '/profile/team-access/member/:memberId',
  checkStatus('VERIFIED', 'ACTIVE'),
  updateTeamMember
);

// Submit profile for verification
router.post('/profile/submit', submitProfile);

// ==================== JOBS ROUTES ====================
router.get('/jobs', checkTalentPartnerPermission('VIEW_JOBS'), getAvailableJobs);
router.get('/jobs/:id', checkTalentPartnerPermission('VIEW_JOBS'), getJobDetails);
router.get('/jobs/:id/download-jd', checkTalentPartnerPermission('VIEW_JOBS'), downloadJobPositionPdf);

// ==================== PRE-SUBMISSION CHECKS ====================

// @desc    Check for duplicate candidate before submitting
// @route   POST /api/talent-partners/jobs/:jobId/check-duplicate
// @body    { email, mobile }
router.post('/jobs/:jobId/check-duplicate', async (req, res) => {
  try {
    const duplicateDetection = require('../services/duplicateDetectionService');

    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found'
      });
    }

    const { email, mobile } = req.body;

    if (!email || !mobile) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and mobile'
      });
    }

    const result = await duplicateDetection.checkBeforeSubmission(
      { email, mobile },
      req.params.jobId,
      partner._id
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Duplicate check failed',
      error: error.message
    });
  }
});

// @desc    Check candidate-job fit before submitting
// @route   POST /api/talent-partners/jobs/:jobId/check-fit
// @body    { profile }
router.post('/jobs/:jobId/check-fit', async (req, res) => {
  try {
    const candidateScoringService = require('../services/candidateScoringService');
    const Job = require('../models/Job');

    const job = await Job.findById(req.params.jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (!req.body.profile) {
      return res.status(400).json({
        success: false,
        message: 'Please provide candidate profile in request body'
      });
    }

    const result = candidateScoringService.preSubmissionCheck(
      req.body.profile,
      job
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Fit check failed',
      error: error.message
    });
  }
});

// ==================== CANDIDATE SUBMISSION ====================

// @desc    Submit candidate WITH resume — single multipart/form-data request
// @route   POST /api/talent-partners/jobs/:jobId/candidates
router.post(
  '/jobs/:jobId/candidates',
  jobOnHoldGuard,
  checkTalentPartnerPermission('SUBMIT_CANDIDATE'),
  safeUpload(uploadResumeMiddleware),
  handleUploadError,
  submitCandidate
);

// ✅ Apply from pool: POST /api/talent-partners/jobs/:jobId/candidates/from-pool
// Must come BEFORE the generic interview-slots route to avoid :id collision
router.post(
  '/jobs/:jobId/candidates/from-pool',
  jobOnHoldGuard,
  checkTalentPartnerPermission('SUBMIT_CANDIDATE'),
  applyFromPool
);

router.get('/jobs/:jobId/interview-slots', getAvailableSlotsForPartner);
router.post('/jobs/:jobId/interview-slots/:slotId/assign', jobOnHoldGuard, assignCandidateToSlot);
router.delete('/jobs/:jobId/interview-slots/:slotId/assign/:candidateId', jobOnHoldGuard, removeCandidateFromSlot);
router.post('/jobs/:jobId/tagged-slot/confirm', jobOnHoldGuard, confirmTaggedSlot);
router.post('/jobs/:jobId/tagged-slot/reject', jobOnHoldGuard, rejectTaggedSlotByCandidate);

// ==================== SUBMISSIONS ROUTES ====================
router.get('/submissions', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), getMySubmissions);
router.get('/submissions/:id', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), getSubmission);
router.get('/submissions/:id/pipeline', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), partnerGetPipeline);
router.post('/submissions/:id/pipeline/reschedule', jobOnHoldGuard, checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), partnerRequestReschedule);
router.get('/worked-jobs', checkTalentPartnerPermission(['VIEW_WORKED_JOBS', 'VIEW_JOBS']), getWorkedJobs);

// @desc    Withdraw a submitted candidate
// @route   PUT /api/talent-partners/submissions/:id/withdraw
router.put('/submissions/:id/withdraw', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), withdrawCandidate);

// @desc    Update a submission's candidate details
// @route   PUT /api/talent-partners/submissions/:id
router.put('/submissions/:id', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), safeUpload(uploadResumeMiddleware), handleUploadError, updateSubmission);

// @desc    Resend WhatsApp consent to candidate (Initial Consent)
// @route   POST /api/talent-partners/submissions/:id/resend-consent
// @access  Only when candidate status is CONSENT_PENDING
router.post('/submissions/:id/resend-consent', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), resendConsent);

// @desc    Resend interview consent (WhatsApp + Email) to candidate
// @route   POST /api/talent-partners/submissions/:id/pipeline/resend-interview-consent
// @access  Only when active round status is SLOT_DETAILS_SHARED
const { pipelineResendInterviewConsent } = require('../controllers/pipelineResendConsent');
router.post('/submissions/:id/pipeline/resend-interview-consent', checkTalentPartnerPermission(['VIEW_SUBMISSIONS', 'VIEW_CANDIDATES']), pipelineResendInterviewConsent);

// ==================== EARNINGS & INVOICES ====================
router.get('/earnings', checkTalentPartnerPermission('VIEW_BILLING'), getEarnings);
router.get('/earnings/:id', checkTalentPartnerPermission('VIEW_BILLING'), getPayoutDetails);
router.get('/invoices', checkTalentPartnerPermission('VIEW_BILLING'), getInvoices);
router.get('/invoices/:id', checkTalentPartnerPermission('VIEW_BILLING'), getInvoice);

// ==================== CANDIDATE RESUME UPDATE ====================

// @desc    Update resume for an EXISTING candidate (after submission)
// @route   POST /api/talent-partners/candidates/:id/resume
// @body    multipart/form-data — field name: "resume"
// @note    Only the partner who submitted the candidate can update resume
router.post(
  '/candidates/:id/resume',
  safeUpload(uploadResumeMiddleware),
  handleUploadError,
  uploadResume
);

// ==================== CANDIDATE POOL ROUTES ====================

// GET    /api/talent-partners/my-candidates         — list all (paginated)
router.get('/my-candidates', listPoolCandidates);

// POST   /api/talent-partners/my-candidates         — create (with optional resume)
router.post(
  '/my-candidates',
  safeUpload(uploadResumeMiddleware),
  handleUploadError,
  createPoolCandidate
);

// GET    /api/talent-partners/my-candidates/:id     — get one
router.get('/my-candidates/:id', getPoolCandidate);

// PUT    /api/talent-partners/my-candidates/:id     — update (with optional resume)
router.put(
  '/my-candidates/:id',
  uploadResumeMiddleware,
  handleUploadError,
  updatePoolCandidate
);

// DELETE /api/talent-partners/my-candidates/:id     — delete
router.delete('/my-candidates/:id', deletePoolCandidate);

// ==================== SCREENING QUESTION ROUTES ====================
// @desc  Get screening questions for a job (before submitting a candidate)
// @route GET /api/talent-partners/jobs/:jobId/screening-questions
router.get('/jobs/:jobId/screening-questions', getJobScreeningQuestionsForPartner);

// ==================== PARTNER PROGRAM & PERFORMANCE CHALLENGE ====================
const {
  getAllTournaments,
  getTournamentById,
  getCurrentTournament,
  getLeaderboard,
  getPartnerStats,
  enterTournament
} = require('../controllers/partnerProgramController');

router.get('/partner-program/tournaments', checkTalentPartnerPermission('VIEW_PARTNER_PROGRAM'), getAllTournaments);
router.get('/partner-program/tournaments/:id', checkTalentPartnerPermission('VIEW_PARTNER_PROGRAM'), getTournamentById);
router.post('/partner-program/tournaments/:id/enter', checkTalentPartnerPermission('VIEW_PARTNER_PROGRAM'), enterTournament);
router.get('/partner-program/tournament', checkTalentPartnerPermission('VIEW_PARTNER_PROGRAM'), getCurrentTournament);
router.get('/partner-program/leaderboard', checkTalentPartnerPermission('VIEW_PARTNER_PROGRAM'), getLeaderboard);
router.get('/partner-program/stats', checkTalentPartnerPermission('VIEW_PARTNER_PROGRAM'), getPartnerStats);

module.exports = router;