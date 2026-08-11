const express = require('express');
const router = express.Router();
const landingpageController = require('../controllers/landingpageController');

// @route   POST /api/landingpage/submit
// @desc    Submit lead from landing page
router.post('/submit', landingpageController.submitLead);
router.post('/', landingpageController.submitLead);

// @route   GET /api/landingpage/leads
// @desc    Get all lead submissions
router.get('/leads', landingpageController.getLeads);

module.exports = router;
