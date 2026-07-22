// backend/models/Candidate.js - UPDATED WITH COMMISSION
const mongoose = require('mongoose');
const { Schema } = mongoose;

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
  uniqueId: {
    type: String,
    unique: true,
    sparse: true,
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  middleName: {
    type: String,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  mobile: {
    type: String,
    required: true,
    trim: true
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
    // ✅ NEW FIELDS from submission form
    middleName: String,
    location: String,               // current location / city
    totalExperience: Number,        // total years of experience
    relevantExperience: Number,     // relevant years of experience
    noticePeriod: {
      type: String,
      enum: [
        'Any',
        'Immediate',
        '0-15 Days',
        '15-30 Days',
        '30-45 Days',
        '45-60 Days',
        '60-75 Days',
        '75-90 Days',
        'Currently Serving',
        '15 days',
        '30 days',
        '45 days',
        '60 days',
        '90 days',
        'More than 90 days'
      ]
    },
    lastWorkingDay: {
      type: Date,
      default: null
    },
    currentSalary: Number,          // in INR per annum
    expectedSalary: Number,         // in INR per annum
    writeup: String,                // small writeup / summary by partner
    languages: [String],
    certifications: [String],

    // ✅ EXISTING FIELDS (kept)
    currentCompany: String,
    currentDesignation: String,
    currentLocation: String,        // kept for backward compatibility
    preferredLocations: [String],
    willingToRelocate: Boolean,
    education: [{
      degree: String,
      institution: String,
      year: Number
    }],
    experience: [{
      company: String,            // company / employer name
      title: String,              // designation / role
      startDate: String,          // normalized "YYYY-MM"
      endDate: String,            // normalized "YYYY-MM" or null for ongoing
      isCurrent: Boolean,         // true when role is ongoing / "Present"
      durationMonths: Number      // inclusive months for this role
    }],
    // Calculated fields (not input)
    totalExperienceMonths: Number,  // derived from merged experience ranges
    experienceYears: Number,       // rounded years from resume parsing
    skills: [String],
    linkedinProfile: String,
    portfolioUrl: String
  },

  // Application Status
  status: {
    type: String,
    enum: [
      // ── Pre-pipeline states (existing flow) ─────────────────────────────
      'DRAFT',                    // Partner filled details, awaiting consent
      'CONSENT_PENDING',          // WhatsApp consent sent to candidate
      'CONSENT_CONFIRMED',        // Candidate confirmed on WhatsApp
      'CONSENT_DENIED',           // Candidate denied — auto withdrawn
      'ADMIN_REVIEW',             // In admin/subadmin queue for review
      'ADMIN_REJECTED',           // Admin rejected before sending to company
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
      'ON_HOLD',
      'SLOT_ASSIGNED',
      'INTERVIEW_CONFIRMED',

      // ── Pipeline FSM states (§1.7) ──────────────────────────────────────
      'ASSESSMENT_PENDING',
      'ASSESSMENT_PASSED',
      'ASSESSMENT_FAILED',
      'SLOTS_NOT_PUBLISHED',
      'SLOTS_PUBLISHED',
      'SLOT_DETAILS_SHARED',
      'RESCHEDULE_REQUESTED',
      'INTERVIEW_CONDUCTED',
      'ROUND_SELECTED_NEXT',
      'ROUND_REJECTED',
      'ROUND_SELECTED_DIRECT_HR',
      'ROUND_ON_HOLD',
      'HR_ROUND_PENDING',
      'HR_SELECTED',
      'HR_REJECTED',
      'HR_ON_HOLD',
      'OFFER_SENT',
      'OFFER_REJECTED',
      'ONBOARDING',
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
    slot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InterviewSlot'
    },
    type: {
      type: String,
      enum: ['Phone', 'Video', 'Face-to-Face', 'Technical', 'HR']
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
    inhandCtc: Number,
    variableCtc: Number,
    joiningDate: Date,
    expectedJoiningDate: Date,
    workMode: {
      type: String,
      enum: ['Remote', 'On-site', 'Hybrid']
    },
    workLocation: String,
    officeAddress: String,
    offerLetterUrl: String,
    negotiationStartedAt: Date,
    isOfferSent: { type: Boolean, default: false },
    offerSentAt: Date,
    offeredAt: Date,
    respondedAt: Date,
    response: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'NEGOTIATING']
    },
    negotiationNotes: String,
    // WhatsApp offer consent token
    offerToken: { type: String, index: true },
    offerWhatsappSentAt: Date,
    offerExpiresAt: Date   // 7 days from send
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
    matchLevel: String,
    recommendation: String,

    scoreBreakdown: {
      skills: {
        score: Number,
        weight: Number,
        matchedRequired: [String],
        missingRequired: [String],
        matchedPreferred: [String],
        missingPreferred: [String],
        coveragePercent: Number
      },
      experience: {
        score: Number,
        weight: Number,
        totalExperience: String,        // (from form — partner-reported)
        relevantExperience: String,     // (from form — partner-reported)
        actual: String,
        required: String,
        status: String,
        detail: String,
        relevancePercent: Number,
        usedForScoringLabel: String     // "relevant" or "total"
      },
      domain: {
        score: Number,
        weight: Number,
        jobDomain: String,
        candidateDomain: String,
        status: String
      },
      education: {
        score: Number,
        weight: Number,
        minimumRequired: String,
        candidateEducation: String,
        status: String
      },
      salary: {
        score: Number,
        weight: Number,
        budget: String,
        expected: String,
        deltaPercent: Number,
        status: String,
        withinBudget: Boolean
      },
      location: {
        score: Number,
        weight: Number,
        jobLocation: String,
        candidateLocation: String,
        status: String,
        detail: String
      },
      noticePeriod: {
        score: Number,
        weight: Number,
        required: String,
        actual: String,
        days: Number,
        status: String
      },
      stability: {
        score: Number,
        weight: Number,
        averageTenureYears: Number,
        last5YearAverageTenureYears: Number,
        totalAverageTenureYears: Number,
        isJobHopper: Boolean,
        risk: String,
        detail: String
      },
      summary: {
        weightedScore: Number,
        riskPenalty: Number,
        riskBreakdown: {
          careerGapPenalty: Number,
          jobHopperPenalty: Number,
          domainMismatchPenalty: Number,
          experienceDiscrepancyPenalty: Number,
          salaryOverBudgetPenalty: Number
        },
        finalAdjustedScore: Number,
        matchLevel: String
      }
    },

    flags: [{
      type: { type: String, enum: ['WARNING', 'SUCCESS', 'INFO'] },
      message: String
    }],
    advice: [String],

    aiData: {
      firstName: String,
      lastName: String,
      email: String,
      mobile: String,
      profile: {
        currentCompany: String,
        currentDesignation: String,
        totalExperience: Number,
        relevantExperience: Number,
        currentLocation: String,
        skills: [String],
        education: [{
          degree: String,
          institution: String,
          year: Number
        }],
        experience: [{
          company: String,
          title: String,
          startDate: String,
          endDate: String,
          isCurrent: Boolean,
          durationMonths: Number
        }],
        languages: [String],
        certifications: [String]
      },
      summary: String
    },

    fullAnalysis: mongoose.Schema.Types.Mixed
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
      enum: ['APPROVED', 'REJECTED', 'PENDING'],
      default: 'PENDING'
    },
    rejectionReason: String
  },
  // ✅ ONLY ADD this one field to track which job slot the candidate is booked in:
  assignedSlot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InterviewSlot',
    default: null,
  },
  interviewConfig: {
    mode: {
      type: String,
      enum: ['Virtual', 'Face-to-Face'],
      default: 'Virtual'
    },
    details: String, // Meeting link or Office address
    interviewer: String,
    isConfirmedByCompany: {
      type: Boolean,
      default: false
    },
    confirmedAt: Date,
    confirmationToken: {
      type: String,
      index: true,
      sparse: true
    },
    candidateResponse: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'DECLINED'],
      default: 'PENDING'
    },
    respondedAt: Date
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
  },

  // ✅ Pool tracing: set when candidate was applied via "Apply from Pool"
  // null = submitted manually (classic flow)
  // ObjectId = came from partner's PartnerCandidate pool entry
  // IMPORTANT: This is for display/tracing ONLY. Never used to sync live data.
  poolCandidateRef: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PartnerCandidate',
    default: null
  },


  // ── Pipeline FSM sub-documents (additive — do not touch existing fields) ──

  // Ordered list of rounds the Client defines for this candidate (per-candidate template)
  pipelineTemplate: [
    {
      roundType: {
        type: String,
        required: true
      },
      order: { type: Number, required: true } // 1-based
    }
  ],

  // Execution state for each round in the pipeline
  rounds: [
    {
      roundType: {
        type: String
      },
      order: Number,
      status: { type: String, default: 'SLOTS_NOT_PUBLISHED' },

      // Slots defined for this round (L-rounds only)
      slots: [
        {
          date: Date,
          startTime: String,
          endTime: String,
          timezone: { type: String, default: 'Asia/Kolkata' },
          mode: { type: String, enum: ['FACE_TO_FACE', 'VIRTUAL'] },
          interviewerName: String,
          capacity: { type: Number, default: 1 },
          publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'StaffingPartner' },
          bookedAt: Date,
          // Mode-specific details — filled at Step C (SHARE_DETAILS action)
          details: {
            address: String,
            meetingLink: String,
            pointOfContact: {
              name: String,
              phone: String,
              email: String
            }
          }
        }
      ],

      // Reschedule counters (candidate cap enforced server-side)
      rescheduleCount: {
        candidateInitiated: { type: Number, default: 0 },
        clientInitiated: { type: Number, default: 0 },
        partnerInitiated: { type: Number, default: 0 }
      },

      rescheduleRequest: {
        status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED'], default: 'PENDING' },
        requestedBy: { type: String, enum: ['PARTNER', 'CANDIDATE', 'COMPANY'] },
        reason: String,
        requestedAt: Date,
        suggestedSlots: [
          {
            slotId: mongoose.Schema.Types.ObjectId,
            date: Date,
            startTime: String,
            endTime: String,
            timezone: { type: String, default: 'Asia/Kolkata' },
            mode: { type: String, enum: ['FACE_TO_FACE', 'VIRTUAL'] },
            interviewerName: String
          }
        ],
        selectedSlotId: mongoose.Schema.Types.ObjectId,
        actionedAt: Date,
        actionedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rejectionReason: String
      },

      // Round outcome (set after INTERVIEW_CONDUCTED)
      outcome: {
        decision: {
          type: String,
          enum: ['SELECTED_NEXT_ROUND', 'REJECTED', 'SELECTED_DIRECT_HR', 'SKIPPED_TO_HR', 'ON_HOLD']
        },
        reason: String,
        decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        decidedAt: Date
      },

      // Hold resolution (set when resolving ROUND_ON_HOLD)
      holdResolution: {
        resolvedTo: String,
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        resolvedAt: Date
      }
    }
  ],

  // HR round decision
  hrRound: {
    status: {
      type: String,
      enum: ['HR_ROUND_PENDING', 'HR_SELECTED', 'HR_REJECTED', 'HR_ON_HOLD']
    },
    reason: String,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    holdResolution: {
      resolvedTo: String,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      resolvedAt: Date
    }
  },

  // Immutable audit trail — one entry per FSM transition
  auditTrail: [
    {
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      actorRole: String,
      action: String,
      fromState: String,
      toState: String,
      reason: String,
      roundIndex: Number, // which round this pertains to (null for top-level actions)
      timestamp: { type: Date, default: Date.now }
    }
  ],

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
candidateSchema.index({ 'resumeAnalysis.profileScore': -1 });
candidateSchema.index({ 'adminQueue.action': 1, createdAt: -1 });

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

candidateSchema.pre('save', function (next) {
  if (!this.uniqueId) {
    const now = new Date();
    const year = now.getFullYear();
    const date = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');

    this.uniqueId = `${year}${date}${month}-${hours}${minutes}${seconds}-${random}`;
  }
  next();
});

module.exports = mongoose.model('Candidate', candidateSchema);