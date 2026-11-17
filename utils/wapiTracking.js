const http = require('http');
const crypto = require('crypto');

const VISITOR_PATH = '/api/crm/communications/wapi/tracking/visitor';
const CAMPAIGN_PATH = '/api/crm/communications/wapi/tracking/event';
const ALLOWED_VISITOR_EVENTS = new Set([
  'LANDING_PAGE_ARRIVED',
  'REGISTRATION_STARTED',
  'REGISTRATION_COMPLETED'
]);
const validCampaign = (value) => /^[a-f0-9]{64}$/i.test(String(value || '').trim());
const validVisitor = (value) => /^[a-zA-Z0-9_-]{12,100}$/.test(String(value || '').trim());

/**
 * Build the CRM requests for a registration lifecycle event.
 *
 * Every valid visitor event is sent to the anonymous visitor endpoint so the
 * same visitor lead is created/updated even when campaign attribution exists.
 * Campaign analytics are an additional request, never a replacement.
 */
const buildTrackingRequests = (eventType, attribution = {}, eventId = crypto.randomUUID()) => {
  const campaignKey = String(attribution.utm_campaign || attribution.campaignKey || '').trim();
  const recipientToken = String(attribution.wapi_recipient || attribution.recipientToken || '').trim();
  const visitorId = String(attribution.visitorId || '').trim();
  const normalizedEvent = String(eventType || '').trim().toUpperCase();

  if (!validVisitor(visitorId) || !ALLOWED_VISITOR_EVENTS.has(normalizedEvent)) return [];

  const commonPayload = {
    visitorId,
    eventId,
    eventType: normalizedEvent,
    pagePath: '/auth/register/campaign/talent-partner',
    referrerHost: 'syncro1.com'
  };

  const requests = [{ path: VISITOR_PATH, payload: commonPayload }];

  if (validCampaign(campaignKey)) {
    requests.push({
      path: CAMPAIGN_PATH,
      payload: {
        ...commonPayload,
        campaignKey,
        recipientToken
      }
    });
  }

  return requests;
};

const postToCRM = ({ path, payload }) => {
  const body = JSON.stringify(payload);
  const req = http.request({
    hostname: process.env.CRM_INTERNAL_HOST || '127.0.0.1',
    port: Number(process.env.CRM_INTERNAL_PORT || 5001),
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-internal-source': 'syncro1-platform'
    },
    timeout: 2500
  }, (res) => {
    res.resume();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.warn('[WAPI TRACKING] CRM returned HTTP', res.statusCode);
    }
  });

  req.on('timeout', () => req.destroy(new Error('CRM tracking request timed out')));
  req.on('error', (error) => console.warn('[WAPI TRACKING] non-critical:', error.message));
  req.write(body);
  req.end();
};

const trackWapiRegistration = (eventType, attribution = {}) => {
  const requests = buildTrackingRequests(eventType, attribution);
  requests.forEach(postToCRM);
};

module.exports = { trackWapiRegistration, buildTrackingRequests };
