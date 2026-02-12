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
  updateFinanceDetails,
  updatePayoutPreferences,
  updateTeamAccess,
  addTeamMember,
  removeTeamMember,
  submitProfile,
  getAvailableJobs,
  getJobDetails,
  submitCandidate,
  uploadResume,
  getMySubmissions,
  getSubmission,
  getDashboard,
  getEarnings
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

// Section 5: Compliance & Ethical Declarations
router.put('/profile/compliance', updateCompliance);

// Section 6: Finance & Payout Preferences
router.put('/profile/finance', updateFinanceDetails);
router.put('/profile/payout-preferences', updatePayoutPreferences);

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
router.put('/profile/team-access', checkStatus('VERIFIED', 'ACTIVE'), updateTeamAccess);
router.post('/profile/team-access/member', checkStatus('VERIFIED', 'ACTIVE'), addTeamMember);
router.delete('/profile/team-access/member/:memberId', checkStatus('VERIFIED', 'ACTIVE'), removeTeamMember);

// Submit for Verification
router.post('/profile/submit', submitProfile);

// ==================== JOBS ROUTES ====================
router.get('/jobs', getAvailableJobs);
router.get('/jobs/:id', getJobDetails);
router.post('/jobs/:jobId/candidates', submitCandidate);

// ==================== SUBMISSIONS ROUTES ====================
router.get('/submissions', getMySubmissions);
router.get('/submissions/:id', getSubmission);

// ==================== EARNINGS ====================
router.get('/earnings', getEarnings);

// ==================== CANDIDATE ROUTES ====================
router.post('/candidates/:id/resume', uploadResumeMiddleware, uploadResume);

module.exports = router;