// backend/models/LimitExtensionRequest.js
const mongoose = require('mongoose');

const limitExtensionRequestSchema = new mongoose.Schema({
    partner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StaffingPartner',
        required: true,
        index: true
    },
    job: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true
    },
    jobInterest: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'JobInterest',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // How many additional submissions partner wants
    requestedAdditional: {
        type: Number,
        required: true,
        min: 1,
        max: 10
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        minlength: 10
    },
    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING',
        index: true
    },
    // Admin response
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    reviewedAt: {
        type: Date,
        default: null
    },
    adminNotes: {
        type: String,
        default: null
    },
    // If approved — how many were actually granted
    approvedAdditional: {
        type: Number,
        default: null
    }
}, {
    timestamps: true
});

limitExtensionRequestSchema.index({ partner: 1, job: 1, status: 1 });

module.exports = mongoose.model('LimitExtensionRequest', limitExtensionRequestSchema);