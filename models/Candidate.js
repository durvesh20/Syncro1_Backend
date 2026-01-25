// backend/models/Candidate.js
const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  // Submitted by Staffing Partner
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
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

  // Candidate Info
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true
  },
  mobile: {
    type: String,
    required: true
  },
  
  // Consent
  consent: {
    given: {
      type: Boolean,
      required: true,
      default: false
    },
    givenAt: Date,
    consentDocument: String,
    ipAddress: String
  },

  // Resume
  resume: {
    url: String,
    fileName: String,
    uploadedAt: Date
  },

  // Profile
  profile: {
    currentCompany: String,
    currentDesignation: String,
    totalExperience: Number,
    relevantExperience: Number,
    currentLocation: String,
    preferredLocations: [String],
    currentSalary: Number,
    expectedSalary: Number,
    noticePeriod: String,
    canRelocate: Boolean,
    education: [{
      degree: String,
      institution: String,
      year: Number
    }],
    skills: [String],
    linkedinProfile: String,
    portfolioUrl: String
  },

  // Application Status
  status: {
    type: String,
    enum: [
      'SUBMITTED',
      'UNDER_REVIEW',
      'SHORTLISTED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEWED',
      'OFFERED',
      'OFFER_ACCEPTED',
      'OFFER_DECLINED',
      'JOINED',
      'REJECTED',
      'WITHDRAWN',
      'ON_HOLD'
    ],
    default: 'SUBMITTED'
  },

  // Status History
  statusHistory: [{
    status: String,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    notes: String
  }],

  // Interview Details
  interviews: [{
    round: Number,
    type: {
      type: String,
      enum: ['Phone', 'Video', 'In-Person', 'Technical', 'HR']
    },
    scheduledAt: Date,
    interviewerName: String,
    interviewerEmail: String,
    meetingLink: String,
    feedback: String,
    rating: Number,
    result: {
      type: String,
      enum: ['PENDING', 'PASSED', 'FAILED']
    }
  }],

  // Offer Details
  offer: {
    salary: Number,
    joiningDate: Date,
    offerLetterUrl: String,
    offeredAt: Date,
    respondedAt: Date,
    response: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'NEGOTIATING']
    },
    negotiationNotes: String
  },

  // Joining Details
  joining: {
    actualJoiningDate: Date,
    confirmed: Boolean,
    confirmedAt: Date,
    documentsSubmitted: Boolean
  },

  // Commission & Payout
  payout: {
    commissionAmount: Number,
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'ON_HOLD'],
      default: 'PENDING'
    },
    paidAt: Date,
    transactionId: String
  },

  // Notes
  notes: [{
    content: String,
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    isInternal: {
      type: Boolean,
      default: true
    }
  }],

  // Ratings
  ratings: {
    byCompany: {
      score: Number,
      feedback: String
    },
    byStaffingPartner: {
      score: Number,
      feedback: String
    }
  },

  // Quality Check
  qualityCheck: {
    status: {
      type: String,
      enum: ['PENDING', 'PASSED', 'FAILED'],
      default: 'PENDING'
    },
    checkedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    checkedAt: Date,
    issues: [String]
  }
}, {
  timestamps: true
});

// Index for faster queries
candidateSchema.index({ job: 1, submittedBy: 1 });
candidateSchema.index({ email: 1, job: 1 });
candidateSchema.index({ status: 1 });

module.exports = mongoose.model('Candidate', candidateSchema);