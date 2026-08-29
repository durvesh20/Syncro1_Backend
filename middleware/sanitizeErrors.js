// middleware/sanitizeErrors.js
//
// Intercepts every res.json() call and strips internal error details in production.
//
// WHY THIS EXISTS:
//   Catch blocks across 200+ controllers do:
//     res.json({ ..., error: error.message })        ← Pattern A
//     res.json({ ..., message: error.message })      ← Pattern B
//   In production this leaks MongoDB schema names, field paths, internal service
//   errors, and potentially API keys from third-party SDK error messages.
//
// HOW IT WORKS:
//   Pattern A — strips the `error` field from any 4xx/5xx response.
//   Pattern B — replaces the `message` field with a generic string on 5xx responses
//               (4xx messages are kept because they contain user-facing validation feedback).
//   Real values are always logged server-side (PM2 logs) so developers retain visibility.
//
// SCOPE:
//   Covers ALL controllers, routes, and middleware in one place.
//   New code written in future is automatically protected too.
//
// USAGE (server.js — before route mounting):
//   const sanitizeErrors = require('./middleware/sanitizeErrors');
//   app.use(sanitizeErrors);

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

module.exports = function sanitizeErrors(req, res, next) {
  if (!IS_PRODUCTION) {
    // Development: pass through unchanged — full error detail visible for debugging
    return next();
  }

  // Wrap res.json so we can inspect and sanitize the body before bytes hit the wire
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Only process error responses with an object body
    if (!body || typeof body !== 'object' || res.statusCode < 400) {
      return originalJson(body);
    }

    let sanitized = { ...body };
    const leaked = [];

    // ── Pattern A: { ..., error: error.message } ────────────────────────────
    // Covers 200+ catch blocks that pass raw error detail in a separate `error` field.
    // Strip the field entirely — client doesn't need it, PM2 logs capture it.
    if ('error' in sanitized && sanitized.error) {
      leaked.push(`error="${sanitized.error}"`);
      delete sanitized.error;
    }

    // ── Pattern B: { message: error.message } on 5xx ────────────────────────
    // Covers ~50 catch blocks that put error.message directly into `message`.
    // Only sanitize 5xx — 4xx messages are intentional user-facing feedback (keep them).
    if (
      res.statusCode >= 500 &&
      typeof sanitized.message === 'string'
    ) {
      leaked.push(`message="${sanitized.message}"`);
      sanitized.message = 'Internal server error';
    }

    // Log the real internal detail server-side (PM2 logs) — never sent to client
    if (leaked.length > 0) {
      console.error(
        `[SANITIZED] ${req.method} ${req.originalUrl} (${res.statusCode}) — ${leaked.join(' | ')}`
      );
    }

    return originalJson(sanitized);
  };

  next();
};
