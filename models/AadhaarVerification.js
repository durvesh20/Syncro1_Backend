// backend/models/AadhaarVerification.js
//
// Stores the outcome of a UIDAI Pehchaan (Aadhaar App) identity verification.
//
// SECURITY: this collection must NEVER hold the full 12-digit Aadhaar number,
// the raw SD-JWT credential, or any OTP. Only the masked number (last 4 digits)
// and the KYC claims we are permitted to retain are persisted. See
// services/pehchaanService.js for where that filtering happens.

const mongoose = require('mongoose');

const aadhaarVerificationSchema = new mongoose.Schema(
  {
    // ==================== LINKAGE ====================
    partner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StaffingPartner',
      index: true
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    entityType: {
      type: String,
      enum: ['freelancer', 'talent_partner'],
      default: 'freelancer'
    },

    // ==================== TRANSACTION ====================
    // txnId is the UIDAI-facing transaction id. Unique so a replayed callback
    // cannot create a second record.
    txnId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    // jti of the signed request JWT - validated on callback to reject replays.
    jti: {
      type: String,
      index: true
    },
    // Invocation method used (spec §3.1.3 `ch`). The signed request embeds this
    // and it must match how the Aadhaar App was launched.
    channel: {
      type: String,
      enum: ['web', 'qr', 'app'],
      default: 'web'
    },

    status: {
      type: String,
      enum: ['pending', 'verified', 'failed', 'expired'],
      default: 'pending',
      index: true
    },

    // ==================== VERIFIED KYC DATA ====================
    // Masked only - e.g. "XXXX XXXX 1234".
    maskedAadhaar: String,
    fullName: String,
    dob: String, // yyyy-mm-dd as returned by UIDAI
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', null],
      default: null
    },
    phone: String,
    address: {
      line1: String,
      line2: String,
      city: String,
      district: String,
      state: String,
      pincode: String,
      full: String
    },
    photoUrl: String,

    // ==================== AUDIT ====================
    provider: {
      type: String,
      default: 'uidai-pehchaan'
    },
    // Claims minus the photo, retained for audit. Never contains the raw
    // credential or the full Aadhaar number.
    rawClaims: mongoose.Schema.Types.Mixed,

    failureCode: String,   // UIDAI error code (301-308) when status === 'failed'
    failureReason: String,

    requestedAt: { type: Date, default: Date.now },
    verifiedAt: Date,
    // TTL anchor: pending rows self-delete so abandoned attempts do not pile up.
    // The index is declared once below via schema.index() with expireAfterSeconds;
    // adding `index: true` here as well would create a duplicate.
    expiresAt: Date,

    initiatedIp: String,
    callbackIp: String
  },
  { timestamps: true }
);

// Auto-remove abandoned/expired attempts once past expiresAt. Verified rows set
// expiresAt to undefined so they are retained indefinitely for audit.
aadhaarVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.AadhaarVerification ||
  mongoose.model('AadhaarVerification', aadhaarVerificationSchema);
  