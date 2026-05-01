// backend/routes/staffingPartnerRoutes.js
const express = require('express');
const router = express.Router();
const StaffingPartner = require('../models/StaffingPartner');

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
  getInvoice
} = require('../controllers/staffingPartnerController');

const { protect, authorize, checkStatus } = require('../middleware/auth');

const {
  uploadResume: uploadResumeMiddleware,
  uploadPartnerDocuments,
  handleUploadError
} = require('../middleware/upload');

// ==================== AUTH MIDDLEWARE ====================
// Applied to ALL routes below
router.use(protect);
router.use(authorize('staffing_partner'));

// ==================== DASHBOARD ====================
router.get('/dashboard', getDashboard);

// ==================== PROFILE ROUTES ====================
router.get('/profile', getProfile);
router.get('/profile/completion', getProfileCompletion);

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
router.get('/jobs', getAvailableJobs);
router.get('/jobs/:id', getJobDetails);

// ==================== PRE-SUBMISSION CHECKS ====================

// @desc    Check for duplicate candidate before submitting
// @route   POST /api/staffing-partners/jobs/:jobId/check-duplicate
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
// @route   POST /api/staffing-partners/jobs/:jobId/check-fit
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
// @route   POST /api/staffing-partners/jobs/:jobId/candidates
// @access  Staffing Partner (Verified/Active)
// @body    multipart/form-data
//          Fields : firstName, lastName, email, mobile, + optional fields
//          File   : resume (PDF / DOC / DOCX — max 10MB)
router.post(
  '/jobs/:jobId/candidates',
  uploadResumeMiddleware,   // Step 1: multer uploads file to Cloudinary
  handleUploadError,         // Step 2: catch any multer/cloudinary errors
  submitCandidate            // Step 3: run controller with req.file available
);

// ==================== SUBMISSIONS ROUTES ====================
router.get('/submissions', getMySubmissions);
router.get('/submissions/:id', getSubmission);

// @desc    Withdraw a submitted candidate
// @route   PUT /api/staffing-partners/submissions/:id/withdraw
router.put('/submissions/:id/withdraw', withdrawCandidate);

// ==================== EARNINGS & INVOICES ====================
router.get('/earnings', getEarnings);
router.get('/earnings/:id', getPayoutDetails);
router.get('/invoices', getInvoices);
router.get('/invoices/:id', getInvoice);

// ==================== CANDIDATE RESUME UPDATE ====================

// @desc    Update resume for an EXISTING candidate (after submission)
// @route   POST /api/staffing-partners/candidates/:id/resume
// @body    multipart/form-data — field name: "resume"
// @note    Only the partner who submitted the candidate can update resume
router.post(
  '/candidates/:id/resume',
  uploadResumeMiddleware,   // Step 1: upload new file to Cloudinary
  handleUploadError,         // Step 2: catch upload errors
  uploadResume               // Step 3: update candidate record in DB
);

module.exports = router;