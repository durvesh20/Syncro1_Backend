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
    checkPermission,
    checkTalentPartnerPermission
} = require('../middleware/auth');

const { PERMISSIONS, TALENT_PARTNER_PERMISSIONS } = require('../utils/permissions');

// ==================== PARTNER ROUTES ====================
router.post(
    '/:jobId/interest',
    protect,
    authorize('talent_partner'),
    checkTalentPartnerPermission(TALENT_PARTNER_PERMISSIONS.MANAGE_INTERESTED_JOBS),
    showInterest
);

router.delete(
    '/:jobId/interest',
    protect,
    authorize('talent_partner'),
    checkTalentPartnerPermission(TALENT_PARTNER_PERMISSIONS.MANAGE_INTERESTED_JOBS),
    withdrawInterest
);

router.get(
    '/my-jobs',
    protect,
    authorize('talent_partner'),
    checkTalentPartnerPermission([TALENT_PARTNER_PERMISSIONS.MANAGE_INTERESTED_JOBS, TALENT_PARTNER_PERMISSIONS.VIEW_JOBS]),
    getMyInterestedJobs
);

router.get(
    '/:jobId/status',
    protect,
    authorize('talent_partner'),
    checkTalentPartnerPermission([TALENT_PARTNER_PERMISSIONS.MANAGE_INTERESTED_JOBS, TALENT_PARTNER_PERMISSIONS.VIEW_JOBS]),
    getInterestStatus
);

router.post(
    '/:jobId/request-extension',
    protect,
    authorize('talent_partner'),
    checkTalentPartnerPermission(TALENT_PARTNER_PERMISSIONS.REQUEST_EXTENSIONS),
    requestLimitExtension
);

router.get(
    '/extension-requests',
    protect,
    authorize('talent_partner'),
    checkTalentPartnerPermission(TALENT_PARTNER_PERMISSIONS.REQUEST_EXTENSIONS),
    getMyExtensionRequests
);

router.get(
    '/my-performance',
    protect,
    authorize('talent_partner'),
    getMyPerformance
);

// ==================== ADMIN ROUTES ====================
router.get(
    '/admin/hot-jobs',
    protect,
    authorizeAdminAccess,
    getHotJobs
);

router.get(
    '/admin/extension-requests',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_EXTENSION_REQUESTS),
    getAllExtensionRequests
);

router.get(
    '/admin/extension-requests/:id',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_EXTENSION_REQUESTS),
    getExtensionRequest
);

router.put(
    '/admin/extension-requests/:id/review',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.APPROVE_EXTENSION_REQUEST),
    reviewExtensionRequest
);

router.get(
    '/admin/jobs/:jobId/interested-partners',
    protect,
    authorizeAdminAccess,
    getInterestedPartners
);

router.get(
    '/admin/partner-performance/:partnerId',
    protect,
    authorizeAdminAccess,
    checkPermission(PERMISSIONS.VIEW_EXTENSION_REQUESTS),
    getPartnerPerformance
);

module.exports = router;