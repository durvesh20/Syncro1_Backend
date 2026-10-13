// backend/models/PartnerPointEvent.js
const mongoose = require('mongoose');

const STAGES = {
  SCREENED: 'SCREENED',
  SUBMITTED_TO_COMPANY: 'SUBMITTED_TO_COMPANY',
  INTERVIEW_SCHEDULED: 'INTERVIEW_SCHEDULED',
  SELECTED: 'SELECTED',
  JOINED: 'JOINED',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT'
};

const STAGE_POINTS = {
  SCREENED: 2,
  SUBMITTED_TO_COMPANY: 5,
  INTERVIEW_SCHEDULED: 10,
  SELECTED: 20,
  JOINED: 40,
  MANUAL_ADJUSTMENT: 0
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

