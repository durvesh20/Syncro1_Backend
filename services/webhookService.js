// backend/services/webhookService.js
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const WebhookDelivery = require('../models/WebhookDelivery');
const Integration = require('../models/Integration');
const IntegrationEvent = require('../models/IntegrationEvent');

// Exponential backoff intervals in milliseconds
// 1m, 5m, 15m, 1h, 6h, 24h
const RETRY_INTERVALS_MS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000
];

/**
 * Compute HMAC-SHA256 signature
 */
const computeSignature = (secret, timestamp, payloadString) => {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payloadString}`)
    .digest('hex');
};

/**
 * Emit an integration event to all subscribed webhooks of a company
 * @param {string|ObjectId} companyId
 * @param {string} eventType e.g., 'candidate.shortlisted', 'job.published'
 * @param {object} data
 * @param {object} [entityMeta] { entity_type: 'JOB'|'CANDIDATE'|'INTERVIEW', entity_id }
 */
exports.emitEvent = async (companyId, eventType, data, entityMeta = null) => {
  try {
    const integration = await Integration.findOne({ company_id: companyId, status: 'ACTIVE' });
    if (!integration) return; // Company does not have active developer API integration

    // Find subscribed active endpoints
    const endpoints = await WebhookEndpoint.find({
      company_id: companyId,
      status: 'ACTIVE',
      $or: [{ events: eventType }, { events: '*' }]
    });

    if (!endpoints || endpoints.length === 0) return;

    const eventId = `evt_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

    // Log integration event for audit trail
    if (entityMeta && entityMeta.entity_type && entityMeta.entity_id) {
      await IntegrationEvent.create({
        event_id: eventId,
        integration_id: integration._id,
        company_id: companyId,
        entity_type: entityMeta.entity_type,
        entity_id: entityMeta.entity_id,
        event_type: eventType,
        data
      }).catch(err => console.error('[IntegrationEvent Log Error]:', err.message));
    }

    // Deliver to each endpoint
    for (const endpoint of endpoints) {
      const delivery = await WebhookDelivery.create({
        webhook_id: endpoint._id,
        integration_id: integration._id,
        company_id: companyId,
        event_id: eventId,
        event_type: eventType,
        payload: data,
        status: 'PENDING',
        attempts: 0
      });

      // Attempt immediate async delivery
      setImmediate(() => {
        exports.deliverWebhook(delivery._id).catch(err => {
          console.error(`[Webhook Immediate Delivery Error ${delivery._id}]:`, err.message);
        });
      });
    }
  } catch (error) {
    console.error('[webhookService emitEvent Error]:', error);
  }
};

/**
 * Deliver a specific webhook delivery attempt
 * @param {string|ObjectId} deliveryId
 */
exports.deliverWebhook = async (deliveryId) => {
  const delivery = await WebhookDelivery.findById(deliveryId);
  if (!delivery) return;

  const endpoint = await WebhookEndpoint.findById(delivery.webhook_id);
  if (!endpoint || endpoint.status !== 'ACTIVE') {
    delivery.status = 'DEAD';
    await delivery.save();
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const formattedPayload = {
    id: delivery.event_id,
    type: delivery.event_type,
    created_at: delivery.created_at,
    data: delivery.payload
  };

  const payloadString = JSON.stringify(formattedPayload);
  const signature = computeSignature(endpoint.secret_hash, timestamp, payloadString);

  delivery.attempts += 1;
  delivery.last_attempt_at = new Date();

  try {
    const response = await axios.post(endpoint.url, formattedPayload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Syncro1-Event-ID': delivery.event_id,
        'X-Syncro1-Signature': signature,
        'X-Syncro1-Timestamp': String(timestamp),
        'User-Agent': 'Syncro1-Webhooks/1.0'
      },
      timeout: 8000
    });

    delivery.status = 'DELIVERED';
    delivery.response_code = response.status;
    delivery.response_body = typeof response.data === 'string'
      ? response.data.slice(0, 1000)
      : JSON.stringify(response.data).slice(0, 1000);
    delivery.next_retry_at = null;
    await delivery.save();

    endpoint.last_delivery_at = new Date();
    endpoint.failure_count = 0;
    await endpoint.save();
  } catch (error) {
    const statusCode = error.response?.status || 0;
    const responseBody = error.response?.data
      ? (typeof error.response.data === 'string'
        ? error.response.data.slice(0, 1000)
        : JSON.stringify(error.response.data).slice(0, 1000))
      : error.message.slice(0, 500);

    delivery.response_code = statusCode;
    delivery.response_body = responseBody;

    if (delivery.attempts >= delivery.max_attempts) {
      delivery.status = 'DEAD';
      delivery.next_retry_at = null;
    } else {
      delivery.status = 'FAILED';
      const backoffMs = RETRY_INTERVALS_MS[Math.min(delivery.attempts - 1, RETRY_INTERVALS_MS.length - 1)];
      delivery.next_retry_at = new Date(Date.now() + backoffMs);
    }

    await delivery.save();

    endpoint.failure_count = (endpoint.failure_count || 0) + 1;
    await endpoint.save();
  }
};

/**
 * Process scheduled retries for failed webhook deliveries
 */
exports.processRetryQueue = async () => {
  try {
    const now = new Date();
    const pendingRetries = await WebhookDelivery.find({
      status: 'FAILED',
      next_retry_at: { $lte: now }
    }).limit(50);

    for (const delivery of pendingRetries) {
      await exports.deliverWebhook(delivery._id);
    }

    return pendingRetries.length;
  } catch (error) {
    console.error('[webhookService processRetryQueue Error]:', error);
    return 0;
  }
};

/**
 * Send a test webhook to an endpoint
 */
exports.sendTestWebhook = async (endpointId, companyId) => {
  const endpoint = await WebhookEndpoint.findOne({ _id: endpointId, company_id: companyId });
  if (!endpoint) {
    throw new Error('Webhook endpoint not found');
  }

  const integration = await Integration.findOne({ company_id: companyId });

  const testEventId = `evt_test_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const testPayload = {
    test: true,
    message: 'This is a test webhook event from Syncro1 Developer Platform',
    timestamp: new Date().toISOString(),
    endpoint_url: endpoint.url
  };

  const delivery = await WebhookDelivery.create({
    webhook_id: endpoint._id,
    integration_id: integration?._id || endpoint.integration_id,
    company_id: companyId,
    event_id: testEventId,
    event_type: 'test.ping',
    payload: testPayload,
    status: 'PENDING',
    attempts: 0
  });

  await exports.deliverWebhook(delivery._id);
  return await WebhookDelivery.findById(delivery._id);
};

