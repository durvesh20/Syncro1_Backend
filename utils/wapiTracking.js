const http = require('http');
const crypto = require('crypto');

const CRM_HOST = process.env.CRM_INTERNAL_HOST || '127.0.0.1';
const CRM_PORT = Number(process.env.CRM_INTERNAL_PORT || 5001);
const CAMPAIGN_PATH = '/api/crm/communications/wapi/tracking/event';
const VISITOR_PATH = '/api/crm/communications/wapi/tracking/visitor';

const validCampaign = (value) => /^[a-f0-9]{64}$/i.test(String(value || '').trim());
const validVisitor = (value) => /^[a-zA-Z0-9_-]{12,100}$/.test(String(value || '').trim());

const trackWapiRegistration = (eventType, attribution = {}) => {
  const campaignKey = String(attribution.utm_campaign || attribution.campaignKey || '').trim();
  const recipientToken = String(attribution.wapi_recipient || attribution.recipientToken || '').trim();
  const visitorId = String(attribution.visitorId || '').trim();
  const normalizedEvent = String(eventType || '').trim().toUpperCase();

  if (!validVisitor(visitorId)) return;
  const hasCampaign = validCampaign(campaignKey);
  if (!hasCampaign && !['REGISTRATION_STARTED', 'REGISTRATION_COMPLETED'].includes(normalizedEvent)) return;

  const body = JSON.stringify(hasCampaign ? {
    campaignKey,
    recipientToken,
    visitorId,
    eventId: crypto.randomUUID(),
    eventType: normalizedEvent,
    pagePath: '/auth/register/campaign/talent-partner',
    referrerHost: 'syncro1.com'
  } : {
    visitorId,
    eventId: crypto.randomUUID(),
    eventType: normalizedEvent,
    pagePath: '/auth/register/campaign/talent-partner',
    referrerHost: 'syncro1.com'
  });

  const req = http.request({
    hostname: CRM_HOST,
    port: CRM_PORT,
    path: hasCampaign ? CAMPAIGN_PATH : VISITOR_PATH,
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

  req.on('timeout', () => req.destroy());
  req.on('error', (error) => console.warn('[WAPI TRACKING] non-critical:', error.message));
  req.write(body);
  req.end();
};

module.exports = { trackWapiRegistration };
