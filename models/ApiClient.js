const mongoose = require('mongoose');

const apiClientSchema = new mongoose.Schema(
  {
    client_id: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    client_secret_hash: {
      type: String,
      required: true
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
    label: {
      type: String,
      default: 'Production API Key'
    },
    scopes: {
      type: [String],
      default: [
        'jobs:read',
        'jobs:write',
        'candidates:read',
        'statuses:read',
        'statuses:write',
        'interviews:read',
        'interviews:write',
        'webhooks:read',
        'webhooks:write',
        'integration:read',
        'integration:write',
        'logs:read'
      ]
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'REVOKED'],
      default: 'ACTIVE',
      index: true
    },
    last_used_at: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

module.exports = mongoose.model('ApiClient', apiClientSchema);

