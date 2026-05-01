// backend/models/Candidate.js - UPDATED WITH COMMISSION
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

  consent: {
    given: {
      type: Boolean,
      required: true,
      default: false
    },
    givenAt: Date,
    ipAddress: String,

    // Candidate's own consent confirmation
    consentToken: {
      type: String,
      index: true,
      sparse: true
    },
    consentStatus: {
      type: String,
      enum: ['PENDING_CONFIRMATION', 'CONFIRMED', 'DENIED'],
      default: 'PENDING_CONFIRMATION'
    },
    consentConfirmedAt: Date,
    consentDeniedAt: Date,
    consentIp: String
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
      // ✅ NEW STATUSES for new flow
      'DRAFT',                    // Partner filled details, awaiting consent
      'CONSENT_PENDING',          // WhatsApp consent sent to candidate
      'CONSENT_CONFIRMED',        // Candidate confirmed on WhatsApp
      'CONSENT_DENIED',           // Candidate denied — auto withdrawn
      'ADMIN_REVIEW',             // In admin/subadmin queue for review
      'ADMIN_REJECTED',           // Admin rejected before sending to company

      // ✅ EXISTING STATUSES (after admin approves)
      'SUBMITTED',                // Admin approved → visible to company
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
    default: 'DRAFT'
  },

  // Submission Metadata
  submissionMetadata: {
    duplicateWarnings: [mongoose.Schema.Types.Mixed],
    forceSubmitted: { type: Boolean, default: false },
    submittedFromPlan: String,
    matchScore: Number
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
    salary: Number, // Annual CTC
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

  // ==================== COMMISSION SYSTEM (RE-ENABLED) ====================
  commission: {
    // Fixed 5% rate
    rate: {
      type: Number,
      default: 5,
      immutable: true // Cannot be changed
    },
    // Base = Annual CTC from offer
    baseAmount: Number,
    // 5% of baseAmount
    commissionAmount: Number,
    // GST details
    gstPercentage: {
      type: Number,
      default: 18
    },
    gstAmount: Number,
    // TDS details
    tdsPercentage: {
      type: Number,
      default: 10
    },
    tdsAmount: Number,
    // Final calculations
    grossAmount: Number, // commission + GST
    netPayable: Number,  // gross - TDS (what partner receives)
    // Audit
    calculatedAt: Date,
    calculatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Payout tracking
  payout: {
    status: {
      type: String,
      enum: [
        'NOT_ELIGIBLE',  // Not yet joined
        'PENDING',       // Joined, waiting 90 days
        'ELIGIBLE',      // 90 days completed, ready for payout
        'APPROVED',      // Admin approved
        'PROCESSING',    // Payment in progress
        'PAID',          // Payment completed
        'ON_HOLD',       // Temporarily held
        'FORFEITED'      // Candidate left before 90 days
      ],
      default: 'NOT_ELIGIBLE'
    },
    eligibleDate: Date,      // Joining date + 90 days
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: Date,
    paidAt: Date,
    transactionId: String,
    utrNumber: String,
    paymentMethod: String,
    notes: String
  },

  // Replacement Guarantee
  replacementGuarantee: {
    isActive: { type: Boolean, default: false },
    startDate: Date,       // Joining date
    endDate: Date,         // Joining date + 90 days
    daysRemaining: Number,
    candidateLeftEarly: { type: Boolean, default: false },
    leftDate: Date,
    refundRequired: { type: Boolean, default: false }
  },

  // Partner Invoice (Partner → Syncro1)
  partnerInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
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
  },

  // ✅ NEW: AI Resume Parsing Result
  resumeAnalysis: {
    parsed: { type: Boolean, default: false },
    parsedAt: Date,
    profileScore: { type: Number, default: 0 },
    scoreBreakdown: mongoose.Schema.Types.Mixed,
    matchLevel: String,           // STRONG_MATCH, GOOD_MATCH, etc
    recommendation: String,
    flags: [mongoose.Schema.Types.Mixed],
    advice: [String],
    aiData: mongoose.Schema.Types.Mixed  // full parsed resume data
  },

  // ✅ NEW: Admin Queue
  adminQueue: {
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    assignedAt: Date,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: Date,
    reviewNotes: String,
    action: {
      type: String,
      enum: ['APPROVED', 'REJECTED', 'PENDING']
    },
    rejectionReason: String
  },

  // ✅ NEW: Consent tracking (WhatsApp)
  whatsappConsent: {
    sentAt: Date,
    sentTo: String,       // phone number
    token: String,        // unique token
    expiresAt: Date,
    confirmedAt: Date,
    deniedAt: Date,
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'DENIED', 'EXPIRED'],
      default: 'PENDING'
    }
  }

}, {
  timestamps: true
});
// ==================== INDEXES ====================
candidateSchema.index({ job: 1, submittedBy: 1 });
candidateSchema.index({ email: 1, job: 1 });
candidateSchema.index({ status: 1 });
candidateSchema.index({ company: 1, status: 1, createdAt: -1 });
candidateSchema.index({ submittedBy: 1, createdAt: -1 });
candidateSchema.index({ 'payout.status': 1, 'payout.eligibleDate': 1 }); // For payout queries
candidateSchema.index({ 'replacementGuarantee.endDate': 1 }); // For guarantee expiry

