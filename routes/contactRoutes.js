const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/contact
// @desc    Submit a contact form message
// @access  Public
router.post('/', contactController.submitContactMessage);

// @route   GET /api/contact
// @desc    Get all contact messages
// @access  Private (Admin / Sub-Admin)
router.get('/', protect, authorize('admin', 'sub_admin'), contactController.getContactMessages);

// @route   PATCH /api/contact/:id/status
// @desc    Update contact message status
// @access  Private (Admin / Sub-Admin)
router.patch('/:id/status', protect, authorize('admin', 'sub_admin'), contactController.updateMessageStatus);

module.exports = router;

