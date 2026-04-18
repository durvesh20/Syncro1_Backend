// backend/routes/agreementRoutes.js
const express = require('express');
const router = express.Router();

const {
    acceptAgreement,
    getAgreementStatus,
    regenerateAgreementPdf
} = require('../controllers/agreementController');

const { protect, authorize } = require('../middleware/auth');

// Partner routes
router.use(protect);

router.get('/status', authorize('staffing_partner'), getAgreementStatus);
router.post('/accept', authorize('staffing_partner'), acceptAgreement);

// Admin only - regenerate PDF with new design
router.post(
    '/regenerate/:partnerId',
    authorize('admin'),
    regenerateAgreementPdf
);

module.exports = router;