// backend/models/JobInterest.js
const mongoose = require('mongoose');

const jobInterestSchema = new mongoose.Schema({
    partner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StaffingPartner',
        required: true,
        index: true
    },
    job: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true,
        index: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['ACTIVE', 'WITHDRAWN'],
        default: 'ACTIVE'
    },
    // Submission tracking for this partner on this job
    submissionCount: {
        type: Number,
        default: 0
    },
    submissionLimit: {
        type: Number,
        default: 5
    },
    limitExtended: {
        type: Boolean,
        default: false
    },
    limitExtendedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    limitExtendedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// One partner can express interest in one job only once
jobInterestSchema.index({ partner: 1, job: 1 }, { unique: true });

module.exports = mongoose.model('JobInterest', jobInterestSchema);