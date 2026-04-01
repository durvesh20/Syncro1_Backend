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

// Apply auth middleware
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

// Section 7: Documents
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
          documents[fieldName] = `/uploads/documents/${file.filename}`;
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

// Section 8: Team Access (After Verification Only)
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

// Submit for Verification
router.post('/profile/submit', submitProfile);

// ==================== JOBS ROUTES ====================
router.get('/jobs', getAvailableJobs);
router.get('/jobs/:id', getJobDetails);

// Pre-submission candidate-job fit check
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

// Pre-submission duplicate check
router.post('/jobs/:jobId/check-duplicate', async (req, res) => {
  try {
    const duplicateDetection = require('../services/duplicateDetectionService');

    const partner = await StaffingPartner.findOne({
      user: req.user._id
    });

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
        message: 'Please provide email and mobile'
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

// Submit candidate
router.post('/jobs/:jobId/candidates', submitCandidate);

// ==================== SUBMISSIONS ROUTES ====================
router.get('/submissions', getMySubmissions);
router.get('/submissions/:id', getSubmission);

// Withdraw candidate
router.put('/submissions/:id/withdraw', withdrawCandidate);

// ==================== EARNINGS & INVOICES (UPDATED) ====================
router.get('/earnings', getEarnings);
router.get('/earnings/:id', getPayoutDetails);  // NEW
router.get('/invoices', getInvoices);           // NEW
router.get('/invoices/:id', getInvoice);        // NEW


// ==================== CANDIDATE ROUTES ====================
router.post(
  '/candidates/:id/resume',
  uploadResumeMiddleware,
  uploadResume
);

module.exports = router;