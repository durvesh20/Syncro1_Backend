// backend/models/Payout.js
const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
  staffingPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
    required: true
  },
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
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  amount: {
    gross: { type: Number, required: true },
    tds: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    net: { type: Number, required: true }
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'ON_HOLD', 'REJECTED'],
    default: 'PENDING'
  },
  paymentDetails: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    transactionId: String,
    paidAt: Date,
    utrNumber: String
  },
  invoice: {
    number: String,
    url: String,
    generatedAt: Date
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectionReason: String,
  notes: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Payout', payoutSchema);