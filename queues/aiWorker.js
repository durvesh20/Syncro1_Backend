// queues/aiWorker.js
// BullMQ Worker for the "ai-processing" queue.
// Picks up jobs one-by-one (or with limited concurrency) and runs the
// full AI resume-parse + score pipeline via candidateQueueService.
// Retries are handled by BullMQ using the config set in aiQueue.js.

const { Worker } = require('bullmq');
const { getRedisConnectionOptions } = require('../config/redis');
const { QUEUE_NAME } = require('./aiQueue');

let workerInstance = null;

/**
 * Initialise and start the AI Worker.
 * Call once at server startup (after connectDB).
 *
 * @param {number} [concurrency] - How many jobs to run in parallel (default: AI_WORKER_CONCURRENCY env or 3)
 * @returns {Worker}
 */
function startAIWorker(concurrency) {
    if (workerInstance) {
        console.warn('[AI Worker] Already started — skipping duplicate init.');
        return workerInstance;
    }

    const c = concurrency ?? parseInt(process.env.AI_WORKER_CONCURRENCY || '3', 10);

    // Lazy-require to avoid circular dependency issues at boot time
    const candidateQueueService = require('../services/candidateQueueService');
    const AiJobLog = require('../models/AiJobLog');

    console.log(`[AI Worker] 🚀 Starting with concurrency=${c} on queue "${QUEUE_NAME}"`);

    workerInstance = new Worker(
        QUEUE_NAME,
        async (job) => {
            const { candidateId } = job.data;
            const startedAt = new Date();

            console.log(`\n[AI Worker] ── Job ${job.id} started (attempt ${job.attemptsMade + 1}) ──`);
            console.log(`[AI Worker]    Candidate: ${candidateId}`);

            // Log job as 'active' in MongoDB
            await AiJobLog.create({
                jobId: String(job.id),
                candidateId,
                status: 'active',
                attempt: job.attemptsMade + 1,
                startedAt,
            }).catch(err => console.error('[AI Worker] AiJobLog create error:', err.message));

            // ── Run the actual AI processing pipeline ──────────────────────
            const result = await candidateQueueService.processAfterConsent(candidateId);

            const completedAt = new Date();
            const durationMs = completedAt - startedAt;

            // Extract token/score data from result for logging
            const tokensUsed = result?.tokensUsed ?? undefined;
            const aiScore = result?.profileScore ?? result?.scoreBreakdown?.summary?.finalAdjustedScore ?? undefined;

            console.log(`[AI Worker] ✅ Job ${job.id} completed in ${(durationMs / 1000).toFixed(1)}s | score=${aiScore ?? 'N/A'}`);

            // Update log to 'completed'
            await AiJobLog.findOneAndUpdate(
                { jobId: String(job.id), candidateId },
                {
                    status: 'completed',
                    completedAt,
                    durationMs,
                    tokensUsed,
                    modelUsed: process.env.OPENAI_MODEL || 'gpt-4o',
                    aiScore,
                },
                { sort: { createdAt: -1 } }
            ).catch(err => console.error('[AI Worker] AiJobLog update error:', err.message));

            return { success: true, candidateId, aiScore, durationMs };
        },
        {
            connection: getRedisConnectionOptions(),
            concurrency: c,
            // Lock duration: 5 minutes. AI calls can take up to 60s, so give headroom.
            lockDuration: 5 * 60 * 1000,
            // Staleness check every 30s
            stalledInterval: 30 * 1000,
            // Max number of times a job can be moved to stalled state before failing
            maxStalledCount: 2,
        }
    );

    // ── Lifecycle event hooks ───────────────────────────────────────────────

    workerInstance.on('active', (job) => {
        console.log(`[AI Worker] 🔵 Job ${job.id} is now active (candidate: ${job.data.candidateId})`);
    });

    workerInstance.on('completed', (job, returnValue) => {
        console.log(`[AI Worker] 🟢 Job ${job.id} completed successfully (score: ${returnValue?.aiScore ?? 'N/A'})`);
    });

    workerInstance.on('failed', async (job, err) => {
        const isFinal = job.attemptsMade >= (job.opts?.attempts ?? 3);
        console.error(`[AI Worker] 🔴 Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts ?? 3}): ${err.message}`);

        await AiJobLog.findOneAndUpdate(
            { jobId: String(job.id), candidateId: job.data.candidateId },
            {
                status: 'failed',
                completedAt: new Date(),
                errorMessage: err.message,
                errorStack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
                attempt: job.attemptsMade,
            },
            { sort: { createdAt: -1 } }
        ).catch(logErr => console.error('[AI Worker] AiJobLog fail-update error:', logErr.message));

        // On final failure (all retries exhausted), flag the candidate
        if (isFinal && job.data.candidateId) {
            try {
                const Candidate = require('../models/Candidate');
                await Candidate.findByIdAndUpdate(job.data.candidateId, {
                    $set: { 'resumeAnalysis.aiStatus': 'FAILED' },
                    $push: {
                        statusHistory: {
                            status: 'ADMIN_REVIEW',
                            changedAt: new Date(),
                            notes: `AI processing permanently failed after ${job.attemptsMade} attempts: ${err.message}. Manual review required.`,
                        }
                    }
                });
                console.warn(`[AI Worker] ⚠️  Candidate ${job.data.candidateId} marked aiStatus=FAILED`);
            } catch (updateErr) {
                console.error('[AI Worker] Failed to update candidate aiStatus:', updateErr.message);
            }
        }
    });

    workerInstance.on('stalled', (jobId) => {
        console.warn(`[AI Worker] ⚠️  Job ${jobId} stalled — will be retried`);
        AiJobLog.findOneAndUpdate(
            { jobId: String(jobId) },
            { status: 'stalled' },
            { sort: { createdAt: -1 } }
        ).catch(() => {});
    });

    workerInstance.on('error', (err) => {
        console.error('[AI Worker] Worker-level error:', err.message);
    });

    console.log(`[AI Worker] ✅ Listening on queue "${QUEUE_NAME}"`);
    return workerInstance;
}

/**
 * Gracefully shut down the worker (call on SIGTERM/SIGINT).
 */
async function stopAIWorker() {
    if (workerInstance) {
        console.log('[AI Worker] Shutting down gracefully...');
        await workerInstance.close();
        workerInstance = null;
        console.log('[AI Worker] Stopped.');
    }
}

module.exports = { startAIWorker, stopAIWorker };
