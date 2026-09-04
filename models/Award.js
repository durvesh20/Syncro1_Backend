const mongoose = require('mongoose');

const awardSchema = new mongoose.Schema({
  year: {
    type: String,
    required: [true, 'Award year is required'],
    trim: true
  },
  title: {
    type: String,
    required: [true, 'Award title is required'],
    trim: true
  },
  org: {
    type: String,
    required: [true, 'Awarding organization is required'],
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Award', awardSchema);
