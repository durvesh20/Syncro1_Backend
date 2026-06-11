// backend/models/SubscriptionPlan.js
const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  planKey: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  subHeading: String,
  ctcRange: String,
  price: {
    type: Number,
    required: true
  },
  gstPercentage: {
    type: Number,
    default: 18
  },
  currency: {
    type: String,
    default: 'INR'
  },
  duration: {
    type: Number, // in days
    default: 30
  },
  billingCycle: {
    type: String,
    enum: ['monthly', '3month', '6month', 'yearly', 'fixed'],
    default: 'monthly'
  },
  features: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  isHighlight: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  discountPercentage: {
    type: Number,
    default: 0
  },
  accessiblePlanJobs: {
    type: [String],
    enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'],
    default: ['FREE']
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
