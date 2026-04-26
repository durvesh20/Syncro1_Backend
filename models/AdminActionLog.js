// backend/models/AdminActionLog.js
const mongoose = require('mongoose');

const adminActionLogSchema = new mongoose.Schema({
    // Who performed the action
    actor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    actorRole: {
        type: String,
        enum: ['admin', 'sub_admin'],
        required: true
    },
    actorEmail: {
        type: String,
        required: true
    },

    // What action was performed
    action: {
        type: String,
        required: true,
        enum: [
            // Partner actions
            'PARTNER_APPROVED',
            'PARTNER_REJECTED',

            // Company actions
            'COMPANY_APPROVED',
            'COMPANY_REJECTED',

            // Job actions
            'JOB_APPROVED',
            'JOB_REJECTED',
            'JOB_DISCONTINUED',

            // Edit request actions
            'EDIT_REQUEST_APPROVED',
            'EDIT_REQUEST_REJECTED',

            // Payout actions
            'PAYOUT_APPROVED',
            'PAYOUT_PROCESSED',
            'PAYOUT_HELD',
            'PAYOUT_RELEASED',
            'PAYOUT_FORFEITED',
            'PAYOUT_ELIGIBILITY_CHECKED',

            // Invoice actions
            'INVOICE_SENT',
            'INVOICE_PAYMENT_RECORDED',
            'INVOICE_CANCELLED',
            'INVOICE_GENERATED',

            // User actions
            'USER_SUSPENDED',
            'USER_ACTIVATED',
            'USER_REJECTED',

            // Sub-admin actions
            'SUB_ADMIN_CREATED',
            'SUB_ADMIN_UPDATED',
            'SUB_ADMIN_SUSPENDED',
            'SUB_ADMIN_ACTIVATED',

            // Extension request
            'EXTENSION_REQUEST_APPROVED',
            'EXTENSION_REQUEST_REJECTED',

            // Agreement query
            'AGREEMENT_QUERY_RESPONDED'
        ]
    },

    // What entity was affected
    entityType: {
        type: String,
        enum: [
            'StaffingPartner',
            'Company',
            'Job',
            'JobEditRequest',
            'Payout',
            'Invoice',
            'User',
            'LimitExtensionRequest',
            'AgreementQuery'
        ],
        required: true
    },
    entityId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true
    },

    // Description of what changed
    description: {
        type: String,
        required: true
    },

    // Optional: before and after values
    before: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    after: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },

    // Additional notes from admin
    notes: {
        type: String,
        default: null
    },

    // Request metadata
    ipAddress: {
        type: String,
        default: null
    },
    userAgent: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

adminActionLogSchema.index({ actor: 1, createdAt: -1 });
adminActionLogSchema.index({ entityType: 1, entityId: 1 });
adminActionLogSchema.index({ action: 1, createdAt: -1 });
adminActionLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminActionLog', adminActionLogSchema);