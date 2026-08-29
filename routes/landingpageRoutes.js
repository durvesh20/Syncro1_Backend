const express = require('express');
const router = express.Router();
const landingpageController = require('../controllers/landingpageController');
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/landingpage/submit
// @desc    Submit lead from landing page
// @access  Public — intentionally unauthenticated (landing page form)
router.post('/submit', landingpageController.submitLead);
router.post('/', landingpageController.submitLead);

// @route   GET /api/landingpage/leads
// @desc    Get all lead submissions
// @access  Private — Admin / Sub-Admin only (PII data)
router.get('/leads', protect, authorize('admin', 'sub_admin'), landingpageController.getLeads);

module.exports = router;
