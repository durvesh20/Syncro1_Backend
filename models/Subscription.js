// backend/models/Subscription.js
const mongoose = require('mongoose');

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
    required: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPlan'
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly', 'fixed'],
    default: 'monthly'
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

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = { Subscription };