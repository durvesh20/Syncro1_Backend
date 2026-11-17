(function () {
  'use strict';

  // Install once on /auth/register/campaign/talent-partner.
  // A static WhatsApp URL proves landing arrival, not the recipient-specific click.
  var path = window.location.pathname || '';
  if (!/^\/auth\/register\/campaign\/talent-partner\/?$/i.test(path)) return;

  var query = new URLSearchParams(window.location.search);
  var campaignKey = query.get('utm_campaign') || '';
  var recipientToken = query.get('wapi_recipient') || '';
  var attributionKey = 'syncro1_wapi_attribution_v2';
  var visitorStorageKey = 'syncro1_wapi_visitor_v1';
  var trackingApi = String(window.SYNCRO1_WAPI_TRACKING_API ||
    'https://devapi.syncro1.com/api/wapi-tracking').replace(/\/$/, '');
  var attribution = null;

  function makeId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (_) {}
    return 'v_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  function safeRead(storage, key) {
    try { return storage.getItem(key); } catch (_) { return null; }
  }
  function safeWrite(storage, key, value) {
    try { storage.setItem(key, value); } catch (_) {}
  }

  var visitorId = safeRead(window.localStorage, visitorStorageKey);
  if (!visitorId || !/^[a-zA-Z0-9_-]{12,100}$/.test(visitorId)) {
    visitorId = makeId();
    safeWrite(window.localStorage, visitorStorageKey, visitorId);
  }

  try { attribution = JSON.parse(safeRead(window.sessionStorage, attributionKey) || 'null'); } catch (_) {}
  attribution = attribution && typeof attribution === 'object' ? attribution : {};
  attribution.visitorId = visitorId;

  if (/^[a-f0-9]{64}$/i.test(campaignKey)) {
    attribution.campaignKey = campaignKey;
    attribution.recipientToken = recipientToken;
  }
  safeWrite(window.sessionStorage, attributionKey, JSON.stringify(attribution));

  var hasCampaignAttribution = /^[a-f0-9]{64}$/i.test(attribution.campaignKey || '');

  function referrerHost() {
    try { return document.referrer ? new URL(document.referrer).host : ''; } catch (_) { return ''; }
  }

  function postJson(pathSuffix, payload) {
    try {
      return window.fetch(trackingApi + pathSuffix, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_) {
      return Promise.resolve();
    }
  }

  function visitorEvent(eventType, eventId) {
    return postJson('/visitor', {
      visitorId: visitorId,
      eventId: eventId,
      eventType: eventType,
      pagePath: path,
      referrerHost: referrerHost()
    });
  }

  // One stable arrival event per tab; reloads do not create duplicate leads.
  var arrivalEventKey = 'syncro1_wapi_arrival_event_v1';
  var arrivalEventId = safeRead(window.sessionStorage, arrivalEventKey);
  if (!arrivalEventId) {
    arrivalEventId = makeId();
    safeWrite(window.sessionStorage, arrivalEventKey, arrivalEventId);
  }

  if (hasCampaignAttribution) {
    postJson('/event', {
      campaignKey: attribution.campaignKey,
      recipientToken: attribution.recipientToken || '',
      visitorId: visitorId,
      eventId: arrivalEventId,
      eventType: 'PAGE_VIEW',
      pagePath: path,
      referrerHost: referrerHost()
    });
  } else {
    visitorEvent('LANDING_PAGE_ARRIVED', arrivalEventId);
  }

  function isRegistrationRequest(url) {
    return /\/api\/auth\/register\/(staffing-partner|talent-partner|company)\/init(?:[?#]|$)/i.test(String(url || ''));
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

  // Preserve visitor attribution through fetch-based registration requests.
  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url);
      if (isRegistrationRequest(url)) {
        if (init && typeof init.body === 'string') {
          init = Object.assign({}, init, { body: attachAttribution(init.body) });
        }
      }
      return originalFetch.call(this, input, init);
    };
  }

  // Also support Axios/XHR-based registration requests.
  if (window.XMLHttpRequest) {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__syncro1WapiRegistration = isRegistrationRequest(url);
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (this.__syncro1WapiRegistration) {
        body = attachAttribution(body);
      }
      return originalSend.call(this, body);
    };
  }

  window.syncro1WapiAttribution = {
    visitorId: visitorId,
    campaignKey: hasCampaignAttribution ? attribution.campaignKey : null,
    recipientToken: hasCampaignAttribution ? attribution.recipientToken || null : null
  };
})();
