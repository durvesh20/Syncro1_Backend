// backend/models/Company.js
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // Basic Info
  companyName: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true
  },
  decisionMakerName: {
    type: String,
    required: [true, 'Decision maker name is required']
  },
  designation: {
    type: String,
    required: [true, 'Designation is required']
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

  // Company KYC
  kyc: {
    registeredName: String,
    cin: String,
    gstNumber: String,
    panNumber: String,
    industry: String,
    companyType: {
      type: String,
      enum: ['Startup', 'SME', 'Enterprise', 'MNC', 'Government', 'NGO']
    },
    employeeCount: {
      type: String,
      enum: ['1-50', '51-200', '201-500', '501-1000', '1000+']
    },
    yearEstablished: Number,
    website: String,
    description: String,
    logo: String,
    address: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: {
        type: String,
        default: 'India'
      }
    }
  },

  // Hiring Preferences
  hiringPreferences: {
    preferredIndustries: [String],
    functionalAreas: [String],
    experienceLevels: [String],
    locations: [String],
    salaryRanges: [{
      min: Number,
      max: Number,
      currency: {
        type: String,
        default: 'INR'
      }
    }],
    hiringVolume: {
      type: String,
      enum: ['Low (1-5/month)', 'Medium (6-15/month)', 'High (16-30/month)', 'Very High (30+/month)']
    },
    urgencyLevel: {
      type: String,
      enum: ['Immediate', 'Within 30 days', 'Within 60 days', 'Ongoing']
    }
  },

  // Billing Setup
  billing: {
    billingName: String,
    billingEmail: String,
    billingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String
    },
    gstNumber: String,
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

  // Legal Consents
  legalConsents: {
    termsAccepted: {
      type: Boolean,
      default: false
    },
    termsAcceptedAt: Date,
    privacyPolicyAccepted: {
      type: Boolean,
      default: false
    },
    agreementSigned: {
      type: Boolean,
      default: false
    },
    agreementSignedAt: Date,
    agreementDocument: String
  },

  // Documents
  documents: {
    incorporationCertificate: String,
    gstCertificate: String,
    panCard: String,
    addressProof: String,
    authorizedSignatoryProof: String
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
    kyc: { type: Boolean, default: false },
    hiringPreferences: { type: Boolean, default: false },
    billing: { type: Boolean, default: false },
    legalConsents: { type: Boolean, default: false },
    documents: { type: Boolean, default: false }
  },

  // Metrics
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