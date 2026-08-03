// config/redis.js
// Central ioredis connection config for BullMQ (Queue + Worker).
// BullMQ requires separate connections for producer/consumer, so we
// expose a factory function (getRedisConnectionOptions) instead of a shared client.

const { URL } = require('url');

/**
 * Returns an ioredis-compatible options object parsed from REDIS_URL env var.
 * Falls back to localhost:6379 if REDIS_URL is not set or is unparseable.
 */
function getRedisConnectionOptions() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
        const parsed = new URL(url);
        return {
            host: parsed.hostname || 'localhost',
            port: parseInt(parsed.port || '6379', 10),
            password: parsed.password || undefined,
            db: parsed.pathname ? parseInt(parsed.pathname.replace('/', '') || '0', 10) : 0,
            // These two are REQUIRED by BullMQ:
            maxRetriesPerRequest: null,  // required by BullMQ
            enableReadyCheck: false,     // required by BullMQ
            lazyConnect: false,
            retryStrategy(times) {
                const delay = Math.min(times * 500, 5000);
                // Only log every 5th attempt to avoid log spam
                if (times % 5 === 1) {
                    console.warn(`[Redis] Not connected — reconnecting... (attempt ${times}, next in ${delay}ms). Make sure Redis is running: sudo systemctl start redis-server`);
                }
                return delay;
            },
        };
    } catch (err) {
        console.error('[Redis] Invalid REDIS_URL, falling back to localhost:6379:', err.message);
        return {
            host: 'localhost',
            port: 6379,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        };
    }
}

module.exports = { getRedisConnectionOptions };
