// backend/models/Company.js
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // ==================== 1. Primary Account (Decision Maker) ====================
  decisionMakerName: {
    type: String,
    required: [true, 'Decision maker name is required']
  },
  designation: {
    type: String,
    required: [true, 'Designation is required']
  },
  // ✅ NEW
  department: {
    type: String,
    enum: ['HR', 'Talent Acquisition', 'Founder/CEO', 'Operations', 'Admin', 'Other'],
    required: true
  },
  linkedinProfile: String,
  city: {
    type: String,
    required: true
  },
  state: {
    type: String,
    required: true
  },

  // ==================== 2. Company Information (Core KYC Layer) ====================
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true
  },
  kyc: {
    registeredName: String,
    // ✅ NEW: Brand / Trade Name
    tradeName: {
      type: String,
      trim: true
    },
    cin: String,
    // ✅ NEW: LLPIN for LLP companies
    llpin: String,
    gstNumber: String,
    panNumber: String,
    industry: String,
    companyType: {
      type: String,
      enum: ['Private Limited', 'LLP', 'Public Limited', 'Startup', 'MNC', 'Partnership', 'Proprietorship', 'Other']
    },
    employeeCount: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '500+']
    },
    yearEstablished: Number,
    website: String,
    description: String,
    logo: String,
    
    // ✅ UPDATED: Separate Registered & Operating Addresses
    registeredAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: 'India'
      }
    },
    operatingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: 'India'
      },
      sameAsRegistered: {
        type: Boolean,
        default: true
      }
    }
  },

  // ==================== 3. Hiring & Business Profile ====================
  hiringPreferences: {
    preferredIndustries: [String],
    functionalAreas: [String],
    experienceLevels: [String],
    locations: [String],
    
    // ✅ NEW: Hiring Type
    hiringType: {
      type: String,
      enum: ['Permanent', 'Contract', 'Both'],
      default: 'Permanent'
    },
    
    // ✅ RENAMED: More specific
    avgMonthlyHiringVolume: {
      type: String,
      enum: ['1-5', '6-15', '16-30', '30+']
    },
    
    // ✅ NEW: Typical CTC Band (restructured)
    typicalCtcBand: {
      type: String,
      enum: ['0-5 LPA', '5-20 LPA', '20-35 LPA', '35+ LPA']
    },
    
    // ✅ NEW: Work Mode Preference
    workModePreference: {
      type: String,
      enum: ['Remote', 'Hybrid', 'Onsite', 'Flexible'],
      default: 'Hybrid'
    },
    
    // Existing fields
    salaryRanges: [{
      min: Number,
      max: Number,
      currency: {
        type: String,
        default: 'INR'
      }
    }],
    urgencyLevel: {
      type: String,
      enum: ['Immediate', 'Within 30 days', 'Within 60 days', 'Ongoing']
    }
  },

  // ==================== 5. Commercial & Billing Setup ====================
  billing: {
    billingEntityName: String,
    billingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String
    },
    
    // ✅ NEW: GST Registration Type
    gstRegistrationType: {
      type: String,
      enum: ['Regular', 'Composition', 'Unregistered'],
      default: 'Unregistered'
    },
    
    gstNumber: String,
    panNumber: String,
    
    // ✅ NEW: PO Required
    poRequired: {
      type: Boolean,
      default: false
    },
    
    // ✅ NEW: TDS Applicable
    tdsApplicable: {
      type: Boolean,
      default: true
    },
    
    paymentTerms: {
      type: String,
      enum: ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
      default: 'Net 30'
    },
    preferredPaymentMethod: {
      type: String,
      enum: ['Bank Transfer', 'Cheque', 'Online Payment'],
      default: 'Bank Transfer'
    }
  },

  // ==================== 7. Legal & Compliance ====================
  legalConsents: {
    termsAccepted: {
      type: Boolean,
      default: false
    },
    termsAcceptedAt: Date,
    termsAcceptedIp: String,
    
    privacyPolicyAccepted: {
      type: Boolean,
      default: false
    },
    privacyPolicyAcceptedAt: Date,
    privacyPolicyAcceptedIp: String,
    
    // ✅ NEW: Data Processing Agreement
    dataProcessingAgreementAccepted: {
      type: Boolean,
      default: false
    },
    dataProcessingAgreementAcceptedAt: Date,
    dataProcessingAgreementAcceptedIp: String,
    
    // ✅ NEW: Vendor Sharing Consent
    vendorSharingConsent: {
      type: Boolean,
      default: false
    },
    vendorSharingConsentAt: Date,
    vendorSharingConsentIp: String,
    
    // ✅ NEW: Communication Consent
    communicationConsent: {
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      sms: { type: Boolean, default: false }
    },
    communicationConsentAt: Date,
    communicationConsentIp: String,
    
    agreementSigned: {
      type: Boolean,
      default: false
    },
    agreementSignedAt: Date,
    agreementDocument: String
  },

  // ==================== 8. Documents (Post-Signup Verification) ====================
  documents: {
    gstCertificate: String,
    panCard: String,
    incorporationCertificate: String,
    authorizedSignatoryProof: String,
    addressProof: String
  },

  // ==================== Verification ====================
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

  // ==================== Profile Completion ====================
  profileCompletion: {
    basicInfo: { type: Boolean, default: false },
    kyc: { type: Boolean, default: false },
    hiringPreferences: { type: Boolean, default: false },
    billing: { type: Boolean, default: false },
    legalConsents: { type: Boolean, default: false },
    documents: { type: Boolean, default: false }
  },

  // ==================== Metrics ====================
  metrics: {
    totalJobsPosted: { type: Number, default: 0 },
    activeJobs: { type: Number, default: 0 },
    totalHires: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 }
  },

  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Company', companySchema);