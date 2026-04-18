// backend/routes/aiRoutes.js
const express = require('express');
const router = express.Router();

const {
    parseResume,
    parseResumeFromUpload
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

// Upload resume and parse in one step
router.post(
    '/parse-resume/upload',
    authorize('staffing_partner', 'admin', 'sub_admin'),
    uploadResume,
    handleUploadError,
    parseResumeFromUpload
);

module.exports = router;