const mongoose = require('mongoose');

const demoRequestSchema = new mongoose.Schema(
  {
    stakeholder: {
      type: String,
      enum: ['client', 'partner'],
      required: [true, 'Stakeholder type is required (client or partner)'],
      default: 'client'
    },
    name: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Work email address is required'],
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true
    },
    organization: {
      type: String,
      required: [true, 'Organization / Company / Firm name is required'],
      trim: true
    },
    partnerDomain: {
      type: String,
      trim: true,
      default: ''
    },
    partnerVolume: {
      type: String,
      trim: true,
      default: ''
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    },
    referenceCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['pending', 'contacted', 'scheduled', 'completed', 'cancelled'],
      default: 'pending'
    },
    ipAddress: {
      type: String,
      trim: true,
      default: ''
    },
    userAgent: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

demoRequestSchema.index({ email: 1 });
demoRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('DemoRequest', demoRequestSchema);
