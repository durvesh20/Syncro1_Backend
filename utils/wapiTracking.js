const http = require('http');

const CRM_HOST = process.env.CRM_INTERNAL_HOST || '127.0.0.1';
const CRM_PORT = Number(process.env.CRM_INTERNAL_PORT || 5001);
const CRM_PATH = '/api/crm/communications/wapi/tracking/event';

const validCampaign = (value) => /^[a-f0-9]{64}$/i.test(String(value || '').trim());

const trackWapiRegistration = (eventType, attribution = {}) => {
  const campaignKey = String(attribution.utm_campaign || attribution.campaignKey || '').trim();
  const recipientToken = String(attribution.wapi_recipient || attribution.recipientToken || '').trim();
  const visitorId = String(attribution.visitorId || '').trim();

  if (!validCampaign(campaignKey) || !visitorId || visitorId.length < 12) return;

  const body = JSON.stringify({
    campaignKey,
    recipientToken,
    visitorId,
    eventId: require('crypto').randomUUID(),
    eventType,
    pagePath: '/auth/register/talent-partner',
    referrerHost: 'syncro1.com'
  });

  const req = http.request({
    hostname: CRM_HOST,
    port: CRM_PORT,
    path: CRM_PATH,
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
