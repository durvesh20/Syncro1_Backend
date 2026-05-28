// backend/models/Invoice.js - COMPLETE REWRITE
const mongoose = require('mongoose');

/**
 * Invoice types:
 * 1. PARTNER_TO_SYNCRO1 - Partner bills Syncro1 for commission
 * 2. SYNCRO1_TO_COMPANY - Syncro1 bills Company for recruitment service
 */

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Invoice Type
  invoiceType: {
    type: String,
    enum: ['PARTNER_TO_SYNCRO1', 'SYNCRO1_TO_COMPANY'],
    required: true
  },

  // Parties involved
  from: {
    entityType: {
      type: String,
      enum: ['PARTNER', 'SYNCRO1'],
      required: true
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'from.entityType === "PARTNER" ? "StaffingPartner" : null'
    },
    name: String,
    address: String,
    gstin: String,
    pan: String,
    email: String,
    phone: String
  },

  to: {
    entityType: {
      type: String,
      enum: ['SYNCRO1', 'COMPANY'],
      required: true
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'to.entityType === "COMPANY" ? "Company" : null'
    },
    name: String,
    address: String,
    gstin: String,
    pan: String,
    email: String,
    phone: String
  },

  // Related entities
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  staffingPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },

  // Candidate details for invoice
  candidateDetails: {
    name: String,
    position: String,
    joiningDate: Date,
    annualCTC: Number
  },

  // Line items (detailed breakdown)
  lineItems: [{
    description: String,
    quantity: { type: Number, default: 1 },
    rate: Number,
    amount: Number,
    hsnSac: String // HSN/SAC code for GST
  }],

  // Amount Summary
  amount: {
    subtotal: { type: Number, required: true },
    discountPercentage: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    taxableAmount: { type: Number, required: true },
    // GST breakdown
    cgstPercentage: { type: Number, default: 9 },
    cgstAmount: { type: Number, default: 0 },
    sgstPercentage: { type: Number, default: 9 },
    sgstAmount: { type: Number, default: 0 },
    igstPercentage: { type: Number, default: 18 },
    igstAmount: { type: Number, default: 0 },
    // TDS (for partner invoices)
    tdsPercentage: { type: Number, default: 0 },
    tdsAmount: { type: Number, default: 0 },
    // Final
    totalGst: { type: Number, required: true },
    grandTotal: { type: Number, required: true },
    amountPayable: { type: Number, required: true }, // After TDS deduction
    currency: { type: String, default: 'INR' },
    amountInWords: String
  },

  // Dates
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  serviceFromDate: Date,
  serviceToDate: Date,

  // Status
  status: {
    type: String,
    enum: ['DRAFT', 'GENERATED', 'SENT', 'VIEWED', 'PAID', 'PARTIALLY_PAID', 'OVERDUE', 'CANCELLED', 'DISPUTED'],
    default: 'DRAFT',
    index: true
  },

  // Payment tracking
  payments: [{
    amount: Number,
    paidAt: Date,
    transactionId: String,
    utrNumber: String,
    paymentMethod: {
      type: String,
      enum: ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'RAZORPAY', 'OTHER']
    },
    notes: String,
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  totalPaid: { type: Number, default: 0 },
  balanceDue: Number,

  // PDF
  pdfUrl: String,
  pdfGeneratedAt: Date,

  // Bank details (for payment)
  bankDetails: {
    accountHolderName: String,
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    upiId: String
  },

  // Notes & Terms
  notes: String,
  termsAndConditions: String,
  internalNotes: String,

  // Audit
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sentAt: Date,
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  viewedAt: Date,

  // Linked payout (for partner invoices)
  linkedPayout: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payout'
  }
}, {
  timestamps: true
});

// ==================== INDEXES ====================
invoiceSchema.index({ invoiceType: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ staffingPartner: 1, invoiceType: 1 });
invoiceSchema.index({ company: 1, invoiceType: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ candidate: 1 });

// ==================== AUTO-GENERATE INVOICE NUMBER ====================
invoiceSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const count = await mongoose.model('Invoice').countDocuments();
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const prefix = this.invoiceType === 'PARTNER_TO_SYNCRO1' ? 'PINV' : 'SINV';
    this.invoiceNumber = `${prefix}-${year}${month}-${String(count + 1).padStart(5, '0')}`;
  }

  // Calculate balance due
  this.balanceDue = this.amount.amountPayable - (this.totalPaid || 0);

  next();
});

// ==================== METHODS ====================

/**
 * Convert number to words (Indian format)
 */
invoiceSchema.methods.convertAmountToWords = function () {
  const amount = Math.round(this.amount.grandTotal);
  // Simplified - in production use a proper library
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

  if (amount === 0) return 'Zero Rupees Only';

  // Simplified conversion - use a library like 'number-to-words' for production
  this.amount.amountInWords = `Rupees ${amount.toLocaleString('en-IN')} Only`;
  return this.amount.amountInWords;
};

/**
 * Check if invoice is overdue
 */
invoiceSchema.methods.isOverdue = function () {
  if (this.status === 'PAID') return false;
  return new Date() > this.dueDate;
};

/**
 * Record a payment
 */
invoiceSchema.methods.recordPayment = function (paymentData, recordedByUserId) {
  this.payments.push({
    ...paymentData,
    paidAt: new Date(),
    recordedBy: recordedByUserId
  });

  this.totalPaid = this.payments.reduce((sum, p) => sum + p.amount, 0);
  this.balanceDue = this.amount.amountPayable - this.totalPaid;

  if (this.balanceDue <= 0) {
    this.status = 'PAID';
  } else if (this.totalPaid > 0) {
    this.status = 'PARTIALLY_PAID';
  }

  return this;
};

module.exports = mongoose.model('Invoice', invoiceSchema);