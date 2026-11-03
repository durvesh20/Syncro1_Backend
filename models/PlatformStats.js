const mongoose = require('mongoose');

const PlatformStatsSchema = new mongoose.Schema(
  {
    // Historical / Platform Totals (Row 1 from spreadsheet)
    totalVacancies: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPotentialRevenue: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalCandidatesUploaded: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Active Operational Metrics (Row 2 from spreadsheet)
    totalActiveVacancies: {
      type: Number,
      default: 0,
      min: 0,
    },
    activeVacanciesPotentialRevenue: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalActiveCandidates: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Manual Overrides Configuration (Admin capability to override displayed numbers)
    useCustomOverrides: {
      type: Boolean,
      default: false,
    },
    customOverrides: {
      totalVacancies: { type: Number, default: null },
      totalPotentialRevenue: { type: Number, default: null },
      totalCandidatesUploaded: { type: Number, default: null },
      totalActiveVacancies: { type: Number, default: null },
      activeVacanciesPotentialRevenue: { type: Number, default: null },
      totalActiveCandidates: { type: Number, default: null },
    },

    // Legacy fields preserved for backward compatibility
    totalVacanciesClosed: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRevenueEarned: {
      type: Number,
      default: 0,
      min: 0,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('PlatformStats', PlatformStatsSchema);
