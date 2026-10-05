// backend/models/PartnerTournament.js
const mongoose = require('mongoose');

const partnerTournamentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    default: 'Syncro1 Vendor Performance & Delivery Challenge 🏆'
  },
  description: {
    type: String,
    trim: true,
    default: 'Quality + Speed + Consistency = Higher Score & Recognition 🏆'
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['UPCOMING', 'ACTIVE', 'COMPLETED', 'PAUSED'],
    default: 'ACTIVE'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rules: {
    screenedPoints: { type: Number, default: 2 },
    submittedPoints: { type: Number, default: 5 },
    interviewPoints: { type: Number, default: 10 },
    selectedPoints: { type: Number, default: 20 },
    joinedPoints: { type: Number, default: 40 }
  }
}, {
  timestamps: true
});

// Helper virtual to compute live status based on dates
partnerTournamentSchema.virtual('liveStatus').get(function () {
  if (!this.isActive) return 'PAUSED';
  const now = new Date();
  if (now < this.startDate) return 'UPCOMING';
  if (now > this.endDate) return 'COMPLETED';
  return 'ACTIVE';
});

partnerTournamentSchema.set('toJSON', { virtuals: true });
partnerTournamentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('PartnerTournament', partnerTournamentSchema);

