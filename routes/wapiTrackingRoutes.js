const express = require('express');
const http = require('http');

const router = express.Router();
const CRM_HOST = process.env.CRM_INTERNAL_HOST || '127.0.0.1';
const CRM_PORT = Number(process.env.CRM_INTERNAL_PORT || 5001);

const validVisitorId = (value) => /^[a-zA-Z0-9_-]{12,100}$/.test(String(value || '').trim());
const allowedPagePath = /^\/auth\/register\/campaign\/talent-partner\/?$/i;

const forwardToCRM = (crmPath) => (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const visitorId = String(body.visitorId || '').trim();
  const pagePath = String(body.pagePath || '').trim();
  const eventType = String(body.eventType || 'LANDING_PAGE_ARRIVED').trim().toUpperCase();
  const eventId = String(body.eventId || '').trim();

  if (!validVisitorId(visitorId)) {
    return res.status(400).json({ success: false, message: 'A valid visitor ID is required.' });
  }
  if (!allowedPagePath.test(pagePath)) {
    return res.status(400).json({ success: false, message: 'Unsupported tracking page.' });
  }
  if (!eventId || eventId.length > 120) {
    return res.status(400).json({ success: false, message: 'A valid event ID is required.' });
  }

  const allowedEvents = crmPath.endsWith('/visitor')
    ? new Set(['LANDING_PAGE_ARRIVED', 'REGISTRATION_STARTED', 'REGISTRATION_COMPLETED'])
    : new Set(['PAGE_VIEW', 'BUTTON_CLICKED', 'REGISTRATION_STARTED', 'REGISTRATION_COMPLETED']);
  if (!allowedEvents.has(eventType)) {
    return res.status(400).json({ success: false, message: 'Unsupported tracking event.' });
  }

  const payload = {
    visitorId,
    eventId,
    eventType,
    pagePath,
    referrerHost: String(body.referrerHost || '').slice(0, 180)
  };

  if (crmPath.endsWith('/event')) {
    payload.campaignKey = String(body.campaignKey || '').trim();
    payload.recipientToken = String(body.recipientToken || '').trim();
  }

  const encoded = JSON.stringify(payload);
  const request = http.request({
    hostname: CRM_HOST,
    port: CRM_PORT,
    path: crmPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(encoded),
      'x-internal-source': 'syncro1-platform'
    },
    timeout: 3000
  }, (response) => {
    let responseBody = '';
    response.on('data', (chunk) => { responseBody += chunk; });
    response.on('end', () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return res.status(202).json({ success: true, accepted: true });
      }
      console.warn('[WAPI TRACKING PROXY] CRM returned HTTP', response.statusCode);
      return res.status(502).json({ success: false, message: 'Tracking service is temporarily unavailable.' });
    });
  });

  request.on('timeout', () => request.destroy(new Error('CRM tracking request timed out')));
  request.on('error', (error) => {
    console.warn('[WAPI TRACKING PROXY] non-critical:', error.message);
    if (!res.headersSent) res.status(502).json({ success: false, message: 'Tracking service is temporarily unavailable.' });
  });
  request.write(encoded);
  request.end();
};

// Browser requests use the HTTPS devapi.syncro1.com origin.
// The CRM is contacted server-to-server; no browser CORS dependency on the CRM UI host.
router.post('/visitor', forwardToCRM('/api/crm/communications/wapi/tracking/visitor'));
router.post('/event', forwardToCRM('/api/crm/communications/wapi/tracking/event'));

module.exports = router;
