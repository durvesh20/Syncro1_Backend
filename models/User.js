// backend/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    trim: true,
    default: ''
  },
  lastName: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
  },
  mobile: {
    type: String,
    required: [true, 'Mobile number is required'],
    unique: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 8,
    select: false
  },

  otpAttempts: {
    email: { type: Number, default: 0 },
    mobile: { type: Number, default: 0 },
    lastAttempt: Date
  },

  role: {
    type: String,
    enum: ['talent_partner', 'talent', 'company', 'admin', 'sub_admin', 'super_admin'],
    required: true
  },

  status: {
    type: String,
    enum: [
      'PENDING_EMAIL_VERIFICATION',
      'PENDING_MOBILE_VERIFICATION',
      'REGISTERED',
      'TEMP_PASS_SENT',
      'PASS_CHANGED',
      'PASSWORD_CHANGED',
      'ONBOARDING_UNDERPROGRESS',
      'PROFILE_INCOMPLETE',
      'PROFILE_SUBMITTED',
      'UNDER_VERIFICATION',
      'VERIFIED',
      'ACTIVE',
      'SUSPENDED',
      'REJECTED'
    ],
    default: 'PENDING_EMAIL_VERIFICATION'
  },

  // Admin/Sub-admin permissions
  permissions: [{
    type: String,
    trim: true
  }],

  // Lead validity status (for Talent Partner and Client/Company leads - no default selection)
  leadValidity: {
    type: String,
    enum: ['VALID', 'INVALID', null],
    default: null
  },
  leadValidityUpdatedAt: Date,
  leadValidityUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  tempPasswordSentAt: Date,
  tempPasswordSentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Who created this user (mainly useful for sub-admin creation audit)
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Optional suspension tracking
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  suspendedAt: Date,

  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerifiedAt: Date,
  mobileVerified: {
    type: Boolean,
    default: false
  },
  mobileVerifiedAt: Date,
  isPasswordChanged: {
    type: Boolean,
    default: false
  },
  passwordChangedAt: Date,

  emailOTP: {
    code: String,
    expiresAt: Date
  },
  mobileOTP: {
    code: String,
    expiresAt: Date
  },

  emailVerificationToken: String,
  emailVerificationExpires: Date,

  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLogin: Date,

  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },

  // Sub-admin activity tracking logs
  subAdminActivityLogs: [{
    action: {
      type: String,
      enum: ['CREATED', 'UPDATED', 'STATUS_CHANGED'],
      required: true
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: {
      previousPermissions: [String],
      newPermissions: [String],
      previousStatus: String,
      newStatus: String,
      changedFields: mongoose.Schema.Types.Mixed
    }
  }]
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  // Prevent double hashing if password is already a bcrypt hash
  if (typeof this.password === 'string' && /^\$2[abxy]\$\d+\$/.test(this.password)) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (enteredPassword) {
  if (!enteredPassword || !this.password) return false;
  try {
    return await bcrypt.compare(enteredPassword, this.password);
  } catch (err) {
    return false;
  }
};

// Generate OTP
userSchema.methods.generateOTP = function (type) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  if (type === 'email') {
    this.emailOTP = { code: otp, expiresAt };
  } else if (type === 'mobile') {
    this.mobileOTP = { code: otp, expiresAt };
  }

  return otp;
};

// Verify OTP
userSchema.methods.verifyOTP = function (type, code) {
  const otpData = type === 'email' ? this.emailOTP : this.mobileOTP;

  if (!otpData || !otpData.code) {
    return { valid: false, message: 'OTP not found' };
  }

  if (new Date() > otpData.expiresAt) {
    return { valid: false, message: 'OTP expired' };
  }

  if (otpData.code !== code) {
    return { valid: false, message: 'Invalid OTP' };
  }

  return { valid: true };
};

module.exports = mongoose.model('User', userSchema);