// ==================== METHODS ====================

/**
 * Calculate commission when candidate joins
 * Fixed 5% of annual CTC + 18% GST - 10% TDS
 */
candidateSchema.methods.calculateCommission = function (calculatedByUserId = null) {
  if (!this.offer || !this.offer.salary) {
    throw new Error('Offer salary (annual CTC) is required to calculate commission');
  }

  const annualCTC = this.offer.salary;
  const COMMISSION_RATE = 5;  // Fixed 5%
  const GST_RATE = 18;        // 18% GST
  const TDS_RATE = 10;        // 10% TDS at source

  // Calculate amounts
  const commissionAmount = Math.round(annualCTC * COMMISSION_RATE / 100);
  const gstAmount = Math.round(commissionAmount * GST_RATE / 100);
  const grossAmount = commissionAmount + gstAmount;
  const tdsAmount = Math.round(commissionAmount * TDS_RATE / 100);
  const netPayable = grossAmount - tdsAmount;

  this.commission = {
    rate: COMMISSION_RATE,
    baseAmount: annualCTC,
    commissionAmount,
    gstPercentage: GST_RATE,
    gstAmount,
    tdsPercentage: TDS_RATE,
    tdsAmount,
    grossAmount,
    netPayable,
    calculatedAt: new Date(),
    calculatedBy: calculatedByUserId
  };

  return this.commission;
};

/**
 * Set up replacement guarantee (90 days from joining)
 */
candidateSchema.methods.setupReplacementGuarantee = function () {
  const joiningDate = this.joining?.actualJoiningDate || new Date();
  const guaranteeEndDate = new Date(joiningDate);
  guaranteeEndDate.setDate(guaranteeEndDate.getDate() + 90);

  this.replacementGuarantee = {
    isActive: true,
    startDate: joiningDate,
    endDate: guaranteeEndDate,
    daysRemaining: 90,
    candidateLeftEarly: false
  };

  this.payout.status = 'PENDING';
  this.payout.eligibleDate = guaranteeEndDate;

  return this.replacementGuarantee;
};

/**
 * Check if payout is eligible (90 days completed)
 */
candidateSchema.methods.isPayoutEligible = function () {
  if (this.payout.status === 'FORFEITED') return false;
  if (this.replacementGuarantee.candidateLeftEarly) return false;

  const now = new Date();
  return now >= this.payout.eligibleDate;
};

/**
 * Mark candidate as left early (forfeit commission)
 */
candidateSchema.methods.markLeftEarly = function (leftDate = new Date()) {
  this.replacementGuarantee.candidateLeftEarly = true;
  this.replacementGuarantee.leftDate = leftDate;
  this.replacementGuarantee.isActive = false;
  this.payout.status = 'FORFEITED';
  this.payout.notes = `Candidate left on ${leftDate.toDateString()} before 90-day guarantee period`;

  return this;
};

/**
 * Get commission summary for display
 */
candidateSchema.methods.getCommissionSummary = function () {
  if (!this.commission || !this.commission.commissionAmount) {
    return null;
  }

  return {
    annualCTC: this.commission.baseAmount,
    commissionRate: `${this.commission.rate}%`,
    breakdown: {
      baseCommission: this.commission.commissionAmount,
      gst: `+${this.commission.gstAmount} (${this.commission.gstPercentage}%)`,
      tds: `-${this.commission.tdsAmount} (${this.commission.tdsPercentage}% TDS)`,
      netPayout: this.commission.netPayable
    },
    payoutStatus: this.payout.status,
    eligibleDate: this.payout.eligibleDate,
    isEligible: this.isPayoutEligible()
  };
};

module.exports = mongoose.model('Candidate', candidateSchema);