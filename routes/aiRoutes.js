// backend/routes/aiRoutes.js
const express = require('express');
const router = express.Router();

const {
    parseResume,
    parseResumeFromUpload,
    parseMultipleResumes
} = require('../controllers/aiController');

const { protect, authorize } = require('../middleware/auth');
const { uploadResume, handleUploadError } = require('../middleware/upload');

// All AI routes require authentication
router.use(protect);

// Parse resume from existing Cloudinary URL
router.post(
    '/parse-resume',
    authorize('staffing_partner', 'admin', 'sub_admin'),
    parseResume
);

// Batch parse up to 5 resumes against JD
router.post(
    '/parse-multiple-resumes',
    authorize('staffing_partner', 'admin', 'sub_admin'),
    parseMultipleResumes
);

// Upload resume and parse in one step
router.post(
    '/parse-resume/upload',
    authorize('staffing_partner', 'admin', 'sub_admin'),
    uploadResume,
    handleUploadError,
    parseResumeFromUpload
);

module.exports = router;