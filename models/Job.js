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

  // ✅ Added uniqueId field
  uniqueId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
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
    min: {
      type: Number,
      min: 0,
      set: function (val) {
        if (val == null || val === '') return val;
        const num = Number(val);
        if (isNaN(num)) return val;
        if (num >= 100000) return Number((num / 100000).toFixed(2));
        return num;
      }
    },
    max: {
      type: Number,
      min: 0,
      set: function (val) {
        if (val == null || val === '') return val;
        const num = Number(val);
        if (isNaN(num)) return val;
        if (num >= 100000) return Number((num / 100000).toFixed(2));
        return num;
      }
    },
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
    city: { type: [String], required: true },
    state: { type: String, default: 'N/A' },
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
  expectedJoiningDate: {
    type: mongoose.Schema.Types.Mixed,
    default: ['Any']
  },

  // ==================== JOB STATUS (UNIFIED) ====================
  // Single source of truth covering both lifecycle and approval workflow.
  // Values:
  //   Pre-approval:  DRAFT → PENDING_APPROVAL → APPROVED (auto → ACTIVE) | REJECTED
  //   Operational:   ACTIVE → PAUSED | ON_HOLD | FILLED | CLOSED
  //   Edit cycle:    ACTIVE → EDIT_REQUESTED → APPROVED (auto → ACTIVE)
  //   Admin force:   DISCONTINUED
  status: {
    type: String,
    enum: [
      'DRAFT',
      'PENDING_APPROVAL',
      'APPROVED',        // Transitional — auto-moves to ACTIVE after save
      'ACTIVE',
      'PAUSED',
      'ON_HOLD',
      'FILLED',
      'CLOSED',
      'REJECTED',
      'EDIT_REQUESTED',
      'DISCONTINUED'
    ],
    default: 'DRAFT'
  },

  // ==================== APPROVAL STATUS (DEPRECATED ALIAS) ====================
  // @deprecated — Kept for backward compatibility only. Auto-synced from `status`
  // via pre-save hook. Read `status` instead of this field in all new code.
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
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectionReason: String,
  rejectedAt: Date,
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // ==================== EDIT REQUEST TRACKING ====================
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

  // ==================== DISCONTINUATION ====================
  discontinuedReason: String,
  discontinuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  discontinuedAt: Date,

  // ==================== CHANGE HISTORY ====================
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
    joined: { type: Number, default: 0 },
    interestedPartners: { type: Number, default: 0 }
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
  },

  // Ordered list of rounds defined for this job position
  pipelineTemplate: [
    {
      roundType: {
        type: String,
        required: true
      },
      order: { type: Number, required: true } // 1-based
    }
  ]
}, {
  timestamps: true,
  validateModifiedOnly: true
});

// ==================== INDEXES ====================
jobSchema.index({ company: 1, status: 1 });
jobSchema.index({ status: 1, createdAt: -1 });
jobSchema.index({ company: 1, approvalStatus: 1 }); // @deprecated — kept for backward compat
jobSchema.index({ approvalStatus: 1, createdAt: -1 }); // @deprecated
jobSchema.index({ status: 1, eligiblePlans: 1 });
jobSchema.index({ category: 1, status: 1 });
jobSchema.index({ 'location.city': 1, status: 1 });
jobSchema.index({ company: 1, status: 1, createdAt: -1 });

// ==================== VIRTUAL FIELDS ====================
jobSchema.virtual('isPendingReview').get(function () {
  return this.status === 'PENDING_APPROVAL' || this.status === 'EDIT_REQUESTED';
});

jobSchema.virtual('canBeEdited').get(function () {
  return ['DRAFT', 'REJECTED'].includes(this.status);
});

jobSchema.virtual('requiresApproval').get(function () {
  return this.status === 'EDIT_REQUESTED';
});

// ==================== MIDDLEWARE ====================

// Auto-sync deprecated `approvalStatus` field from `status` for backward compat.
// New code should always read/write `status` only.
jobSchema.pre('save', function (next) {
  const approvalLinkedStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ACTIVE', 'EDIT_REQUESTED', 'DISCONTINUED'];
  if (approvalLinkedStatuses.includes(this.status)) {
    this.approvalStatus = this.status;
  } else {
    // Operational statuses (PAUSED, ON_HOLD, FILLED, CLOSED) — keep approvalStatus as ACTIVE
    // since the job was approved before reaching these states
    if (!approvalLinkedStatuses.includes(this.approvalStatus)) {
      this.approvalStatus = 'ACTIVE';
    }
  }
  next();
});

// Deadline-based auto ON_HOLD logic
jobSchema.pre('save', function (next) {
  const now = new Date();
  if (!this.isModified('status')) {
    if (this.status === 'ACTIVE' && this.applicationDeadline && this.applicationDeadline < now) {
      this.status = 'ON_HOLD';
    } else if (this.status === 'ON_HOLD' && this.applicationDeadline && this.applicationDeadline > now) {
      this.status = 'ACTIVE';
    }
  }
  next();
});


jobSchema.pre('save', async function (next) {
  // Auto-generate slug
  if (this.isModified('title') && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') + '-' + Date.now();
  }

  // Auto-generate uniqueId
  if (!this.uniqueId) {
    try {
      const companyDoc = await mongoose.model('Company').findById(this.company);
      const name = companyDoc?.companyName || 'JOB';
      const prefix = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 3).padEnd(3, 'x');

      const jobs = await mongoose.model('Job').find({ company: this.company });
      let maxNum = 0;
      const prefixPattern = new RegExp(`^${prefix}(\\d+)$`, 'i');

      jobs.forEach(j => {
        if (j.uniqueId) {
          const match = j.uniqueId.match(prefixPattern);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNum) {
              maxNum = num;
            }
          }
        }
      });

      const nextNum = maxNum + 1;
      const formattedNum = String(nextNum).padStart(3, '0');
      this.uniqueId = `${prefix}${formattedNum}`;
    } catch (error) {
      console.error('Error generating uniqueId for Job:', error);
      const random = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
      this.uniqueId = `job${Date.now()}${random}`;
    }
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

jobSchema.pre('save', function (next) {
  // Only calculate eligible plans automatically if they are not already set/provided
  if (!this.eligiblePlans || this.eligiblePlans.length === 0) {
    const salaryVal = (this.salary && (this.salary.min || this.salary.max)) || 0;
    let salary = Number(salaryVal) || 0;
    if (salary <= 100) {
      salary = salary * 100000;
    }

    const plans = [];
    if (salary <= 500000) plans.push('FREE');
    if (salary <= 2000000) plans.push('GROWTH');
    if (salary <= 3500000) plans.push('PROFESSIONAL');
    plans.push('PREMIUM');

    this.eligiblePlans = plans;
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

jobSchema.methods.applyEditChanges = function (appliedChanges) {
  Object.keys(appliedChanges).forEach(field => {
    const keys = field.split('.');
    let obj = this;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    const val = appliedChanges[field];
    const valueToSet = (val && typeof val === 'object' && 'new' in val) ? val.new : val;
    obj[keys[keys.length - 1]] = valueToSet;
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