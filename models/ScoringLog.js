// models/ScoringLog.js
// TASK-011: Layer All — Logging System to capture LLM inputs/outputs for auditing
const mongoose = require('mongoose');

const scoringLogSchema = new mongoose.Schema({
  logType: {
    type: String,
    enum: ['RESUME_PARSE', 'JD_PARSE', 'MARKET_INTEL', 'SCORING', 'MARKET_GAP'],
    required: true
  },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' }, // Candidates represent job applications in Syncro1
  resumeId:      { type: mongoose.Schema.Types.ObjectId }, // Can refer to Candidate's resume or stand-alone resume if any
  positionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosition' },
  promptSent:    { type: String, required: true },  // exact prompt sent to OpenAI
  rawResponse:   String,                            // exact response from OpenAI
  parsedScore:   Number,                            // finalAdjustedScore if scoring
  confidence:    Number,                            // confidence if parsing
  attempts:      { type: Number, default: 1 },
  success:       { type: Boolean, required: true },
  error:         String,
  createdAt:     { type: Date, default: Date.now }
});

// Index for quick lookup
scoringLogSchema.index({ applicationId: 1 });
scoringLogSchema.index({ positionId: 1 });
scoringLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ScoringLog', scoringLogSchema);
