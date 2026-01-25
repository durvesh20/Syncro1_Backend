// backend/models/Subscription.js
const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM']
  },
  displayName: String,
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
  features: {
    jobLevels: [String], // Entry, Mid, Senior, Executive, C-Suite
    databaseAccess: {
      type: String,
      enum: ['basic', 'advanced', 'premium', 'unlimited']
    },
    commissionRate: {
      type: String,
      enum: ['standard', 'priority', 'premium', 'highest']
    },
    support: {
      type: String,
      enum: ['email', 'priority', 'dedicated', 'white-glove']
    },
    analytics: {
      type: String,
      enum: ['basic', 'advanced', 'premium', 'custom']
    },
    notifications: {
      type: String,
      enum: ['standard', 'priority', 'exclusive']
    },
    accountManager: Boolean,
    performanceBonuses: Boolean,
    exclusiveClientAccess: Boolean,
    customStrategies: Boolean,
    quarterlyReviews: Boolean,
    monthlyReviews: Boolean,
    revenueShare: Boolean
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  staffingPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
    required: true
  },
  plan: {
    type: String,
    enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'],
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'EXPIRED', 'CANCELLED', 'UPGRADED'],
    default: 'ACTIVE'
  },
  payment: {
    orderId: String,
    paymentId: String,
    amount: Number,
    currency: String,
    method: String,
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED']
    },
    paidAt: Date,
    invoice: String
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  previousPlan: String,
  upgradeHistory: [{
    fromPlan: String,
    toPlan: String,
    upgradedAt: Date,
    paymentId: String
  }]
}, {
  timestamps: true
});

const SubscriptionPlan = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = { SubscriptionPlan, Subscription };