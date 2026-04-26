/**
 * backend/models/Notification.js — UPDATED
 */

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
      'CANDIDATE_WITHDRAWN',

      // Candidate submission — sent to COMPANY
      'NEW_CANDIDATE_SUBMITTED',

      // Job notifications — sent to PARTNER
      'NEW_JOB_MATCHED',
      'JOB_CLOSING_SOON',
      'JOB_CLOSED',

      // Job approval workflow
      'JOB_SUBMITTED_FOR_APPROVAL',
      'JOB_APPROVED',
      'JOB_REJECTED',
      'JOB_EDIT_REQUESTED',
      'JOB_EDIT_APPROVED',
      'JOB_EDIT_REJECTED',
      'JOB_DISCONTINUED',

      // Account — sent to PARTNER or COMPANY
      'PROFILE_VERIFIED',
      'PROFILE_REJECTED',
      'SUBSCRIPTION_EXPIRING',
      'SUBSCRIPTION_EXPIRED',

      // Payout notifications
      'PAYOUT_ELIGIBLE',
      'PAYOUT_APPROVED',
      'PAYOUT_PAID',
      'PAYOUT_FORFEITED',
      'PAYOUT_ON_HOLD',

      // Invoice notifications
      'INVOICE_GENERATED',
      'INVOICE_SENT',
      'INVOICE_PAID',
      'INVOICE_OVERDUE',

      // Job interest and extension
      'LIMIT_EXTENSION_REQUESTED',
      'LIMIT_EXTENSION_APPROVED',
      'LIMIT_EXTENSION_REJECTED',

      // Agreement
      'AGREEMENT_QUERY_SUBMITTED',
      'AGREEMENT_QUERY_RESPONDED',

      // Candidate consent
      'CANDIDATE_CONSENT_CONFIRMED',
      'CANDIDATE_CONSENT_DENIED',

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
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    actionUrl: String,
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