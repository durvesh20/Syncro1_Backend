// backend/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
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
  role: {
    type: String,
    enum: ['staffing_partner', 'company', 'admin', 'candidate'],
    required: true
  },
  status: {
    type: String,
    enum: [
      'REGISTERED',
      'PASSWORD_CHANGED',
      'PROFILE_INCOMPLETE',
      'PROFILE_SUBMITTED',
      'UNDER_VERIFICATION',
      'VERIFIED',
      'ACTIVE',
      'SUSPENDED',
      'REJECTED'
    ],
    default: 'REGISTERED'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  mobileVerified: {
    type: Boolean,
    default: false
  },
  isPasswordChanged: {
    type: Boolean,
    default: false
  },
  emailOTP: {
    code: String,
    expiresAt: Date
  },
  mobileOTP: {
    code: String,
    expiresAt: Date
  },
  tempPassword: {
    type: String,
    select: false
  },
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
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate OTP
userSchema.methods.generateOTP = function(type) {
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
userSchema.methods.verifyOTP = function(type, code) {
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