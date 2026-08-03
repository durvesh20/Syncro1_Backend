// models/AiJobLog.js
// Persists every BullMQ AI job lifecycle event for observability and debugging.

const mongoose = require('mongoose');

const AiJobLogSchema = new mongoose.Schema(
    {
        jobId: {
            type: String,
            required: true,
            index: true,
        },
        candidateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Candidate',
            required: true,
            index: true,
        },
        // 'waiting' | 'active' | 'completed' | 'failed' | 'stalled'
        status: {
            type: String,
            enum: ['waiting', 'active', 'completed', 'failed', 'stalled'],
            required: true,
        },
        attempt: {
            type: Number,
            default: 1,
        },
        startedAt: {
            type: Date,
        },
        completedAt: {
            type: Date,
        },
        // Wall-clock time from job start to finish (ms)
        durationMs: {
            type: Number,
        },
        // OpenAI tokens consumed (pulled from aiService result when available)
        tokensUsed: {
            type: Number,
        },
        // AI model used (e.g. 'gpt-5')
        modelUsed: {
            type: String,
        },
        // Weighted AI score produced (0–100)
        aiScore: {
            type: Number,
        },
        // Error message on failure
        errorMessage: {
            type: String,
        },
        // Full error stack (development only)
        errorStack: {
            type: String,
        },
    },
    {
        timestamps: true, // createdAt + updatedAt
    }
);

// Compound index for dashboard queries
AiJobLogSchema.index({ status: 1, createdAt: -1 });
AiJobLogSchema.index({ candidateId: 1, createdAt: -1 });

module.exports = mongoose.model('AiJobLog', AiJobLogSchema);
