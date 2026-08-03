// queues/aiQueue.js
// BullMQ Queue definition for AI resume-parsing jobs.
// Producers (controllers / services) call enqueueAIJob() to add work.
// The Worker (aiWorker.js) consumes these jobs in the background.

const { Queue } = require('bullmq');
const { getRedisConnectionOptions } = require('../config/redis');

const QUEUE_NAME = 'ai-processing';

// ── Queue instance ─────────────────────────────────────────────────────────
// Each Queue needs its own ioredis connection (BullMQ requirement).
const aiQueue = new Queue(QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
        // Retry up to 3 times on failure with exponential back-off
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000, // 5s → 10s → 20s
        },
        // Remove completed jobs after 24h (keep last 500) to prevent Redis bloat
        removeOnComplete: { age: 24 * 3600, count: 500 },
        // Remove failed jobs after 7 days (keep last 200 for post-mortem)
        removeOnFail: { age: 7 * 24 * 3600, count: 200 },
    },
});

aiQueue.on('error', (err) => {
    console.error('[AI Queue] Queue error:', err.message);
});

// ── Public helper ──────────────────────────────────────────────────────────

/**
 * Enqueue an AI resume-parsing job for a candidate.
 *
 * @param {string} candidateId - MongoDB ObjectId of the candidate
 * @param {object} [opts]
 * @param {number} [opts.priority] - Lower number = higher priority (1 = highest)
 * @returns {Promise<{ jobId: string }>}
 */
async function enqueueAIJob(candidateId, opts = {}) {
    const jobData = { candidateId: String(candidateId) };
    const jobOpts = {};

    if (opts.priority !== undefined) {
        jobOpts.priority = opts.priority;
    }

    const job = await aiQueue.add('parse-resume', jobData, jobOpts);

    console.log(`[AI Queue] ✅ Enqueued job ${job.id} for candidate ${candidateId}`);
    return { jobId: job.id };
}

/**
 * Get a quick snapshot of the queue state (for health-check endpoints).
 */
async function getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        aiQueue.getWaitingCount(),
        aiQueue.getActiveCount(),
        aiQueue.getCompletedCount(),
        aiQueue.getFailedCount(),
        aiQueue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
}

module.exports = { aiQueue, enqueueAIJob, getQueueStats, QUEUE_NAME };
