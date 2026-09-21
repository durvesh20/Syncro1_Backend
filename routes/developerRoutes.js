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
router.put('/jobs/:id', requireScope('jobs:write'), developerController.updateJob);
router.patch('/jobs/:id/status', requireScope('jobs:write'), developerController.updateJobStatus);
router.post('/jobs/:id/publish', requireScope('jobs:write'), developerController.publishJob);
router.post('/jobs/:id/pause', requireScope('jobs:write'), developerController.pauseJob);
router.post('/jobs/:id/reopen', requireScope('jobs:write'), developerController.reopenJob);
router.post('/jobs/:id/close', requireScope('jobs:write'), developerController.closeJob);
router.get('/jobs/:id/status', requireScope('jobs:read'), developerController.getJobStatus);
router.get('/jobs/:id/candidates', requireScope('candidates:read'), developerController.getJobCandidates);
router.post('/jobs/:id/interview-slots', requireScope('interviews:write'), developerController.createJobInterviewSlots);
router.get('/jobs/:id/interview-slots', requireScope('interviews:read'), developerController.getJobInterviewSlots);

/* ── 2. Candidates API ─────────────────────────────────────────────────── */
router.get('/candidates', requireScope('candidates:read'), developerController.listCandidates);
router.get('/candidates/:id', requireScope('candidates:read'), developerController.getCandidate);
router.get('/candidates/:id/pipeline', requireScope('candidates:read'), developerController.getCandidatePipeline);
router.get('/candidates/:id/status', requireScope('statuses:read'), developerController.getCandidateStatus);
router.post('/candidates/:id/status', requireScope(['statuses:write', 'candidates:write']), developerController.updateCandidateStatus);

/* ── 2.1 Candidate Override & Lifecycle Progression Actions ──────────────── */
router.post('/candidates/:id/global-reject', requireScope(['candidates:write', 'statuses:write']), developerController.globalRejectCandidate);
router.post('/candidates/:id/reject', requireScope(['candidates:write', 'statuses:write']), developerController.globalRejectCandidate);
router.post('/candidates/:id/client-portal-duplicate', requireScope(['candidates:write', 'statuses:write']), developerController.clientPortalDuplicate);
router.post('/candidates/:id/candidate-drop', requireScope(['candidates:write', 'statuses:write']), developerController.candidateDrop);
router.post('/candidates/:id/mark-joined', requireScope(['candidates:write', 'statuses:write']), developerController.markJoined);
router.post('/candidates/:id/mark-not-joined', requireScope(['candidates:write', 'statuses:write']), developerController.markNotJoined);
router.post('/candidates/:id/onboarding/confirm', requireScope(['candidates:write', 'statuses:write']), developerController.confirmOnboarding);

/* ── 2.2 Candidate Interview Pipeline & Actions ───────────────────────── */
router.post('/candidates/:id/schedule-interview', requireScope('interviews:write'), developerController.scheduleInterview);
router.post('/candidates/:id/resend-interview-consent', requireScope('interviews:write'), developerController.resendInterviewConsent);
router.post('/candidates/:id/reschedule-interview', requireScope('interviews:write'), developerController.requestInterviewReschedule);
router.post('/candidates/:id/confirm-reschedule', requireScope('interviews:write'), developerController.confirmInterviewReschedule);
router.post('/candidates/:id/reject-reschedule', requireScope('interviews:write'), developerController.rejectInterviewReschedule);
router.post('/candidates/:id/interviews/result', requireScope('interviews:write'), developerController.submitInterviewResult);

/* ── 2.3 Candidate Assessment Actions ─────────────────────────────────── */
router.post('/candidates/:id/assessment/send', requireScope('candidates:write'), developerController.sendAssessmentLink);
router.post('/candidates/:id/assessment/complete', requireScope('candidates:write'), developerController.completeAssessment);
router.post('/candidates/:id/assessment/result', requireScope('candidates:write'), developerController.submitAssessmentResult);

/* ── 2.4 Candidate Offer Release ──────────────────────────────────────── */
router.post('/candidates/:id/offer', requireScope('candidates:write'), developerController.sendOffer);

/* ── 3. Interviews API (Classic) ──────────────────────────────────────── */
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

