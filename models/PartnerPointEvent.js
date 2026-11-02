// backend/models/PartnerPointEvent.js
const mongoose = require('mongoose');

const STAGES = {
  S1_REVIEW: 'S1_REVIEW',
  S1_SCREEN_SELECT: 'S1_SCREEN_SELECT',
  CLIENT_SCREEN_SELECT: 'CLIENT_SCREEN_SELECT',
  ROUND_2_SELECTION: 'ROUND_2_SELECTION',
  OFFERED: 'OFFERED',
  JOINED: 'JOINED',
  RETENTION_90_DAYS: 'RETENTION_90_DAYS',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',

  // Backward compatibility aliases for existing DB records
  SCREENED: 'SCREENED',
  SUBMITTED_TO_COMPANY: 'SUBMITTED_TO_COMPANY',
  INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED',
  SELECTED: 'SELECTED'
};

const STAGE_POINTS = {
  S1_REVIEW: 10,
  S1_SCREEN_SELECT: 10,
  CLIENT_SCREEN_SELECT: 10,
  ROUND_2_SELECTION: 10,
  OFFERED: 20,
  JOINED: 20,
  RETENTION_90_DAYS: 20,
  MANUAL_ADJUSTMENT: 0,

  // Backward compatibility points
  SCREENED: 10,
  SUBMITTED_TO_COMPANY: 10,
  INTERVIEW_SCHEDULED: 10,
  SELECTED: 20
};

const partnerPointEventSchema = new mongoose.Schema({
  partner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'StaffingPartner',
    required: true,
    index: true
  },
  candidate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: false,
    index: true
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: false,
    index: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: false
  },
  tournament: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PartnerTournament',
    default: null,
    index: true
  },
  stage: {
    type: String,
    enum: Object.values(STAGES),
    required: true
  },
  points: {
    type: Number,
    required: true
  },
  metadata: {
    candidateName: String,
    candidateEmail: String,
    jobTitle: String,
    companyName: String,
    notes: String,
    adjustedBy: String,
    targetRank: Number
  },
  awardedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Guarantee idempotency: a partner can only be awarded points once per candidate per milestone stage per tournament
partnerPointEventSchema.index(
  { tournament: 1, partner: 1, candidate: 1, stage: 1 },
  { unique: true, partialFilterExpression: { candidate: { $exists: true, $type: 'objectId' } } }
);

// For manual adjustments, ensure at most one manual adjustment record per partner per tournament
partnerPointEventSchema.index(
  { tournament: 1, partner: 1, stage: 1 },
  { unique: true, partialFilterExpression: { stage: 'MANUAL_ADJUSTMENT' } }
);

module.exports = {
  PartnerPointEvent: mongoose.model('PartnerPointEvent', partnerPointEventSchema),
  STAGES,
  STAGE_POINTS
};

