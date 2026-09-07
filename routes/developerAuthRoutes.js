// backend/routes/developerAuthRoutes.js
const express = require('express');
const router = express.Router();
const developerAuthController = require('../controllers/developerAuthController');
const { protectDeveloper } = require('../middleware/developerAuth');

router.post('/login', developerAuthController.login);
router.post('/refresh', developerAuthController.refresh);
router.get('/me', protectDeveloper, developerAuthController.me);

module.exports = router;

