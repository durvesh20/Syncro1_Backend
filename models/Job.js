// backend/models/Job.js
const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  postedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Basic Job Info
  title: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true
  },
  slug: {
    type: String,
    unique: true
  },
  description: {
    type: String,
    required: [true, 'Job description is required']
  },
  requirements: [String],
  responsibilities: [String],
  
  // Job Details
  category: {
    type: String,
    required: true
  },
  subCategory: String,
  employmentType: {
    type: String,
    enum: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'],
    required: true
  },
  experienceLevel: {
    type: String,
    enum: ['Entry', 'Mid', 'Senior', 'Executive', 'C-Suite'],
    required: true
  },
  experienceRange: {
    min: { type: Number, required: true },
    max: { type: Number, required: true }
  },

  // Compensation
  salary: {
    min: Number,
    max: Number,
    currency: {
      type: String,
      default: 'INR'
    },
    isNegotiable: {
      type: Boolean,
      default: false
    },
    isConfidential: {
      type: Boolean,
      default: false
    }
  },
  
  // Commission for Staffing Partners
  commission: {
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    value: {
      type: Number,
      required: true
    },
    paymentTerms: String
  },

  // Location
  location: {
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, default: 'India' },
    isRemote: { type: Boolean, default: false },
    isHybrid: { type: Boolean, default: false }
  },

  // Skills
  skills: {
    required: [String],
    preferred: [String]
  },

  // Education
  education: {
    minimum: String,
    preferred: [String]
  },

  // Vacancies
  vacancies: {
    type: Number,
    default: 1
  },
  filledPositions: {
    type: Number,
    default: 0
  },

  // Dates
  applicationDeadline: Date,
  expectedJoiningDate: Date,

  // Status
  status: {
    type: String,
    enum: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'CLOSED', 'FILLED'],
    default: 'DRAFT'
  },

  // Visibility
  visibility: {
    type: String,
    enum: ['PUBLIC', 'INVITED_ONLY', 'PREMIUM_ONLY'],
    default: 'PUBLIC'
  },
  eligiblePlans: [{
    type: String,
    enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM']
  }],

  // Metrics
  metrics: {
    views: { type: Number, default: 0 },
    applications: { type: Number, default: 0 },
    shortlisted: { type: Number, default: 0 },
    interviewed: { type: Number, default: 0 },
    offered: { type: Number, default: 0 },
    joined: { type: Number, default: 0 }
  },

  // Shareable Link
  shareableLink: String,

  // Tags
  tags: [String],

  // Featured
  isFeatured: {
    type: Boolean,
    default: false
  },
  isUrgent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Generate slug before saving
jobSchema.pre('save', function(next) {
  if (this.isModified('title')) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + Date.now();
  }
  next();
});

// Generate shareable link
jobSchema.pre('save', function(next) {
  if (!this.shareableLink) {
    this.shareableLink = `${process.env.FRONTEND_URL}/jobs/${this.slug}`;
  }
  next();
});

module.exports = mongoose.model('Job', jobSchema);