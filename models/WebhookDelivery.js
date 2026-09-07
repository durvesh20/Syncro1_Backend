const mongoose = require('mongoose');

const webhookDeliverySchema = new mongoose.Schema(
  {
    webhook_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WebhookEndpoint',
      required: true,
      index: true
    },
    integration_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Integration',
      required: true,
      index: true
    },
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    event_id: {
      type: String,
      required: true,
      index: true
    },
    event_type: {
      type: String,
      required: true,
      index: true
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    },
    status: {
      type: String,
      enum: ['PENDING', 'DELIVERED', 'FAILED', 'DEAD'],
      default: 'PENDING',
      index: true
    },
    attempts: {
      type: Number,
      default: 0
    },
    max_attempts: {
      type: Number,
      default: 6
    },
    last_attempt_at: {
      type: Date,
      default: null
    },
    next_retry_at: {
      type: Date,
      default: null,
      index: true
    },
    response_code: {
      type: Number,
      default: null
    },
    response_body: {
      type: String,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

// TTL index to automatically clean up delivery logs after 30 days
webhookDeliverySchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
webhookDeliverySchema.index({ integration_id: 1, status: 1, created_at: -1 });
webhookDeliverySchema.index({ next_retry_at: 1, status: 1 });

module.exports = mongoose.model('WebhookDelivery', webhookDeliverySchema);

