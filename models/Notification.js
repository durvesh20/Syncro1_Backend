// backend/models/Notification.js — NEW FILE

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      // Candidate lifecycle — sent to PARTNER
      'CANDIDATE_UNDER_REVIEW',
      'CANDIDATE_SHORTLISTED',
      'CANDIDATE_INTERVIEW_SCHEDULED',
      'CANDIDATE_INTERVIEWED',
      'CANDIDATE_OFFERED',
      'CANDIDATE_OFFER_ACCEPTED',
      'CANDIDATE_OFFER_DECLINED',
      'CANDIDATE_JOINED',
      'CANDIDATE_REJECTED',
      'CANDIDATE_ON_HOLD',

      // Candidate submission — sent to COMPANY
      'NEW_CANDIDATE_SUBMITTED',

      // Job notifications — sent to PARTNER
      'NEW_JOB_MATCHED',
      'JOB_CLOSING_SOON',
      'JOB_CLOSED',

      // Account — sent to PARTNER or COMPANY
      'PROFILE_VERIFIED',
      'PROFILE_REJECTED',
      'SUBSCRIPTION_EXPIRING',
      'SUBSCRIPTION_EXPIRED',

      // ✅ NEW: Payout notifications
      'PAYOUT_ELIGIBLE',      // 90 days completed
      'PAYOUT_APPROVED',      // Admin approved payout
      'PAYOUT_PAID',          // Money transferred
      'PAYOUT_FORFEITED',     // Candidate left early
      'PAYOUT_ON_HOLD',       // Payout held for review

      // ✅ NEW: Invoice notifications
      'INVOICE_GENERATED',
      'INVOICE_SENT',
      'INVOICE_PAID',
      'INVOICE_OVERDUE',

      // System
      'SYSTEM_ANNOUNCEMENT'
    ],
    required: true
  },
  title: {
    type: String,
    required: true,
    maxlength: 200
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },
  data: {
    entityType: String,    // 'Candidate', 'Job', 'Payout', etc.
    entityId: mongoose.Schema.Types.ObjectId,
    actionUrl: String,     // Frontend route to navigate to
    metadata: mongoose.Schema.Types.Mixed
  },
  channels: {
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    whatsapp: { type: Boolean, default: false }
  },
  read: { type: Boolean, default: false },
  readAt: Date,
  dismissed: { type: Boolean, default: false },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  }
}, {
  timestamps: true
});

// Compound indexes for fast queries
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, dismissed: 1, createdAt: -1 });

// Auto-delete notifications older than 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);