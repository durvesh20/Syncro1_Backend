const mongoose = require('mongoose');

const companyLogoSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    default: ''
  },
  logoUrl: {
    type: String,
    trim: true,
    default: ''
  },
  iconName: {
    type: String,
    trim: true,
    default: ''
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

module.exports = mongoose.model('CompanyLogo', companyLogoSchema);
