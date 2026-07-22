// models/JobPosition.js
// TASK-001: Layer 1 — Job Position Parser schema
const mongoose = require('mongoose');

const skillTierSchema = new mongoose.Schema({
  mustHave:   [String],
  shouldHave: [String],
  niceToHave: [String]
}, { _id: false });

const jobPositionSchema = new mongoose.Schema({
  // Link to existing Job document
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true, unique: true },

  // HR-filled fields (mirrored from Job for scoring context)
  title:           { type: String, required: true },
  category:        { type: String, required: true },
  subCategory:     { type: String },
  rawJDText:       { type: String },
  salaryBudgetMin: Number,
  salaryBudgetMax: Number,
  location:        String,
  remoteAllowed:   { type: Boolean, default: false },
  postedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Claude-parsed fields (Layer 1)
  parsedRequirements: {
    skills:              skillTierSchema,
    domainKeywords:      [String],
    detectedDomain:      String,
    minExperienceYears:  Number,
    maxExperienceYears:  Number,
    minEducation:        String,   // e.g. "Bachelor's", "Master's", "10th Pass"
    noticePeriodMaxDays: Number,
    workType:            String,   // FULLTIME / PARTTIME / CONTRACT / INTERNSHIP
    salaryBudgetMin:     Number,
    salaryBudgetMax:     Number,
    location:            String,
    remoteAllowed:       Boolean,
    parsedAt:            Date
  },



  parseStatus: {
    type:    String,
    enum:    ['PENDING', 'SUCCESS', 'FAILED'],
    default: 'PENDING'
  },
  parseError: String,
  isActive:   { type: Boolean, default: true },
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now }
});

jobPositionSchema.index({ 'parsedRequirements.detectedDomain': 1 });

module.exports = mongoose.model('JobPosition', jobPositionSchema);
