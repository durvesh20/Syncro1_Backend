// backend/models/Job.js - FIXED VERSION
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

  // ==================== BASIC JOB INFO ====================
  title: {
    type: String,
    required: [true, 'Job title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  slug: {
    type: String,
    unique: true
  },
  description: {
    type: String,
    required: [true, 'Job description is required'],
    minlength: [50, 'Description must be at least 50 characters']
  },
  requirements: [String],
  responsibilities: [String],

  // ==================== JOB DETAILS ====================
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
    min: { type: Number, required: true, min: 0 },
    max: { type: Number, required: true, min: 0 }
  },

  // ==================== COMPENSATION ====================
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

  commission: {
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      default: 'percentage'
    },
    value: {
      type: Number,
      default: 0
    },
    paymentTerms: String
  },

  // ==================== LOCATION ====================
  location: {
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, default: 'India' },
    isRemote: { type: Boolean, default: false },
    isHybrid: { type: Boolean, default: false },
    isOnSite: { type: Boolean, default: false }
  },

  // ==================== SKILLS & EDUCATION ====================
  skills: {
    required: [String],
    preferred: [String]
  },
  education: {
    minimum: String,
    preferred: [String]
  },

  // ==================== VACANCIES ====================
  vacancies: {
    type: Number,
    default: 1,
    min: 1
  },
  filledPositions: {
    type: Number,
    default: 0,
    min: 0
  },

  // ==================== DATES ====================
  applicationDeadline: Date,
  expectedJoiningDate: Date,

  // ==================== JOB STATUS (for partner visibility) ====================
  status: {
    type: String,
    enum: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'CLOSED', 'FILLED'],
    default: 'DRAFT'
  },

  // ==================== APPROVAL WORKFLOW (NEW) ====================
  approvalStatus: {
    type: String,
    enum: [
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',
      'REJECTED',
      'ACTIVE',
      'EDIT_REQUESTED',
      'DISCONTINUED'
    ],
    default: 'DRAFT'
  },

  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  rejectionReason: String,
  rejectedAt: Date,

  // ==================== EDIT REQUEST TRACKING (NEW) ====================
  editRequestCount: {
    type: Number,
    default: 0
  },
  approvedEditCount: {
    type: Number,
    default: 0
  },
  rejectedEditCount: {
    type: Number,
    default: 0
  },
  lastEditRequestAt: Date,

  // ==================== DISCONTINUATION (NEW) ====================
  discontinuedReason: String,
  discontinuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  discontinuedAt: Date,

  // ==================== CHANGE HISTORY (NEW - AUDIT TRAIL) ====================
  changeHistory: [{
    changedAt: {
      type: Date,
      default: Date.now
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    changeType: {
      type: String,
      enum: [
        'CREATED',
        'UPDATED',
        'SUBMITTED',
        'APPROVED',
        'REJECTED',
        'EDITED',
        'EDIT_REQUESTED',
        'EDIT_APPROVED',
        'EDIT_REJECTED',
        'DISCONTINUED',
        'PAUSED',
        'RESUMED',
        'CLOSED'
      ]
    },
    changes: mongoose.Schema.Types.Mixed,
    notes: String
  }],

  // ==================== VISIBILITY ====================
  visibility: {
    type: String,
    enum: ['PUBLIC', 'INVITED_ONLY', 'PREMIUM_ONLY'],
    default: 'PUBLIC'
  },
  eligiblePlans: [{
    type: String,
    enum: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM']
  }],

  // ==================== METRICS ====================
  metrics: {
    views: { type: Number, default: 0 },
    applications: { type: Number, default: 0 },
    shortlisted: { type: Number, default: 0 },
    interviewed: { type: Number, default: 0 },
    offered: { type: Number, default: 0 },
    joined: { type: Number, default: 0 }
  },

  // ==================== MISC ====================
  shareableLink: String,
  tags: [String],
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

// ==================== INDEXES ====================
jobSchema.index({ company: 1, approvalStatus: 1 });
jobSchema.index({ approvalStatus: 1, createdAt: -1 });
jobSchema.index({ status: 1, eligiblePlans: 1 });
// jobSchema.index({ slug: 1 });
jobSchema.index({ category: 1, status: 1 });
jobSchema.index({ 'location.city': 1, status: 1 });
// ✅ FIX #8: Added missing index
jobSchema.index({ company: 1, status: 1, createdAt: -1 });

// ==================== VIRTUAL FIELDS ====================
jobSchema.virtual('isPendingReview').get(function () {
  return this.approvalStatus === 'PENDING_APPROVAL' || this.approvalStatus === 'EDIT_REQUESTED';
});

jobSchema.virtual('canBeEdited').get(function () {
  return ['DRAFT', 'REJECTED'].includes(this.approvalStatus);
});

jobSchema.virtual('requiresApproval').get(function () {
  return this.approvalStatus === 'EDIT_REQUESTED';
});

// ==================== MIDDLEWARE ====================

jobSchema.pre('save', function (next) {
  // Auto-generate slug
  if (this.isModified('title') && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + Date.now();
  }

  // Auto-generate uniqueId: YYYY-DD-MM-HHmmss-random
  if (!this.uniqueId) {
    const now = new Date();
    const year = now.getFullYear();
    const date = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    this.uniqueId = `JOB-${year}${date}${month}-${hours}${minutes}${seconds}-${random}`;
  }

  next();
});

jobSchema.pre('save', function (next) {
  if (!this.shareableLink && this.slug) {
    this.shareableLink = `${process.env.FRONTEND_URL}/jobs/${this.slug}`;
  }
  next();
});

jobSchema.pre('save', function (next) {
  if (this.experienceRange && this.experienceRange.min > this.experienceRange.max) {
    next(new Error('Experience range min cannot be greater than max'));
  }
  next();
});

jobSchema.pre('save', function (next) {
  if (this.salary && this.salary.min && this.salary.max && this.salary.min > this.salary.max) {
    next(new Error('Salary min cannot be greater than max'));
  }
  next();
});

// ==================== METHODS ====================

jobSchema.methods.addToHistory = function (changeType, changedBy, changes = {}, notes = '') {
  this.changeHistory.push({
    changedAt: new Date(),
    changedBy,
    changeType,
    changes,
    notes
  });
};

// ✅ FIX #1: Proper markModified with actual field names
jobSchema.methods.applyEditChanges = function (appliedChanges) {
  Object.keys(appliedChanges).forEach(field => {
    const keys = field.split('.');
    let obj = this;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = appliedChanges[field];
    this.markModified(field);
  });
};

jobSchema.methods.canAcceptEditRequest = function () {
  if (this.approvalStatus !== 'ACTIVE') return false;
  if (this.rejectedEditCount >= 5) return false;

  const JobEditRequest = mongoose.model('JobEditRequest');
  return JobEditRequest.countDocuments({
    job: this._id,
    status: 'PENDING'
  }).then(count => count === 0);
};

jobSchema.methods.getEditStats = function () {
  return {
    total: this.editRequestCount,
    approved: this.approvedEditCount,
    rejected: this.rejectedEditCount,
    pending: this.editRequestCount - this.approvedEditCount - this.rejectedEditCount,
    rejectionRate: this.editRequestCount > 0
      ? Math.round((this.rejectedEditCount / this.editRequestCount) * 100)
      : 0
  };
};

module.exports = mongoose.model('Job', jobSchema);