const mongoose = require('mongoose');

const landingPageLeadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email address is required'],
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    trim: true,
    default: ''
  },
  company: {
    type: String,
    trim: true,
    default: ''
  },
  firmName: {
    type: String,
    trim: true,
    default: ''
  },
  department: {
    type: String,
    trim: true,
    default: ''
  },
  designation: {
    type: String,
    trim: true,
    default: ''
  },
  state: {
    type: String,
    trim: true,
    default: ''
  },
  city: {
    type: String,
    trim: true,
    default: ''
  },
  linkedinProfile: {
    type: String,
    trim: true,
    default: ''
  },
  message: {
    type: String,
    trim: true,
    default: ''
  },
  formType: {
    type: String,
    enum: ['company', 'talent-partner'],
    default: 'company'
  },
  // Which page template this lead came from (e.g. "Company01", "Talent01", "Company02")
  // Sent explicitly in each form's payload — this is the reliable source of truth
  pageId: {
    type: String,
    trim: true,
    default: ''
  },
  // UTM & source tracking
  source: {
    type: String,
    trim: true,
    default: ''
  },
  sourceUrl: {
    type: String,
    trim: true,
    default: ''
  },
  referrer: {
    type: String,
    trim: true,
    default: ''
  },
  utm_source: {
    type: String,
    trim: true,
    default: ''
  },
  utm_medium: {
    type: String,
    trim: true,
    default: ''
  },
  utm_campaign: {
    type: String,
    trim: true,
    default: ''
  },
  utm_term: {
    type: String,
    trim: true,
    default: ''
  },
  utm_content: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('LandingPageLead', landingPageLeadSchema);
