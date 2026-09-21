// backend/middleware/developerApiMiddleware.js
const { v4: uuidv4 } = require('uuid');
const ApiLog = require('../models/ApiLog');

// In-memory sliding window rate limiter per client_id
// Rate limit: 100 requests per 60 seconds
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;
const rateLimitMap = new Map();

// In-memory idempotency cache (expires after 10 minutes)
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const idempotencyCache = new Map();

// Periodic cleanup of rateLimitMap and idempotencyCache every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [clientId, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(clientId);
    }
  }
  for (const [key, data] of idempotencyCache.entries()) {
    if (now - data.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Attach a unique request ID to request and response
 */
exports.requestIdMiddleware = (req, res, next) => {
  const incomingId = req.headers['x-request-id'];
  const requestId = incomingId && typeof incomingId === 'string' && incomingId.trim()
    ? incomingId.trim().slice(0, 50)
    : `req_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

/**
 * Per-client rate limiter (100 req/min)
 */
exports.clientRateLimiter = (req, res, next) => {
  const clientId = req.developer?.client_id || req.ip || 'anonymous';
  const now = Date.now();

  let clientData = rateLimitMap.get(clientId);

  if (!clientData || now > clientData.resetTime) {
    clientData = {
      count: 0,
      resetTime: now + RATE_LIMIT_WINDOW_MS
    };
    rateLimitMap.set(clientId, clientData);
  }

  clientData.count += 1;
  const remaining = Math.max(0, RATE_LIMIT_MAX - clientData.count);
  const resetInSeconds = Math.ceil((clientData.resetTime - now) / 1000);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetInSeconds);

  if (clientData.count > RATE_LIMIT_MAX) {
    res.setHeader('Retry-After', resetInSeconds);
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Too many requests. Limit is ${RATE_LIMIT_MAX} requests per minute.`
      },
      request_id: req.requestId
    });
  }

  next();
};

/**
 * Idempotency check for mutation operations (POST, PUT, PATCH)
 */
exports.idempotencyMiddleware = (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey || !['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const clientId = req.developer?.client_id || 'unknown';
  const compositeKey = `${clientId}:${idempotencyKey.trim()}`;

  const cached = idempotencyCache.get(compositeKey);
  if (cached) {
    // Return cached response
    res.setHeader('X-Cache', 'IDEMPOTENT_HIT');
    return res.status(cached.statusCode).json(cached.body);
  }

  // Intercept json call to cache response
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      idempotencyCache.set(compositeKey, {
        statusCode: res.statusCode,
        body,
        timestamp: Date.now()
      });
    }
    return originalJson(body);
  };

  next();
};

/**
 * Asynchronously log Developer API requests to ApiLog collection
 */
exports.apiLoggerMiddleware = (req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    // Run asynchronously without awaiting so response is not delayed
    setImmediate(async () => {
      try {
        if (!req.developer) return;

        const requestPath = req.originalUrl || req.url || '';
        // Skip logging log-reading requests themselves to avoid log pollution
        if (requestPath.includes('/logs/api')) {
          return;
        }

        const companyId = req.developer.company_id;
        if (!companyId) return;

        const latencyMs = Date.now() - startTime;

        // Mask sensitive fields if present in body
        let sanitizedBody = null;
        if (req.body && typeof req.body === 'object') {
          sanitizedBody = { ...req.body };
          delete sanitizedBody.client_secret;
          delete sanitizedBody.password;
          delete sanitizedBody.token;
        }

        const clientId = req.developer.client_id
          ? String(req.developer.client_id)
          : (req.developer.id ? `portal_${req.developer.id}` : 'portal_session');

        await ApiLog.create({
          request_id: req.requestId || `req_${uuidv4().replace(/-/g, '').slice(0, 16)}`,
          client_id: clientId,
          company_id: companyId,
          method: req.method,
          path: requestPath,
          status_code: res.statusCode,
          latency_ms: latencyMs,
          ip: req.ip || req.connection?.remoteAddress,
          request_summary: sanitizedBody,
          error_code: res.statusCode >= 400 ? (req.errorCode || 'HTTP_' + res.statusCode) : null
        });
      } catch (logErr) {
        console.error('[Developer ApiLogger Error]:', logErr.message);
      }
    });
  });

  next();
};

