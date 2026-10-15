// backend/seeders/clearDemo.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load development environment variables
const envPath = path.resolve(__dirname, '../.env.development');
dotenv.config({ path: envPath });

if (!process.env.MONGO_URI) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// Models
const User = require('../models/User');
const Company = require('../models/Company');
const StaffingPartner = require('../models/StaffingPartner');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const InterviewSlot = require('../models/InterviewSlot');
const JobInterest = require('../models/JobInterest');

const clearDemoData = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected successfully');

    console.log('Clearing existing demo data (isDemo: true)...');

    const resCandidates = await Candidate.deleteMany({ isDemo: true });
    console.log(`Deleted ${resCandidates.deletedCount} demo candidates.`);

    const resSlots = await InterviewSlot.deleteMany({ isDemo: true });
    console.log(`Deleted ${resSlots.deletedCount} demo interview slots.`);

    const resInterests = await JobInterest.deleteMany({ isDemo: true });
    console.log(`Deleted ${resInterests.deletedCount} demo job interests.`);

    const resJobs = await Job.deleteMany({ isDemo: true });
    console.log(`Deleted ${resJobs.deletedCount} demo jobs.`);

    const resCompanies = await Company.deleteMany({ isDemo: true });
    console.log(`Deleted ${resCompanies.deletedCount} demo companies.`);

    const resPartners = await StaffingPartner.deleteMany({ isDemo: true });
    console.log(`Deleted ${resPartners.deletedCount} demo staffing partners.`);

    const resUsers = await User.deleteMany({ isDemo: true });
    console.log(`Deleted ${resUsers.deletedCount} demo users.`);

    console.log('All demo data cleared successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Failed to clear demo data:', error);
    process.exit(1);
  }
};

clearDemoData();

