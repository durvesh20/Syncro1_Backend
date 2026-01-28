// backend/models/StaffingPartner.js
const mongoose = require('mongoose');

const staffingPartnerSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // Basic Info
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
  firmName: {
    type: String,
    required: [true, 'Firm/Legal Business name is required'],
    trim: true
  },
  designation: {
    type: String,
    required: [true, 'Role/Designation is required']
  },
  linkedinProfile: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    required: [true, 'City is required']
  },
  state: {
    type: String,
    required: [true, 'State is required']
  },

  // Firm/Organization Details
  firmDetails: {
    // ✅ NEW: Brand / Trade Name
    tradeName: { type: String, trim: true },

    // ✅ NEW: Entity Type
    entityType: {
      type: String,
      enum: ['proprietor', 'partnership', 'llp', 'pvt_ltd', 'agency']
    },

    registeredName: String,
    gstNumber: String,
    panNumber: String,
    registrationNumber: String,
    yearEstablished: Number,
    employeeCount: {
      type: String,
      enum: ['1-5', '6-20', '21-50', '51-100', '100+']
    },
    website: String,
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String
    }
  },

  // Syncro1 Competency (UPDATED as per doc)
  Syncro1Competency: {
    // ✅ RENAMED from industries
    primaryHiringSectors: [String],

    // ✅ RENAMED from experienceLevels
    hiringLevels: [{
      type: String,
      enum: ['Entry', 'Mid', 'Senior', 'Leadership']
    }],

    // ✅ NEW: Avg CTC Range Handled
    avgCtcRangeHandled: {
      type: String,
      enum: ['0-5 LPA', '5-20 LPA', '20-35 LPA', '35+ LPA']
    },

    // ✅ NEW: Average Monthly Closures
    averageMonthlyClosures: Number,

    // ✅ NEW: Years of Recruitment Experience
    yearsOfRecruitmentExperience: Number,

    // Existing / optional fields (still useful)
    functionalAreas: [String],
    topClients: [String],
    specializations: [String]
  },

  // Geographic Reach
  geographicReach: {
    operatingCities: [String],
    operatingStates: [String],
    panIndiaCapability: {
      type: Boolean,
      default: false
    },
    internationalReach: {
      type: Boolean,
      default: false
    },
    internationalCountries: [String]
  },

  // Compliance & Agreement
  compliance: {
    agreementSigned: {
      type: Boolean,
      default: false
    },
    agreementSignedAt: Date,
    agreementDocument: String,
    digitalSignature: String,
    termsAccepted: {
      type: Boolean,
      default: false
    },
    ndaSigned: {
      type: Boolean,
      default: false
    }
  },

  // Finance Details
  financeDetails: {
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    accountHolderName: String,
    panCard: String,
    gstCertificate: String,
    cancelledCheque: String
  },

  // ✅ NEW: Payout Preferences (Tax + Entity)
  payoutPreferences: {
    payoutEntityName: { type: String, trim: true },
    gstRegistration: {
      type: String,
      enum: ['regular', 'composition', 'unregister'],
      default: 'unregister'
    },
    tdsApplicable: {
      type: Boolean,
      default: true
    }
  },

  // Documents
 documents: {
  panCard: String,
  gstCertificate: String,
  incorporationCertificate: String,     // ✅ NEW
  cancelledCheque: String,
  authorizedSignatoryProof: String,     // ✅ NEW
  addressProof: String
},
  // Subscription
  subscription: {
    plan: {
      type: String,
      enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'],
      default: 'FREE'
    },
    startDate: Date,
    endDate: Date,
    isActive: {
      type: Boolean,
      default: true
    },
    autoRenew: {
      type: Boolean,
      default: false
    }
  },

  // Performance Metrics
  metrics: {
    totalSubmissions: {
      type: Number,
      default: 0
    },
    totalPlacements: {
      type: Number,
      default: 0
    },
    totalEarnings: {
      type: Number,
      default: 0
    },
    pendingPayouts: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    }
  },

  // Verification
  verificationStatus: {
    type: String,
    enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  verificationNotes: String,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  verifiedAt: Date,
  rejectionReason: String,

  // Profile Completion
  profileCompletion: {
    basicInfo: { type: Boolean, default: false },
    firmDetails: { type: Boolean, default: false },
    Syncro1Competency: { type: Boolean, default: false },
    geographicReach: { type: Boolean, default: false },
    compliance: { type: Boolean, default: false },
    financeDetails: { type: Boolean, default: false },

    // ✅ NEW (optional but included)
    payoutPreferences: { type: Boolean, default: false }
  },

  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual for full name
staffingPartnerSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Calculate profile completion percentage
staffingPartnerSchema.methods.getProfileCompletionPercentage = function() {
  const fields = Object.values(this.profileCompletion);
  const completed = fields.filter(Boolean).length;
  return Math.round((completed / fields.length) * 100);
};

module.exports = mongoose.model('StaffingPartner', staffingPartnerSchema);