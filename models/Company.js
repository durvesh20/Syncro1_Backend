// backend/models/Company.js
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // ==================== 1. PRIMARY ACCOUNT (Decision Maker) ====================
  decisionMakerName: {
    type: String,
    required: [true, 'Decision maker name is required']
  },
  designation: {
    type: String,
    required: [true, 'Designation is required']
  },
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

  // ==================== 2. COMPANY INFORMATION (Core KYC Layer) ====================
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true
  },
  kyc: {
    registeredName: String,
    tradeName: String,
    logo: String,
    description: String,
    website: String,
    companyType: {
      type: String,
      enum: ['Private Limited', 'LLP', 'Public Limited', 'Startup', 'MNC', 'Partnership', 'Proprietorship', 'Other']
    },
    yearEstablished: Number,
    cinNumber: String,
    llpinNumber: String,
    registeredAddress: {
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
    gstNumber: String,
    panNumber: String,
    industry: String,
    employeeCount: {
      type: String,
      enum: ['1-10', '11-50', '51-200', '201-500', '500+']
    }
  },

  // ==================== 3. HIRING & BUSINESS PROFILE ====================
  hiringPreferences: {
    preferredIndustries: [String],
    functionalAreas: [String],
    experienceLevels: [String],
    hiringType: {
      type: String,
      enum: ['Permanent', 'Contract', 'Both'],
      default: 'Permanent'
    },
    avgMonthlyHiringVolume: {
      type: String,
      enum: ['1-5', '6-15', '16-30', '30+']
    },
    typicalCtcBand: {
      type: String,
      enum: ['0-5 LPA', '5-20 LPA', '20-35 LPA', '35+ LPA']
    },
    preferredLocations: [String],
    workModePreference: {
      type: String,
      enum: ['Remote', 'Hybrid', 'Onsite', 'Flexible'],
      default: 'Hybrid'
    },
    urgencyLevel: {
      type: String,
      enum: ['Immediate', 'Within 30 days', 'Within 60 days', 'Ongoing']
    }
  },

  // ==================== 5. COMMERCIAL & BILLING SETUP ====================
  billing: {
    billingEntityName: String,
    billingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String
    },
    gstRegistrationType: {
      type: String,
      enum: ['Regular', 'Composition', 'Unregistered'],
      default: 'Unregistered'
    },
    gstNumber: String,
    panNumber: String,
    poRequired: { type: Boolean, default: false },
    tdsApplicable: { type: Boolean, default: true },
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

  // ==================== 6. USER ROLES & ACCESS CONTROL ====================
  teamAccess: {
    isTeamEnabled: { type: Boolean, default: false },
    teamMembers: [{
      name: String,
      email: String,
      mobile: String,
      role: {
        type: String,
        enum: ['Primary Admin', 'Hiring Manager', 'Recruiter', 'Finance', 'Viewer'],
        default: 'Recruiter'
      },
      addedAt: { type: Date, default: Date.now },
      isActive: { type: Boolean, default: true }
    }]
  },

  // ==================== 7. LEGAL & COMPLIANCE ====================
  legalConsents: {
    // Terms of Service
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: Date,
    termsAcceptedIp: String,

    // Privacy Policy
    privacyPolicyAccepted: { type: Boolean, default: false },
    privacyPolicyAcceptedAt: Date,
    privacyPolicyAcceptedIp: String,

    // Data Processing Agreement
    dataProcessingAgreementAccepted: { type: Boolean, default: false },
    dataProcessingAgreementAcceptedAt: Date,
    dataProcessingAgreementAcceptedIp: String,

    // Data Storage Consent
    dataStorageConsent: { type: Boolean, default: false },
    dataStorageConsentAt: Date,
    dataStorageConsentIp: String,

    // Vendor Sharing Consent
    vendorSharingConsent: { type: Boolean, default: false },
    vendorSharingConsentAt: Date,
    vendorSharingConsentIp: String,

    // Communication Consent
    communicationConsent: {
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      sms: { type: Boolean, default: false }
    },
    communicationConsentAt: Date,
    communicationConsentIp: String
  },

  // ==================== 8. DOCUMENTS (Post-Signup) ====================
  documents: {
    gstCertificate: String,
    panCard: String,
    incorporationCertificate: String,
    authorizedSignatoryProof: String,
    addressProof: String
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

  // ==================== PROFILE COMPLETION ====================
  profileCompletion: {
    basicInfo: { type: Boolean, default: false },
    kyc: { type: Boolean, default: false },
    hiringPreferences: { type: Boolean, default: false },
    billing: { type: Boolean, default: false },
    legalConsents: { type: Boolean, default: false },
    documents: { type: Boolean, default: false }
  },

  // ==================== METRICS ====================
  metrics: {
    totalJobsPosted: { type: Number, default: 0 },
    activeJobs: { type: Number, default: 0 },
    totalHires: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 }
  },

  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('Company', companySchema);