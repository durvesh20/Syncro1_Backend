// routes/onboardingRoutes.js
const express = require('express');
const router = express.Router();
const {
    getOnboardingStatus,
    saveStep,
    validateField
} = require('../controllers/onboardingController');
const { protect } = require('../middleware/auth');

// All routes require authentication
router.use(protect);

// Get onboarding status
router.get('/status', getOnboardingStatus);

// Save step data
router.put('/step/:stepNumber', saveStep);

// Real-time field validation
router.post('/validate-field', validateField);

module.exports = router;