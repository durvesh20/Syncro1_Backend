const mongoose = require('mongoose');

/**
 * AiScoreCache — Persistent AI scoring cache.
 *
 * Stores the full AI analysis result for a (candidateId, jobId) pair.
 * TTL index auto-expires entries after 7 days so stale scores never linger.
 * Bump SCORE_VERSION in aiService.js to force invalidation on algorithm changes.
 */
const AiScoreCacheSchema = new mongoose.Schema(
    {
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        // Bump this when scoring logic changes; mismatched version = cache miss
        scoreVersion: {
            type: Number,
            required: true,
            default: 1,
        },
        // Snapshot of the job's updatedAt when this score was computed.
        // If the job is modified, the cached score is considered stale.
        jobUpdatedAt: {
            type: Date,
            default: null,
        },
        score: { type: Number, default: 0 },
        matchLevel: { type: String, default: 'UNKNOWN' },
        decision: { type: String, default: 'HOLD' },
        skillCoveragePercent: { type: Number, default: 0 },
        tokensUsed: { type: Number, default: 0 },
        // Full AI analysis (structured result returned by parseResume)
        fullResult: { type: mongoose.Schema.Types.Mixed, default: null },
        // Which batch run produced this entry ('single' | 'batch')
        source: { type: String, default: 'single' },
        // TTL field — MongoDB will auto-delete this doc 7 days after computedAt
        computedAt: {
            type: Date,
            default: Date.now,
            index: { expires: '7d' },
        },
    },
    { timestamps: false }
);

// Compound unique index — one score per candidate+job+version combo
AiScoreCacheSchema.index({ candidateId: 1, jobId: 1, scoreVersion: 1 }, { unique: true });

module.exports = mongoose.model('AiScoreCache', AiScoreCacheSchema);
