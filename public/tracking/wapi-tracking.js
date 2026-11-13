(function () {
  'use strict';

  // Include this file on the public Syncro1 registration landing page.
  // It preserves WAPI attribution across the SPA -> API registration request.
  var query = new URLSearchParams(window.location.search);
  var campaignKey = query.get('utm_campaign') || '';
  var recipientToken = query.get('wapi_recipient') || '';
  var storageKey = 'syncro1_wapi_attribution_v1';
  var attribution = null;

  try {
    attribution = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
  } catch (_) {}

  if (campaignKey && /^[a-f0-9]{64}$/i.test(campaignKey)) {
    attribution = {
      campaignKey: campaignKey,
      recipientToken: recipientToken,
      visitorId: (attribution && attribution.visitorId) || makeVisitorId()
    };
    try { sessionStorage.setItem(storageKey, JSON.stringify(attribution)); } catch (_) {}
  }

  if (!attribution || !/^[a-f0-9]{64}$/i.test(attribution.campaignKey || '')) return;

  function makeVisitorId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (_) {}
    return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  var endpoint = window.SYNCRO1_CRM_TRACKING_URL ||
    'https://crm.syncro1.com/api/crm/communications/wapi/tracking/event';

  function send(eventType) {
    var payload = {
      campaignKey: attribution.campaignKey,
      recipientToken: attribution.recipientToken || '',
      visitorId: attribution.visitorId,
      eventId: makeVisitorId(),
      eventType: eventType,
      pagePath: window.location.pathname,
      referrerHost: (function () {
        try { return document.referrer ? new URL(document.referrer).host : ''; } catch (_) { return ''; }
      })()
    };
    try {
      fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
  }

  // A page view is emitted only when the WAPI campaign key is present.
  send('PAGE_VIEW');

  function isRegistrationRequest(url) {
    return /\/api\/auth\/register\/(staffing-partner|company)\/init(?:[?#]|$)/i.test(String(url || ''));
  }

  function attachAttribution(body) {
    if (typeof body !== 'string') return body;
    try {
      var data = JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return body;
      data.utm_campaign = attribution.campaignKey;
      data.utm_source = 'whatsapp';
      data.utm_medium = 'campaign';
      data.wapi_recipient = attribution.recipientToken || '';
      data.visitorId = attribution.visitorId;
      return JSON.stringify(data);
    } catch (_) {
      return body;
    }
  }

  // Preserve attribution when the registration SPA posts JSON with fetch.
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

  // Keep attribution on same-site navigation within the registration flow.
  window.syncro1WapiAttribution = attribution;
})();