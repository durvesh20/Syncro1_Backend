// backend/models/JobEditRequest.js
const mongoose = require('mongoose');

const jobEditRequestSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    index: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // What fields they want to change
  requestedChanges: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    validate: {
      validator: function(v) {
        return v && typeof v === 'object' && Object.keys(v).length > 0;
      },
      message: 'At least one change must be requested'
    }
  },
  
  // Company's explanation
  changeDescription: {
    type: String,
    required: [true, 'Please explain why you need this edit'],
    minlength: [10, 'Description must be at least 10 characters'],
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  
  // Review status
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'],
    default: 'PENDING',
    index: true
  },
  
  // Admin review
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewedAt: Date,
  adminResponse: String,
  
  // If approved, when changes were applied
  appliedAt: Date,
  appliedChanges: mongoose.Schema.Types.Mixed,
  
  // Priority
  priority: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
    default: 'MEDIUM'
  },
  
  // Metadata
  ipAddress: String,
  userAgent: String
}, {
  timestamps: true
});

// Indexes for performance
jobEditRequestSchema.index({ job: 1, status: 1 });
jobEditRequestSchema.index({ company: 1, createdAt: -1 });
jobEditRequestSchema.index({ status: 1, priority: -1, createdAt: 1 });

// Virtual for request age
jobEditRequestSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60)); // hours
});

// Method to check if stale (pending > 7 days)
jobEditRequestSchema.methods.isStale = function() {
  if (this.status !== 'PENDING') return false;
  const days = (Date.now() - this.createdAt) / (1000 * 60 * 60 * 24);
  return days > 7;
};

module.exports = mongoose.model('JobEditRequest', jobEditRequestSchema);