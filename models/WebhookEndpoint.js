const mongoose = require('mongoose');

const webhookEndpointSchema = new mongoose.Schema(
  {
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
    url: {
      type: String,
      required: true,
      trim: true
    },
    secret_hash: {
      type: String,
      required: true
    },
    events: {
      type: [String],
      default: []
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE'],
      default: 'ACTIVE',
      index: true
    },
    failure_count: {
      type: Number,
      default: 0
    },
    last_delivery_at: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

module.exports = mongoose.model('WebhookEndpoint', webhookEndpointSchema);

