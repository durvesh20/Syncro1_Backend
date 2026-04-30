const express = require('express');
const router = express.Router();
const { handleConsent, getConsentStatus } = require('../controllers/consentController');

router.get('/consent/confirm', handleConsent);
router.get('/consent/deny', handleConsent);
router.get('/consent/candidate/:action/:token', handleConsent);

// ✅ API to check consent status (optional, for frontend)
router.get('/api/candidates/consent/status/:token', getConsentStatus);

module.exports = router;