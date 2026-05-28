// backend/routes/jobInterestRoutes.js
const express = require('express');
const router = express.Router();

const {
    showInterest,
    withdrawInterest,
    getMyInterestedJobs,
    getInterestStatus,
    requestLimitExtension,
    getMyExtensionRequests,
    getMyPerformance,
    getAllExtensionRequests,
    getExtensionRequest,
    reviewExtensionRequest,
    getHotJobs,
    getInterestedPartners,
    getPartnerPerformance
} = require('../controllers/jobInterestController');

const {
    protect,
    authorize,
    authorizeAdminAccess,
    checkPermission
} = require('../middleware/auth');

const { PERMISSIONS } = require('../utils/permissions');

// ==================== PARTNER ROUTES ====================
router.post(
    '/:jobId/interest',
    protect,
    authorize('staffing_partner'),
    showInterest
);

router.delete(
    '/:jobId/interest',
    protect,
    authorize('staffing_partner'),
    withdrawInterest
);

router.get(
    '/my-jobs',
    protect,
    authorize('staffing_partner'),
    getMyInterestedJobs
);

router.get(
    '/:jobId/status',
    protect,
    authorize('staffing_partner'),
    getInterestStatus
);

router.post(
    '/:jobId/request-extension',
    protect,
    authorize('staffing_partner'),
    requestLimitExtension
);

router.get(
    '/extension-requests',
    protect,
    authorize('staffing_partner'),
    getMyExtensionRequests
);

router.get(
    '/my-performance',
    protect,
    authorize('staffing_partner'),
    getMyPerformance
);

// ==================== ADMIN ROUTES ====================
router.get(
    '/admin/hot-jobs',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_PENDING_JOBS),
    getHotJobs
);

router.get(
    '/admin/extension-requests',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
    getAllExtensionRequests
);

router.get(
    '/admin/extension-requests/:id',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
    getExtensionRequest
);

router.put(
    '/admin/extension-requests/:id/review',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.APPROVE_PARTNER),
    reviewExtensionRequest
);

router.get(
    '/admin/jobs/:jobId/interested-partners',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_PENDING_JOBS),
    getInterestedPartners
);

router.get(
    '/admin/partner-performance/:partnerId',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_VERIFICATIONS),
    getPartnerPerformance
);

module.exports = router;