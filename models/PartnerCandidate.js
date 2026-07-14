// Partner's personal candidate pool / CRM
// Completely decoupled from job submissions (Candidate model)
const mongoose = require('mongoose');

const partnerCandidateSchema = new mongoose.Schema({
  // Owner
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
    required: true,
    index: true
  },

  // ==================== IDENTITY ====================
  uniqueId: {
    type: String,
    unique: true,
    sparse: true,
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  middleName: {
    type: String,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  mobile: {
    type: String,
    required: [true, 'Mobile is required'],
    trim: true
  },

  // ==================== PROFESSIONAL ====================
  location: {
    type: String,
    required: [true, 'Location is required'],
    trim: true
  },
  willingToRelocate: {
    type: Boolean,
    required: [true, 'Willing to relocate is required']
  },
  totalExperience: {
    type: Number,
    required: [true, 'Total experience is required'],
    min: 0
  },
  relevantExperience: {
    type: Number,
    required: [true, 'Relevant experience is required'],
    min: 0
  },
  noticePeriod: {
    type: String,
    required: [true, 'Notice period is required'],
    enum: [
      'Immediate',
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
  currentSalary: {
    type: Number,
    required: [true, 'Current salary is required'],
    min: 0,
    set: function(val) {
      if (val == null || val === '') return val;
      const num = Number(val);
      if (isNaN(num)) return val;
      if (num >= 100000) return Number((num / 100000).toFixed(2));
      return val;
    }
  },
  expectedSalary: {
    type: Number,
    required: [true, 'Expected salary is required'],
    min: 0,
    set: function(val) {
      if (val == null || val === '') return val;
      const num = Number(val);
      if (isNaN(num)) return val;
      if (num >= 100000) return Number((num / 100000).toFixed(2));
      return val;
    }
  },
  writeup: {
    type: String,
    trim: true
  },

  // ==================== RESUME ====================
  resume: {
    url: String,
    fileName: String,
    uploadedAt: Date
  },

  // ==================== TAGS ====================
  tags: [String],

  // ==================== JOB TRACKING (read-only) ====================
  // Jobs this pool candidate has been submitted to — appended by applyFromPool
  submittedToJobs: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job'
  }]

}, {
  timestamps: true
});

// ==================== INDEXES ====================
// Unique email per partner pool
partnerCandidateSchema.index({ partner: 1, email: 1 }, { unique: true });
// Unique mobile per partner pool
partnerCandidateSchema.index({ partner: 1, mobile: 1 }, { unique: true });

// ==================== VIRTUAL ====================
partnerCandidateSchema.virtual('fullName').get(function () {
  const parts = [this.firstName];
  if (this.middleName) parts.push(this.middleName);
  parts.push(this.lastName);
  return parts.join(' ');
});

// ==================== PRE-SAVE HOOK ====================
partnerCandidateSchema.pre('save', function (next) {
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

module.exports = mongoose.model('PartnerCandidate', partnerCandidateSchema);
