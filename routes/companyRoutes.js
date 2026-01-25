// backend/routes/companyRoutes.js
const express = require('express');
const router = express.Router();
const {
  getProfile,
  updateKYC,
  updateHiringPreferences,
  updateBilling,
  updateLegalConsents,
  submitProfile,
  createJob,
  getJobs,
  getJobCandidates,
  updateCandidateStatus,
  scheduleInterview,
  makeOffer,
  confirmJoining,
  getDashboard
} = require('../controllers/companyController');
const { protect, authorize, checkStatus } = require('../middleware/auth');

router.use(protect);
router.use(authorize('company'));

// Profile routes
router.get('/profile', getProfile);
router.put('/profile/kyc', updateKYC);
router.put('/profile/hiring-preferences', updateHiringPreferences);
router.put('/profile/billing', updateBilling);
router.put('/profile/legal-consents', updateLegalConsents);
router.post('/profile/submit', submitProfile);

// Job routes (requires verified status)
router.route('/jobs')
  .get(getJobs)
  .post(checkStatus('VERIFIED', 'ACTIVE'), createJob);

router.get('/jobs/:jobId/candidates', checkStatus('VERIFIED', 'ACTIVE'), getJobCandidates);

// Candidate management
router.put('/candidates/:id/status', checkStatus('VERIFIED', 'ACTIVE'), updateCandidateStatus);
router.post('/candidates/:id/interviews', checkStatus('VERIFIED', 'ACTIVE'), scheduleInterview);
router.post('/candidates/:id/offer', checkStatus('VERIFIED', 'ACTIVE'), makeOffer);
router.post('/candidates/:id/joining', checkStatus('VERIFIED', 'ACTIVE'), confirmJoining);

// Dashboard
router.get('/dashboard', getDashboard);

module.exports = router;