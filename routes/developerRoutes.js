// backend/routes/developerRoutes.js
const express = require('express');
const router = express.Router();
const developerController = require('../controllers/developerController');
const { protectDeveloper, requireScope } = require('../middleware/developerAuth');
const {
  requestIdMiddleware,
  clientRateLimiter,
  idempotencyMiddleware,
  apiLoggerMiddleware
} = require('../middleware/developerApiMiddleware');

// Apply common infrastructure middleware to all /api/v1 routes
router.use(requestIdMiddleware);
router.use(protectDeveloper);
router.use(clientRateLimiter);
router.use(idempotencyMiddleware);
router.use(apiLoggerMiddleware);

/* ── 1. Jobs API ────────────────────────────────────────────────────────── */
router.post('/jobs', requireScope('jobs:write'), developerController.createJob);
router.get('/jobs', requireScope('jobs:read'), developerController.listJobs);
router.get('/jobs/:id', requireScope('jobs:read'), developerController.getJob);
router.patch('/jobs/:id', requireScope('jobs:write'), developerController.updateJob);
router.post('/jobs/:id/publish', requireScope('jobs:write'), developerController.publishJob);
router.post('/jobs/:id/pause', requireScope('jobs:write'), developerController.pauseJob);
router.post('/jobs/:id/reopen', requireScope('jobs:write'), developerController.reopenJob);
router.post('/jobs/:id/close', requireScope('jobs:write'), developerController.closeJob);
router.get('/jobs/:id/status', requireScope('jobs:read'), developerController.getJobStatus);
router.get('/jobs/:id/candidates', requireScope('candidates:read'), developerController.getJobCandidates);

/* ── 2. Candidates API ─────────────────────────────────────────────────── */
router.get('/candidates', requireScope('candidates:read'), developerController.listCandidates);
router.get('/candidates/:id', requireScope('candidates:read'), developerController.getCandidate);
router.get('/candidates/:id/status', requireScope('statuses:read'), developerController.getCandidateStatus);
router.post('/candidates/:id/status', requireScope('statuses:write'), developerController.updateCandidateStatus);

/* ── 3. Interviews API ─────────────────────────────────────────────────── */
router.get('/interviews', requireScope('interviews:read'), developerController.listInterviews);
router.get('/interviews/:id', requireScope('interviews:read'), developerController.getInterview);
router.post('/interviews', requireScope('interviews:write'), developerController.createInterview);
router.post('/interviews/:id/cancel', requireScope('interviews:write'), developerController.cancelInterview);

/* ── 4. Webhooks API ───────────────────────────────────────────────────── */
router.get('/webhooks', requireScope('webhooks:read'), developerController.listWebhooks);
router.post('/webhooks', requireScope('webhooks:write'), developerController.createWebhook);
router.delete('/webhooks/:id', requireScope('webhooks:write'), developerController.deleteWebhook);
router.post('/webhooks/:id/test', requireScope('webhooks:write'), developerController.testWebhook);
router.get('/webhooks/:id/deliveries', requireScope('webhooks:read'), developerController.listWebhookDeliveries);
router.get('/webhooks/deliveries', requireScope('webhooks:read'), developerController.listWebhookDeliveries);

/* ── 5. Integration & Logs ─────────────────────────────────────────────── */
router.get('/integration', requireScope('integration:read'), developerController.getIntegration);
router.get('/logs/api', requireScope('logs:read'), developerController.listApiLogs);
router.get('/logs/api/:requestId', requireScope('logs:read'), developerController.getApiLogDetail);

module.exports = router;

