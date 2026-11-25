// backend/routes/pehchaanRoutes.js
//
// Two routers:
//   pehchaanRouter        -> mounted at /api/pehchaan  (resident-facing)
//   aadhaarCallbackRouter -> mounted at /api/aadhaar   (UIDAI-facing, PUBLIC)

const express = require('express');
const rateLimit = require('express-rate-limit');

const { protect, authorize } = require('../middleware/auth');
const pehchaanController = require('../controllers/pehchaanController');
const callbackController = require('../controllers/aadhaarCallbackController');

const pehchaanRouter = express.Router();
const aadhaarCallbackRouter = express.Router();

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

// Starting a verification mints a signed UIDAI request - keep it tight.
const initLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: {
    success: false,
    message: 'Too many verification attempts. Please wait a minute and try again.'
  }
});

// Polling runs every few seconds while the resident is in the Aadhaar App.
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip)
});

// ---------------------------------------------------------------------------
// Resident-facing routes (/api/pehchaan)
// ---------------------------------------------------------------------------

pehchaanRouter.get('/config', protect, pehchaanController.getConfig);

pehchaanRouter.post(
  '/init',
  protect,
  authorize('freelancer'),
  initLimiter,
  pehchaanController.initPehchaan
);

pehchaanRouter.get(
  '/status/:txnId',
  protect,
  statusLimiter,
  pehchaanController.getStatus
);

// No resume endpoint: the Cross-Device QR (spec §3.2.3) carries the signed
// request itself, so the phone never needs to call back here to fetch it.

// ---------------------------------------------------------------------------
// UIDAI callback (/api/aadhaar) - PUBLIC, no auth middleware
// ---------------------------------------------------------------------------
//
// Spec §3.3 posts an XML envelope. express.text({type:'*/*'}) captures it as a
// raw string for parseCallbackXml(); this router is mounted ahead of the global
// express.json() in server.js so the body always arrives unparsed.

aadhaarCallbackRouter.post(
  '/callback',
  express.text({ type: '*/*', limit: '2mb' }),
  callbackController.handleCallback
);

aadhaarCallbackRouter.get('/callback', callbackController.healthCheck);

module.exports = { pehchaanRouter, aadhaarCallbackRouter };
