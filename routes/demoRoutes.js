const express = require('express');
const router = express.Router();
const demoController = require('../controllers/demoController');
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/demo
// @desc    Submit a Walkthrough / Demo request (Client or Talent Partner)
// @access  Public
router.post('/', demoController.submitDemoRequest);

// @route   GET /api/demo
// @desc    Get all demo requests
// @access  Private (Admin / Sub-Admin)
router.get('/', protect, authorize('admin', 'sub_admin'), demoController.getDemoRequests);

// @route   PATCH /api/demo/:id/status
// @desc    Update demo request status
// @access  Private (Admin / Sub-Admin)
router.patch('/:id/status', protect, authorize('admin', 'sub_admin'), demoController.updateDemoStatus);

// @route   DELETE /api/demo/:id
// @desc    Delete a demo request
// @access  Private (Admin / Sub-Admin)
router.delete('/:id', protect, authorize('admin', 'sub_admin'), demoController.deleteDemoRequest);

module.exports = router;
