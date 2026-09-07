const mongoose = require('mongoose');

const integrationSchema = new mongoose.Schema(
  {
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
      default: 'ACTIVE'
    },
    environment: {
      type: String,
      enum: ['PRODUCTION', 'SANDBOX'],
      default: 'PRODUCTION'
    },
    settings: {
      auto_publish_jobs: {
        type: Boolean,
        default: false
      }
    },
    last_sync_at: {
      type: Date,
      default: null
    },
    suspended_reason: {
      type: String,
      default: null
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

integrationSchema.index({ status: 1 });

module.exports = mongoose.model('Integration', integrationSchema);
