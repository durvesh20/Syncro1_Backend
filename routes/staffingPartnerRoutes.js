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
const { protect, authorize } = require('../middleware/auth');
const {
  uploadResume: uploadResumeMiddleware,
  uploadPartnerDocuments,
  handleUploadError
} = require('../middleware/upload');

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize('staffing_partner'));

// ==================== Dashboard ====================
router.get('/dashboard', getDashboard);

// ==================== Profile Routes ====================
router.get('/profile', getProfile);
router.get('/profile/completion', getProfileCompletion);
router.put('/profile/basic-info', updateBasicInfo);
router.put('/profile/firm-details', updateFirmDetails);
router.put('/profile/Syncro1-competency', updateSyncro1Competency);
router.put('/profile/geographic-reach', updateGeographicReach);
router.put('/profile/compliance', updateCompliance);
router.put('/profile/finance', updateFinanceDetails);
router.post('/profile/submit', submitProfile);

// @desc    Upload KYC Documents
// @route   POST /api/staffing-partners/profile/documents
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

      // Process uploaded files
      const documents = {};

      if (req.files) {
        Object.keys(req.files).forEach((fieldName) => {
          const file = req.files[fieldName][0];
          documents[fieldName] = `/uploads/documents/${file.filename}`;
        });
      }

      partner.documents = { ...partner.documents, ...documents };
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

// ==================== Jobs Routes ====================
router.get('/jobs', getAvailableJobs);
router.get('/jobs/:id', getJobDetails);
router.post('/jobs/:jobId/candidates', submitCandidate);

// ==================== Submissions Routes ====================
router.get('/submissions', getMySubmissions);
router.get('/submissions/:id', getSubmission);

// ==================== Earnings ====================
router.get('/earnings', getEarnings);

// ==================== Candidate Routes ====================
router.post('/candidates/:id/resume', uploadResumeMiddleware, uploadResume);

module.exports = router;