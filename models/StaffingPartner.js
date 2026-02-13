// backend/models/StaffingPartner.js
const mongoose = require('mongoose');

const staffingPartnerSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // ==================== 1. PRIMARY PARTNER ACCOUNT ====================
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  designation: {
    type: String,
    required: [true, 'Designation is required'],
    trim: true
  },
  linkedinProfile: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true
  },

  // ==================== 2. FIRM / ORGANIZATION DETAILS ====================
  firmName: {
    type: String,
    required: [true, 'Firm name is required'],
    trim: true
  },
  firmDetails: {
    registeredName: String,
    tradeName: String,
    entityType: {
      type: String,
      enum: ['Proprietor', 'Partnership', 'LLP', 'Private Limited', 'Agency']
    },
    yearEstablished: Number,
    website: String,
    registeredOfficeAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' }
    },
    operatingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' },
      sameAsRegistered: { type: Boolean, default: false }
    },
    panNumber: String,
    gstNumber: String,
    cinNumber: String,
    llpinNumber: String,
    employeeCount: {
      type: String,
      enum: ['1-5', '6-20', '21-50', '51-100', '100+']
    }
  },

  // ==================== 3. RECRUITMENT COMPETENCY PROFILE ====================
  Syncro1Competency: {
    primaryHiringSectors: [{
      type: String,
      enum: [
        'BFSI', 'Technology', 'Pharma', 'E-commerce', 'Engineering',
        'Defence', 'Gaming', 'Agriculture', 'Healthcare', 'Retail',
        'Manufacturing', 'Education', 'Hospitality', 'Telecom',
        'Media', 'Legal', 'Real Estate', 'Logistics', 'Other'
      ]
    }],
    hiringLevels: [{
      type: String,
      enum: ['Entry', 'Mid', 'Senior', 'Leadership']
    }],
    avgCtcRangeHandled: {
      type: String,
      enum: ['0-5 LPA', '5-20 LPA', '20-35 LPA', '35+ LPA']
    },
    averageMonthlyClosures: Number,
    yearsOfRecruitmentExperience: Number,
    functionalAreas: [String],
    topClients: [String],
    specializations: [String]
  },

  // ==================== 4. GEOGRAPHIC & DELIVERY REACH ====================
  geographicReach: {
    preferredHiringLocations: [String],
    panIndiaCapability: { type: Boolean, default: false },
    operatingCities: [String],
    operatingStates: [String],
    internationalReach: { type: Boolean, default: false },
    internationalCountries: [String]
  },

  // ==================== 5. COMPLIANCE & ETHICAL DECLARATIONS ====================
  compliance: {
    syncrotechAgreement: {
      noCvRecycling: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      noFakeProfiles: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      noDoubleRepresentation: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      vendorCodeOfConduct: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      dataPrivacyPolicy: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      candidateConsentPolicy: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      nonCircumventionClause: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      commissionPayoutTerms: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      },
      replacementBackoutLiability: {
        accepted: { type: Boolean, default: false },
        acceptedAt: Date,
        acceptedIp: String
      }
    },
    allClausesAccepted: { type: Boolean, default: false },
    agreementAcceptedAt: Date,
    agreementAcceptedIp: String,
    digitalSignature: String,
    termsAccepted: { type: Boolean, default: false },
    ndaSigned: { type: Boolean, default: false },
    agreementSigned: { type: Boolean, default: false },
    agreementSignedAt: Date
  },

  // ==================== 6. COMMERCIAL & PAYOUT PREFERENCES (MERGED) ====================
  commercialDetails: {
    // Payout Entity Info
    payoutEntityName: { type: String, trim: true },
    gstRegistration: {
      type: String,
      enum: ['Regular', 'Composition', 'Unregistered'],
      default: 'Unregistered'
    },
    tdsApplicable: { type: Boolean, default: true },
    
    // Bank Details
    bankAccountHolderName: String,
    bankName: String,
    accountNumber: String,
    ifscCode: String
  },

  // ==================== 7. DOCUMENTS ====================
  documents: {
    panCard: String,
    gstCertificate: String,
    incorporationCertificate: String,
    cancelledCheque: String,
    authorizedSignatoryProof: String,
    addressProof: String
  },

  // ==================== 8. TEAM & SUB-RECRUITER ACCESS ====================
  teamAccess: {
    isTeamEnabled: { type: Boolean, default: false },
    teamMembers: [{
      name: String,
      email: String,
      mobile: String,
      role: {
        type: String,
        enum: ['Admin', 'Recruiter', 'Viewer'],
        default: 'Recruiter'
      },
      permissions: {
        canViewJobs: { type: Boolean, default: true },
        canSubmitCandidates: { type: Boolean, default: true },
        canViewEarnings: { type: Boolean, default: false },
        canManageTeam: { type: Boolean, default: false }
      },
      addedAt: { type: Date, default: Date.now },
      isActive: { type: Boolean, default: true }
    }]
  },

  // ==================== SUBSCRIPTION ====================
  subscription: {
    plan: {
      type: String,
      enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'],
      default: 'FREE'
    },
    startDate: Date,
    endDate: Date,
    isActive: { type: Boolean, default: true },
    autoRenew: { type: Boolean, default: false }
  },

  // ==================== PERFORMANCE METRICS ====================
  metrics: {
    totalSubmissions: { type: Number, default: 0 },
    totalPlacements: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
    pendingPayouts: { type: Number, default: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 }
  },

  // ==================== VERIFICATION ====================
  verificationStatus: {
    type: String,
    enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  verificationNotes: String,
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: Date,
  rejectionReason: String,

  // ==================== PROFILE COMPLETION (UPDATED) ====================
  profileCompletion: {
    basicInfo: { type: Boolean, default: false },
    firmDetails: { type: Boolean, default: false },
    Syncro1Competency: { type: Boolean, default: false },
    geographicReach: { type: Boolean, default: false },
    compliance: { type: Boolean, default: false },
    commercialDetails: { type: Boolean, default: false },  // ✅ MERGED
    documents: { type: Boolean, default: false }
  },

  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

staffingPartnerSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

staffingPartnerSchema.methods.getProfileCompletionPercentage = function() {
  const fields = Object.values(this.profileCompletion);
  const completed = fields.filter(Boolean).length;
  return Math.round((completed / fields.length) * 100);
};

module.exports = mongoose.model('StaffingPartner', staffingPartnerSchema);