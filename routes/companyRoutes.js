// backend/routes/companyRoutes.js
const express = require('express');
const router = express.Router();
const {
  // Profile Management
  getProfile,
  getProfileCompletion,
  updateBasicInfo,
  updateKYC,
  updateHiringPreferences,
  updateBilling,
  updateTeamAccess,
  addTeamMember,
  removeTeamMember,
  updateLegalConsents,
  uploadDocuments,
  submitProfile,
  getDashboard,
  
  // Job Management
  createJob,
  getJobs,
  getJob,
  updateJob,
  deleteJob,
  
  // Candidate Management
  getJobCandidates,
  getAllCandidates,
  getCandidate,
  updateCandidateStatus,
  scheduleInterview,
  updateInterviewFeedback,
  makeOffer,
  updateOfferResponse,
  confirmJoining,
  addNote
} = require('../controllers/companyController');

const { protect, authorize, checkStatus } = require('../middleware/auth');
const {
  uploadCompanyDocuments,
  handleUploadError
} = require('../middleware/upload');

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize('company'));

// ==================== DASHBOARD ====================
router.get('/dashboard', getDashboard);

// ==================== PROFILE ROUTES ====================
router.get('/profile', getProfile);
router.get('/profile/completion', getProfileCompletion);

// Section 1: Basic Info (Decision Maker)
router.put('/profile/basic-info', updateBasicInfo);

// Section 2: KYC (Company Information)
router.put('/profile/kyc', updateKYC);

// Section 3: Hiring Preferences
router.put('/profile/hiring-preferences', updateHiringPreferences);

// Section 5: Billing Setup
router.put('/profile/billing', updateBilling);

// Section 6: Team Access (Enterprise)
router.put('/profile/team-access', checkStatus('VERIFIED', 'ACTIVE'), updateTeamAccess);
router.post('/profile/team-access/member', checkStatus('VERIFIED', 'ACTIVE'), addTeamMember);
router.delete('/profile/team-access/member/:memberId', checkStatus('VERIFIED', 'ACTIVE'), removeTeamMember);

// Section 7: Legal Consents
router.put('/profile/legal-consents', updateLegalConsents);

// Section 8: Documents
router.put('/profile/documents', uploadDocuments);

// Document Upload with File Handler
router.post(
  '/profile/documents/upload',
  uploadCompanyDocuments,
  handleUploadError,
  async (req, res) => {
    try {
      const Company = require('../models/Company');
      const company = await Company.findOne({ user: req.user._id });

      if (!company) {
        return res.status(404).json({
          success: false,
          message: 'Profile not found'
        });
      }

      // ✅ Process uploaded files - SAME AS STAFFING PARTNER
      const documents = {};

      if (req.files) {
        Object.keys(req.files).forEach((fieldName) => {
          const file = req.files[fieldName][0];
          documents[fieldName] = `/uploads/documents/${file.filename}`;
        });
      }

      // ✅ Merge with existing documents
      company.documents = { ...company.documents, ...documents };
      company.profileCompletion.documents = true;
      await company.save();

      res.json({
        success: true,
        message: 'Documents uploaded successfully',
        data: company.documents
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

// Submit for Verification
router.post('/profile/submit', submitProfile);

// ==================== JOB ROUTES ====================
router.route('/jobs')
  .get(getJobs)
  .post(checkStatus('VERIFIED', 'ACTIVE'), createJob);

router.route('/jobs/:id')
  .get(getJob)
  .put(checkStatus('VERIFIED', 'ACTIVE'), updateJob)
  .delete(checkStatus('VERIFIED', 'ACTIVE'), deleteJob);

router.get('/jobs/:jobId/candidates', checkStatus('VERIFIED', 'ACTIVE'), getJobCandidates);

// ==================== CANDIDATE ROUTES ====================
router.get('/candidates', getAllCandidates);
router.get('/candidates/:id', getCandidate);
router.put('/candidates/:id/status', checkStatus('VERIFIED', 'ACTIVE'), updateCandidateStatus);
router.post('/candidates/:id/interviews', checkStatus('VERIFIED', 'ACTIVE'), scheduleInterview);
router.put('/candidates/:id/interviews/:interviewId', checkStatus('VERIFIED', 'ACTIVE'), updateInterviewFeedback);
router.post('/candidates/:id/offer', checkStatus('VERIFIED', 'ACTIVE'), makeOffer);
router.put('/candidates/:id/offer', checkStatus('VERIFIED', 'ACTIVE'), updateOfferResponse);
router.post('/candidates/:id/joining', checkStatus('VERIFIED', 'ACTIVE'), confirmJoining);
router.post('/candidates/:id/notes', checkStatus('VERIFIED', 'ACTIVE'), addNote);

module.exports = router;