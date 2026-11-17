(function () {
  'use strict';

  // Install this script once on the public Talent Partner registration page.
  // Static WhatsApp URL buttons cannot expose recipient-level click webhooks.
  // Therefore this records a landing-page arrival and carries one visitor ID
  // into the registration API so the anonymous CRM lead can be enriched later.
  var path = window.location.pathname || '';
  if (!/^\/auth\/register\/campaign\/talent-partner\/?$/i.test(path)) return;

  var query = new URLSearchParams(window.location.search);
  var campaignKey = query.get('utm_campaign') || '';
  var recipientToken = query.get('wapi_recipient') || '';
  var attributionKey = 'syncro1_wapi_attribution_v2';
  var visitorStorageKey = 'syncro1_wapi_visitor_v1';
  var attribution = null;

  function makeId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (_) {}
    return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function safeRead(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }
  function safeWrite(storage, key, value) {
    try { storage.setItem(key, value); } catch (_) {}
  }

  var visitorId = safeRead(localStorage, visitorStorageKey);
  if (!visitorId || !/^[a-zA-Z0-9_-]{12,100}$/.test(visitorId)) {
    visitorId = makeId();
    safeWrite(localStorage, visitorStorageKey, visitorId);
  }

  try { attribution = JSON.parse(safeRead(sessionStorage, attributionKey) || 'null'); } catch (_) {}
  attribution = attribution && typeof attribution === 'object' ? attribution : {};
  attribution.visitorId = visitorId;

  if (/^[a-f0-9]{64}$/i.test(campaignKey)) {
    attribution.campaignKey = campaignKey;
    attribution.recipientToken = recipientToken;
  }
  safeWrite(sessionStorage, attributionKey, JSON.stringify(attribution));

  var endpointBase = String(window.SYNCRO1_CRM_TRACKING_URL || 'https://crm.syncro1.com/api/crm/communications/wapi/tracking').replace(/\/$/, '');
  var hasCampaignAttribution = /^[a-f0-9]{64}$/i.test(attribution.campaignKey || '');
  var eventEndpoint = endpointBase + '/event';
  var visitorEndpoint = endpointBase + '/visitor';

  function referrerHost() {
    try { return document.referrer ? new URL(document.referrer).host : ''; } catch (_) { return ''; }
  }

  function postJson(url, payload) {
    try {
      fetch(url, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  // Stable per-tab event ID means reload retries do not create another lead.
  var arrivalEventKey = 'syncro1_wapi_arrival_event_v1';
  var arrivalEventId = safeRead(sessionStorage, arrivalEventKey);
  if (!arrivalEventId) {
    arrivalEventId = makeId();
    safeWrite(sessionStorage, arrivalEventKey, arrivalEventId);
  }

  if (hasCampaignAttribution) {
    postJson(eventEndpoint, {
      campaignKey: attribution.campaignKey,
      recipientToken: attribution.recipientToken || '',
      visitorId: visitorId,
      eventId: arrivalEventId,
      eventType: 'PAGE_VIEW',
      pagePath: path,
      referrerHost: referrerHost()
    });
  } else {
    // Static approved template URL: no per-recipient campaign token is exposed.
    // Record the visit as a landing arrival, not as a verified button click.
    postJson(visitorEndpoint, {
      visitorId: visitorId,
      eventId: arrivalEventId,
      pagePath: path,
      referrerHost: referrerHost()
    });
  }

  function isRegistrationRequest(url) {
    return /\/api\/auth\/register\/(staffing-partner|company)\/init(?:[?#]|$)/i.test(String(url || ''));
  }

  function attachAttribution(body) {
    if (typeof body !== 'string') return body;
    try {
      var data = JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return body;
      data.visitorId = visitorId;
      if (hasCampaignAttribution) {
        data.utm_campaign = attribution.campaignKey;
        data.utm_source = 'whatsapp';
        data.utm_medium = 'campaign';
        data.wapi_recipient = attribution.recipientToken || '';
      }
      return JSON.stringify(data);
    } catch (_) {
      return body;
    }
  }

  // Preserve the visitor ID through fetch-based registration API requests.
  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (isRegistrationRequest(url) && init && typeof init.body === 'string') {
        init = Object.assign({}, init, { body: attachAttribution(init.body) });
      }
      return originalFetch.call(this, input, init);
    };
  }

  // Also support XMLHttpRequest-based API clients.
  if (window.XMLHttpRequest) {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__syncro1WapiRegistration = isRegistrationRequest(url);
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (this.__syncro1WapiRegistration) body = attachAttribution(body);
      return originalSend.call(this, body);
    };
  }

  window.syncro1WapiAttribution = {
    visitorId: visitorId,
    campaignKey: hasCampaignAttribution ? attribution.campaignKey : null,
    recipientToken: hasCampaignAttribution ? attribution.recipientToken || null : null
  };
})();