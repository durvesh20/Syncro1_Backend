// backend/models/ScreeningQuestion.js
const mongoose = require('mongoose');

const screeningQuestionSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true,
    index: true
  },
  questionText: {
    type: String,
    required: [true, 'Question text is required'],
    trim: true,
    maxlength: [500, 'Question text cannot exceed 500 characters']
  },
  answerType: {
    type: String,
    enum: ['yes_no', 'numeric'],
    required: [true, 'Answer type is required']
  },
  // For yes_no: stored as "yes" or "no"
  // For numeric: stored as string representation of a number
  idealAnswer: {
    type: String,
    required: [true, 'Ideal answer is required']
  },
  isRequired: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

screeningQuestionSchema.index({ job: 1, order: 1 });

module.exports = mongoose.model('ScreeningQuestion', screeningQuestionSchema);
