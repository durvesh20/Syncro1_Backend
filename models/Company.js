// backend/models/Company.js
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // ✅ Added uniqueId field
  uniqueId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
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

  // ==================== 2. COMPANY INFORMATION ====================
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

  // ==================== 5. BILLING ====================
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

  // ==================== 6. TEAM ====================
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

  // ==================== 7. LEGAL ====================
  legalConsents: {
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: Date,
    termsAcceptedIp: String,
    privacyPolicyAccepted: { type: Boolean, default: false },
    privacyPolicyAcceptedAt: Date,
    privacyPolicyAcceptedIp: String,
    cookiePolicyAccepted: { type: Boolean, default: false },
    cookiePolicyAcceptedAt: Date,
    cookiePolicyAcceptedIp: String,
    dataStorageConsent: { type: Boolean, default: false },
    dataStorageConsentAt: Date,
    dataStorageConsentIp: String,
    vendorSharingConsent: { type: Boolean, default: false },
    vendorSharingConsentAt: Date,
    vendorSharingConsentIp: String,
    communicationConsent: {
      email: { type: Boolean, default: true },
      whatsapp: { type: Boolean, default: false },
      sms: { type: Boolean, default: false }
    },
    communicationConsentAt: Date,
    communicationConsentIp: String
  },

  // ==================== DOCUMENTS ====================
  documents: {
    gstCertificate: String,
    panCard: String,
    incorporationCertificate: String,
    authorizedSignatoryProof: String,
    addressProof: String,
    msme: String,
    udyamCertificate: String,
    cinNumber: String,
    otherCompanyDocument: String
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

// ✅ Pre-save hook for uniqueId
companySchema.pre('save', function (next) {
  if (!this.uniqueId) {
    const now = new Date();
    const year = now.getFullYear();
    const date = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');

    this.uniqueId = `CMP-${year}${date}${month}-${hours}${minutes}${seconds}-${random}`;
  }
  next();
});

module.exports = mongoose.model('Company', companySchema);