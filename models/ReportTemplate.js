// backend/models/ReportTemplate.js
// Persists a user's last-used field/filter selection per report type so they
// can skip configuration and download directly next time.
const mongoose = require('mongoose');

const reportTemplateSchema = new mongoose.Schema({
  // Owner of the template
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Name/description of this saved structure
  name: {
    type: String,
    required: true,
    default: 'Saved Structure'
  },

  // Backend role value at save time (admin | sub_admin | company | staffing_partner)
  role: {
    type: String,
    required: true
  },

  // Report type key from reportFieldRegistry (e.g. JOB_WITH_CANDIDATES)
  reportType: {
    type: String,
    required: true
  },

  // Ordered list of field keys the user selected
  selectedFields: {
    type: [String],
    default: []
  },

  // Filter values the user selected (free-form object, validated against registry on use)
  selectedFilters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Unique template name per (user, reportType)
reportTemplateSchema.index({ userId: 1, reportType: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('ReportTemplate', reportTemplateSchema);
