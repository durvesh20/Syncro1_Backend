// backend/models/Payout.js - COMPLETE REWRITE
const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  // Partner receiving payout
  staffingPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
    required: true,
    index: true
  },

  // Related entities
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true,
    index: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },

  // Amount breakdown (5% fixed commission)
  amount: {
    annualCTC: { type: Number, required: true },
    commissionRate: { type: Number, default: 5 },
    baseCommission: { type: Number, required: true }, // 5% of CTC
    gstPercentage: { type: Number, default: 18 },
    gstAmount: { type: Number, required: true },
    grossAmount: { type: Number, required: true }, // base + GST
    tdsPercentage: { type: Number, default: 10 },
    tdsAmount: { type: Number, required: true },
    netPayable: { type: Number, required: true }, // What partner receives
    currency: { type: String, default: 'INR' }
  },

  // Payout status
  status: {
    type: String,
    enum: [
      'PENDING',       // Waiting for 90-day period
      'ELIGIBLE',      // 90 days completed, can be approved
      'APPROVED',      // Admin approved, ready for payment
      'PROCESSING',    // Payment initiated
      'PAID',          // Payment completed
      'ON_HOLD',       // Temporarily held (dispute, etc.)
      'FORFEITED',     // Candidate left early, no payout
      'REJECTED'       // Admin rejected
    ],
    default: 'PENDING',
    index: true
  },

  // Replacement guarantee tracking
  replacementGuarantee: {
    startDate: Date,        // Candidate joining date
    endDate: Date,          // Joining + 90 days
    daysTotal: { type: Number, default: 90 },
    isActive: { type: Boolean, default: true },
    candidateStatus: {
      type: String,
      enum: ['ACTIVE', 'LEFT_EARLY', 'COMPLETED'],
      default: 'ACTIVE'
    },
    leftEarlyDate: Date,
    daysCompleted: Number
  },

  // Payment details (filled when paid)
  payment: {
    method: {
      type: String,
      enum: ['BANK_TRANSFER', 'UPI', 'RAZORPAY', 'CHEQUE', 'MANUAL']
    },
    transactionId: String,
    utrNumber: String,
    paidAt: Date,
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    // Partner's bank details at time of payment (snapshot)
    bankDetails: {
      accountHolderName: String,
      bankName: String,
      accountNumber: String,
      ifscCode: String
    },
    paymentProof: String // URL to payment receipt/screenshot
  },

  // Partner Invoice reference
  partnerInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
  },

  // Company Invoice reference (Syncro1 → Company)
  companyInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
  },

  // Approval workflow
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedAt: Date,
  rejectionReason: String,

  // Hold info
  heldBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  heldAt: Date,
  holdReason: String,
  releasedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  releasedAt: Date,

  // Notes
  notes: String,
  internalNotes: String,

  // Audit trail
  history: [{
    action: {
      type: String,
      enum: ['CREATED', 'ELIGIBLE', 'APPROVED', 'REJECTED', 'HELD', 'RELEASED', 'PROCESSING', 'PAID', 'FORFEITED']
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    performedAt: {
      type: Date,
      default: Date.now
    },
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// ==================== INDEXES ====================
payoutSchema.index({ staffingPartner: 1, status: 1, createdAt: -1 });
payoutSchema.index({ status: 1, 'replacementGuarantee.endDate': 1 });
payoutSchema.index({ 'payment.paidAt': 1 });

// ==================== METHODS ====================

/**
 * Add history entry
 */
payoutSchema.methods.addHistory = function (action, userId, notes = '', metadata = {}) {
  this.history.push({
    action,
    performedBy: userId,
    performedAt: new Date(),
    notes,
    metadata
  });
};

/**
 * Check if payout is eligible (90 days completed)
 */
payoutSchema.methods.checkEligibility = function () {
  if (this.status === 'FORFEITED') return false;
  if (this.replacementGuarantee.candidateStatus === 'LEFT_EARLY') return false;

  const now = new Date();
  return now >= this.replacementGuarantee.endDate;
};

/**
 * Calculate days remaining in guarantee period
 */
payoutSchema.methods.getDaysRemaining = function () {
  if (this.status === 'FORFEITED' || this.status === 'PAID') return 0;

  const now = new Date();
  const endDate = new Date(this.replacementGuarantee.endDate);
  const diffTime = endDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return Math.max(0, diffDays);
};

/**
 * Mark as forfeited (candidate left early)
 */
payoutSchema.methods.forfeit = function (leftDate, userId) {
  const joiningDate = new Date(this.replacementGuarantee.startDate);
  const leftDateObj = new Date(leftDate);
  const daysCompleted = Math.floor((leftDateObj - joiningDate) / (1000 * 60 * 60 * 24));

  this.status = 'FORFEITED';
  this.replacementGuarantee.candidateStatus = 'LEFT_EARLY';
  this.replacementGuarantee.leftEarlyDate = leftDate;
  this.replacementGuarantee.daysCompleted = daysCompleted;
  this.replacementGuarantee.isActive = false;

  this.addHistory('FORFEITED', userId, `Candidate left after ${daysCompleted} days (before 90-day guarantee)`, {
    leftDate,
    daysCompleted
  });

  return this;
};

/**
 * Mark as eligible (90 days completed)
 */
payoutSchema.methods.markEligible = function (userId = null) {
  if (!this.checkEligibility()) {
    throw new Error('Payout is not eligible yet');
  }

  this.status = 'ELIGIBLE';
  this.replacementGuarantee.candidateStatus = 'COMPLETED';
  this.replacementGuarantee.isActive = false;
  this.replacementGuarantee.daysCompleted = 90;

  this.addHistory('ELIGIBLE', userId, '90-day guarantee period completed');

  return this;
};

/**
 * Approve payout
 */
payoutSchema.methods.approve = function (userId, notes = '') {
  if (this.status !== 'ELIGIBLE') {
    throw new Error('Only ELIGIBLE payouts can be approved');
  }

  this.status = 'APPROVED';
  this.approvedBy = userId;
  this.approvedAt = new Date();

  this.addHistory('APPROVED', userId, notes || 'Payout approved for processing');

  return this;
};

/**
 * Mark as paid
 */
payoutSchema.methods.markPaid = function (paymentData, userId) {
  if (this.status !== 'APPROVED' && this.status !== 'PROCESSING') {
    throw new Error('Only APPROVED/PROCESSING payouts can be marked as paid');
  }

  this.status = 'PAID';
  this.payment = {
    ...paymentData,
    paidAt: new Date(),
    paidBy: userId
  };

  this.addHistory('PAID', userId, `Payment completed. UTR: ${paymentData.utrNumber || paymentData.transactionId}`, {
    amount: this.amount.netPayable,
    transactionId: paymentData.transactionId,
    utrNumber: paymentData.utrNumber
  });

  return this;
};

module.exports = mongoose.model('Payout', payoutSchema);