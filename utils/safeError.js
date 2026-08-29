// utils/safeError.js
//
// Use this helper in NEW catch blocks going forward.
// Returns the real error message in development, a generic string in production.
//
// Usage:
//   const { safeError } = require('../utils/safeError');
//
//   catch (error) {
//     console.error('[MY-MODULE] Real error:', error);        // always logs internally
//     res.status(500).json({
//       success: false,
//       message: safeError(error)                            // safe for client
//     });
//   }

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Returns a client-safe error string.
 * - Development: returns the real error.message (useful for debugging)
 * - Production:  returns a generic message (prevents internal detail leakage)
 *
 * @param {Error|string} error - The caught error object or string
 * @param {string} [fallback] - Custom fallback message for production (optional)
 * @returns {string}
 */
const safeError = (error, fallback = 'An internal error occurred') => {
  if (IS_PRODUCTION) return fallback;
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

module.exports = { safeError };
