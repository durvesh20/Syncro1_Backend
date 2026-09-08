const express = require('express');
const router = express.Router();
const developerAuthController = require('../controllers/developerAuthController');
const developerApiKeyController = require('../controllers/developerApiKeyController');
const { protectDeveloperPortal } = require('../middleware/developerAuth');

// Public auth routes
router.post('/login', developerAuthController.login);
router.post('/refresh', developerAuthController.refresh);

// Protected portal routes
router.get('/me', protectDeveloperPortal, developerAuthController.me);
router.post('/change-password', protectDeveloperPortal, developerAuthController.changePassword);

// API Key management (protected by developer portal session)
router.get('/api-keys', protectDeveloperPortal, developerApiKeyController.listApiKeys);
router.post('/api-keys', protectDeveloperPortal, developerApiKeyController.createApiKey);
router.delete('/api-keys/:id', protectDeveloperPortal, developerApiKeyController.revokeApiKey);

module.exports = router;
