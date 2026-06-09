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
  getRejectedJobs,
  getJob,
  updateJob,
  deleteJob,

  // Job Approval Workflow
  submitJobForApproval,
  requestJobEdit,
  getJobEditRequests,
  cancelEditRequest,

  // Candidate Management
  getJobCandidates,
  getAllCandidates,
  getCandidate,
  addNote,
  shortlistCandidate,
  rejectCandidate,
  createInterviewSlots,
  getInterviewSlots,
  confirmInterviewSlot,
  getJobInterviewSlots,
  cancelInterviewSlot,
  confirmInterviewDetails,
  getInterviewSchedule,
  
  // Sub-admin Management
  createSubAdmin,
  getSubAdmins,
  getSubAdminById,
  updateSubAdmin,
  updateSubAdminStatus,
  getPermissionsMeta
} = require('../controllers/companyController');

const { protect, authorize, checkStatus, checkCompanyPermission } = require('../middleware/auth');
const {
  uploadCompanyDocuments,
  uploadLogo,
  uploadLogoToCloudinary,
  handleUploadError
} = require('../middleware/upload');

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize('company'));

// Middleware to block sub-admins from managing sub-admins
const blockSubAdmins = (req, res, next) => {
  if (req.user && req.user.createdBy) {
    return res.status(403).json({
      success: false,
      message: 'Only the main company account is authorized to manage sub-admins.'
    });
  }
  next();
};

// ==================== COMPANY SUB-ADMIN ROUTES ====================
router.get('/sub-admins/permissions', blockSubAdmins, getPermissionsMeta);
router.post('/sub-admins', blockSubAdmins, createSubAdmin);
router.get('/sub-admins', blockSubAdmins, getSubAdmins);
router.get('/sub-admins/:id', blockSubAdmins, getSubAdminById);
router.put('/sub-admins/:id', blockSubAdmins, updateSubAdmin);
router.put('/sub-admins/:id/status', blockSubAdmins, updateSubAdminStatus);

// Middleware to override req.user._id for sub-admins so they act on behalf of the parent company
router.use((req, res, next) => {
  if (req.user && req.user.createdBy) {
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
router.get('/dashboard', getDashboard);

// ==================== PROFILE ROUTES ====================
router.get('/profile', getProfile);
router.get('/profile/completion', getProfileCompletion);

// Section 1: Basic Info (Decision Maker)
router.put('/profile/basic-info', checkCompanyPermission('MANAGE_SETTINGS'), updateBasicInfo);

// Section 2: KYC (Company Information)
router.put('/profile/kyc', checkCompanyPermission('MANAGE_SETTINGS'), updateKYC);

// ==================== COMPANY LOGO UPLOAD ====================
// Upload company logo separately
router.post(
  '/profile/logo-upload',
  checkCompanyPermission('MANAGE_SETTINGS'),
  (req, res, next) => {
    try {
      uploadLogo(req, res, (err) => {
        if (err) {
          console.error('[COMPANY] Logo upload middleware error:', err);
          return res.status(400).json({
            success: false,
            message: err.message || 'Invalid file format or size. Only JPG, JPEG, PNG, SVG, and WEBP files up to 5MB are allowed.'
          });
        }
        next();
      });
    } catch (err) {
      console.error('[COMPANY] Logo upload sync error:', err);
      return res.status(400).json({
        success: false,
        message: err.message || 'Invalid file upload.'
      });
    }
  },
  async (req, res) => {
    try {
      const Company = require('../models/Company');
      const company = await Company.findOne({ user: req.user._id });

      if (!company) {
        return res.status(404).json({
          success: false,
          message: 'Company not found'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No logo file uploaded'
        });
      }

      // Upload memory buffer to Cloudinary
      let uploadResult;
      try {
        uploadResult = await uploadLogoToCloudinary(req.file.buffer);
      } catch (cloudinaryErr) {
        console.error('[COMPANY] Cloudinary stream upload error:', cloudinaryErr);
        return res.status(400).json({
          success: false,
          message: cloudinaryErr.message || 'Failed to upload logo to Cloudinary due to invalid format or file content.'
        });
      }

      if (!uploadResult || !uploadResult.secure_url) {
        return res.status(400).json({
          success: false,
          message: 'Failed to upload logo to storage.'
        });
      }

      // Save logo path in KYC
      company.kyc = company.kyc || {};
      company.kyc.logo = uploadResult.secure_url; // Cloudinary URL
      await company.save();

      res.json({
        success: true,
        message: 'Company logo uploaded successfully',
        data: {
          logo: company.kyc.logo
        }
      });
    } catch (error) {
      console.error('[COMPANY] Logo upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Logo upload failed',
        error: error.message
      });
    }
  }
);

// Section 3: Hiring Preferences
router.put('/profile/hiring-preferences', checkCompanyPermission('MANAGE_SETTINGS'), updateHiringPreferences);

// Section 5: Billing Setup
router.put('/profile/billing', checkCompanyPermission('VIEW_BILLING'), updateBilling);

// Section 6: Team Access (Enterprise)
router.put('/profile/team-access', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('MANAGE_SETTINGS'), updateTeamAccess);
router.post('/profile/team-access/member', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('MANAGE_SETTINGS'), addTeamMember);
router.delete('/profile/team-access/member/:memberId', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('MANAGE_SETTINGS'), removeTeamMember);

// Section 7: Legal Consents
router.put('/profile/legal-consents', checkCompanyPermission('MANAGE_SETTINGS'), updateLegalConsents);

// Section 8: Documents
router.put('/profile/documents', checkCompanyPermission('MANAGE_SETTINGS'), uploadDocuments);

// Document Upload with File Handler
router.post(
  '/profile/documents/upload',
  checkCompanyPermission('MANAGE_SETTINGS'),
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

      const documents = {};

      if (req.files) {
        Object.keys(req.files).forEach((fieldName) => {
          const file = req.files[fieldName][0];
          documents[fieldName] = file.path; // Cloudinary URL
        });
      }

      company.documents = { ...company.documents, ...documents };

      // Mark complete only if mandatory docs uploaded
      company.profileCompletion.documents = !!(
        company.documents.gstCertificate &&
        company.documents.panCard
      );

      await company.save();

      res.json({
        success: true,
        message: 'Documents uploaded successfully',
        data: company.documents
      });
    } catch (error) {
      console.error('[COMPANY] Documents upload error:', error);
      res.status(500).json({
        success: false,
        message: 'Upload failed',
        error: error.message
      });
    }
  }
);

