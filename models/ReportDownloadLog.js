// backend/models/ReportDownloadLog.js
// Audit trail: who downloaded what report, with which filters, when.
const mongoose = require('mongoose');

const reportDownloadLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  role: {
    type: String,
    required: true
  },

  reportType: {
    type: String,
    required: true,
    index: true
  },

  // Filter values actually applied (stored as-is for auditability)
  filtersUsed: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // Field keys that were exported (stored as-is, not just a count)
  fieldsUsed: {
    type: [String],
    default: []
  },

  // Number of data rows produced
  rowCount: {
    type: Number,
    default: 0
  },

  // Generated file name (e.g. job-candidates-report_2026-07-16.xlsx)
  fileName: {
    type: String
  },

  ipAddress: {
    type: String,
    default: null
  },

  userAgent: {
    type: String,
    default: null
  },

  generatedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('ReportDownloadLog', reportDownloadLogSchema);
