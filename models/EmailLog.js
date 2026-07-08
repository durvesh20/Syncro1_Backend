// backend/models/EmailLog.js
const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  date: {
    type: String, // format "YYYY-MM-DD" representing the day the email was scheduled
    required: true
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED'],
    required: true
  },
  error: {
    type: String
  }
}, {
  timestamps: true
});

// Compound unique index to ensure idempotency (no duplicate emails for the same user, job, and date)
emailLogSchema.index({ user: 1, job: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('EmailLog', emailLogSchema);