// Submit for Verification
router.post('/profile/submit', checkCompanyPermission('MANAGE_SETTINGS'), submitProfile);

// ==================== JOB ROUTES ====================

// Must come BEFORE /jobs/:id routes to avoid route conflict
router.get('/jobs/rejected', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('VIEW_JOBS'), getRejectedJobs);

router.route('/jobs')
  .get(checkCompanyPermission('VIEW_JOBS'), getJobs)
  .post(checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('POST_JOB'), createJob);

router.route('/jobs/:id')
  .get(checkCompanyPermission('VIEW_JOBS'), getJob)
  .put(checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('EDIT_JOB'), updateJob)
  .delete(checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('CLOSE_JOB'), deleteJob);

router.get('/jobs/:jobId/candidates', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('VIEW_APPLICANTS'), getJobCandidates);

// ==================== JOB APPROVAL WORKFLOW ====================

router.post(
  '/jobs/:id/submit-for-approval',
  checkStatus('VERIFIED', 'ACTIVE'),
  checkCompanyPermission('EDIT_JOB'),
  submitJobForApproval
);

router.post(
  '/jobs/:id/request-edit',
  checkStatus('VERIFIED', 'ACTIVE'),
  checkCompanyPermission('REQUEST_EDIT_JOB'),
  requestJobEdit
);

router.get(
  '/jobs/:id/edit-requests',
  checkStatus('VERIFIED', 'ACTIVE'),
  checkCompanyPermission('REQUEST_EDIT_JOB'),
  getJobEditRequests
);

router.delete(
  '/jobs/:id/edit-requests/:editRequestId',
  checkStatus('VERIFIED', 'ACTIVE'),
  checkCompanyPermission('REQUEST_EDIT_JOB'),
  cancelEditRequest
);

// ==================== CANDIDATE ROUTES ====================
router.get('/candidates', checkCompanyPermission('VIEW_CANDIDATES'), getAllCandidates);
router.get('/candidates/:id', checkCompanyPermission('VIEW_CANDIDATES'), getCandidate);
router.put("/candidates/:id/shortlist", checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('VIEW_CANDIDATES'), shortlistCandidate);
router.put("/candidates/:id/reject", checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('VIEW_CANDIDATES'), rejectCandidate);

// ── Interview Slot Flow ───────────────────────────────────────────────────────
router.post('/jobs/:jobId/interview-slots', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission(['MANAGE_INTERVIEWS_SELF', 'MANAGE_INTERVIEWS_ALL']), createInterviewSlots);
router.get('/jobs/:jobId/interview-slots', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission(['MANAGE_INTERVIEWS_SELF', 'MANAGE_INTERVIEWS_ALL']), getJobInterviewSlots);
router.delete('/jobs/:jobId/interview-slots/:slotId', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission(['MANAGE_INTERVIEWS_SELF', 'MANAGE_INTERVIEWS_ALL']), cancelInterviewSlot);
router.post('/candidates/:id/confirm-interview', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission(['MANAGE_INTERVIEWS_SELF', 'MANAGE_INTERVIEWS_ALL']), confirmInterviewDetails);
router.get('/interview-schedule', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission(['MANAGE_INTERVIEWS_SELF', 'MANAGE_INTERVIEWS_ALL']), getInterviewSchedule);

router.post('/candidates/:id/notes', checkStatus('VERIFIED', 'ACTIVE'), checkCompanyPermission('VIEW_CANDIDATES'), addNote);

module.exports = router;