// backend/routes/reportRoutes.js
const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');
const reportController = require('../controllers/reportController');

// All report endpoints require an authenticated user.
// Per-report-type role checks happen inside the controller (against the registry),
// so we don't need a fixed role list here — the registry is the single gatekeeper.
router.use(protect);

router.get('/types', reportController.getReportTypes);
router.get('/config/:reportType', reportController.getReportConfig);
router.get('/template/:reportType', reportController.getReportTemplate);
router.post('/template/:reportType', reportController.saveReportTemplate);
router.delete('/template/:templateId', reportController.deleteReportTemplate);
router.get('/admin/logs', reportController.getAdminReportDownloadLogs);
router.post('/preview', reportController.previewReport);
router.post('/generate', reportController.generateReport);
router.post('/debug', reportController.debugReport);

module.exports = router;
