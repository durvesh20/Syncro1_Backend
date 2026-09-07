const mongoose = require('mongoose');

const integrationEventSchema = new mongoose.Schema(
  {
    event_id: {
      type: String,
      required: true,
      unique: true,
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
    entity_type: {
      type: String,
      enum: ['JOB', 'CANDIDATE', 'INTERVIEW'],
      required: true,
      index: true
    },
    entity_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    event_type: {
      type: String,
      required: true,
      index: true
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
);

integrationEventSchema.index({ company_id: 1, created_at: -1 });

module.exports = mongoose.model('IntegrationEvent', integrationEventSchema);

