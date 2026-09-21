const mongoose = require('mongoose');

const apiLogSchema = new mongoose.Schema(
  {
    request_id: {
      type: String,
      required: true,
      index: true
    },
    client_id: {
      type: String,
      required: false,
      default: null,
      index: true
    },
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    method: {
      type: String,
      required: true
    },
    path: {
      type: String,
      required: true
    },
    status_code: {
      type: Number,
      required: true
    },
    latency_ms: {
      type: Number,
      required: true
    },
    ip: {
      type: String,
      default: null
    },
    request_summary: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    error_code: {
      type: String,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

// TTL index to automatically clean up logs after 30 days
apiLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
apiLogSchema.index({ company_id: 1, created_at: -1 });
apiLogSchema.index({ client_id: 1, created_at: -1 });

module.exports = mongoose.model('ApiLog', apiLogSchema);

