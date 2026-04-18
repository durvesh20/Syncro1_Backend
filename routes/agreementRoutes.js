// backend/routes/agreementRoutes.js
const express = require('express');
const router = express.Router();

const {
    getAgreementStatus,
    submitQuery,
    getMyQueries,
    acceptAgreement,
    getAllQueries,
    getQuery,
    respondToQuery,
    regenerateAgreementPdf
} = require('../controllers/agreementController');

const {
    protect,
    authorize,
    authorizeAdminAccess,
    checkPermission
} = require('../middleware/auth');

const { PERMISSIONS } = require('../utils/permissions');

// ==================== PARTNER ROUTES ====================
router.get(
    '/status',
    protect,
    authorize('staffing_partner'),
    getAgreementStatus
);

router.get(
    '/queries',
    protect,
    authorize('staffing_partner'),
    getMyQueries
);

router.post(
    '/query',
    protect,
    authorize('staffing_partner'),
    submitQuery
);

router.post(
    '/accept',
    protect,
    authorize('staffing_partner'),
    acceptAgreement
);

// ==================== ADMIN ROUTES ====================
router.get(
    '/admin/queries',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
    getAllQueries
);

router.get(
    '/admin/queries/:id',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
    getQuery
);

router.put(
    '/admin/queries/:id/respond',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.APPROVE_PARTNER),
    respondToQuery
);

router.post(
    '/regenerate/:partnerId',
    protect,
    authorize('admin'),
    regenerateAgreementPdf
);

module.exports = router;