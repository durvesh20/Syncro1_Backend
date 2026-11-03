// backend/scripts/sanityCheckPartnerStats.js
/**
 * Cross-check and sanity test script for Talent Partner Live Specific 3x3 Stats Cards.
 * Run via: npm run check:partner-stats
 */
const path = require('path');
const dotenv = require('dotenv');

// Load environment configuration
const envPath = path.resolve(__dirname, '../.env.development');
const dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
  dotenv.config(); // fallback to default .env
} else {
  console.log(`✅ Loaded .env.development from ${envPath}`);
}

const mongoose = require('mongoose');

// Load required models to avoid MissingSchemaError
require('../models/User');
require('../models/Company');
require('../models/Job');
require('../models/JobInterest');
require('../models/Candidate');
const StaffingPartner = require('../models/StaffingPartner');
const partnerStatsService = require('../services/partnerStatsService');

async function runSanityCheck() {
  console.log('='.repeat(80));
  console.log('SYNCRO1 TALENT PARTNER SPECIFIC STATS (3x3) LIVE SANITY & AUDIT TEST');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ Error: MONGO_URI is not set in environment.');
    process.exit(1);
  }

  console.log('[1/4] Connecting to Database...');
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log('Connected to MongoDB successfully.\n');

  console.log('[2/4] Querying Talent Partners...');
  const allPartners = await StaffingPartner.find().lean();
  console.log(`Total Talent Partners in Database: ${allPartners.length}\n`);

  let totalPartnersEvaluated = 0;
  let totalInvariantsTested = 0;
  let totalInvariantsPassed = 0;

  console.log('[3/4] Evaluating Live Partner 3x3 Stats & Cross-Checks...');

  for (const partner of allPartners) {
    const partnerId = partner._id;
    const partnerName = partner.firmName || `${partner.firstName || ''} ${partner.lastName || ''}`.trim() || 'Unknown Partner';

    const stats = await partnerStatsService.computePartnerStats(partnerId, partner.user);

    // Only print detailed report for partners that have activity or sample active ones
    const hasActivity = (
      stats.totalRequirementsShortlisted > 0 ||
      stats.totalRequirementsWorkedOn > 0 ||
      stats.actualCandidatesUploaded > 0
    );

    totalPartnersEvaluated++;

    // Invariant assertions
    const checks = [
      {
        name: 'Candidates Closed <= Actual Candidates Uploaded',
        pass: stats.totalCandidatesClosed <= stats.actualCandidatesUploaded
      },
      {
        name: 'Total Vacancies Closed === Total Candidates Closed',
        pass: stats.totalVacanciesClosed === stats.totalCandidatesClosed
      },
      {
        name: 'Actual Candidates Uploaded >= Requirements Worked On (if worked on > 0)',
        pass: stats.totalRequirementsWorkedOn === 0 || stats.actualCandidatesUploaded >= stats.totalRequirementsWorkedOn
      },
      {
        name: 'All Revenue Figures Are Non-Negative',
        pass: (
          stats.shortlistedRequirementsPotentialRevenue >= 0 &&
          stats.workedOnPotentialRevenue >= 0 &&
          stats.totalVacanciesClosedPotentialRevenue >= 0
        )
      },
      {
        name: 'CrossCheck Internal Consistency Flag is True',
        pass: stats.crossCheck.isConsistent === true
      }
    ];

    for (const c of checks) {
      totalInvariantsTested++;
      if (c.pass) totalInvariantsPassed++;
    }

    if (hasActivity) {
      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`Talent Partner: "${partnerName}" (ID: ${partnerId})`);
      console.log(`--------------------------------------------------------------------------------`);

      console.table([
        {
          'Row': 'Row 1 (Shortlisted)',
          'Metric 1 (Requirements)': `Shortlisted: ${stats.totalRequirementsShortlisted}`,
          'Metric 2 (Potential Revenue)': `₹${stats.shortlistedRequirementsPotentialRevenue.toLocaleString('en-IN')}`,
          'Metric 3 (Candidates)': `Estimated Required: ${stats.estimatedCandidatesRequired}`
        },
        {
          'Row': 'Row 2 (Worked On)',
          'Metric 1 (Requirements)': `Worked On: ${stats.totalRequirementsWorkedOn}`,
          'Metric 2 (Potential Revenue)': `₹${stats.workedOnPotentialRevenue.toLocaleString('en-IN')}`,
          'Metric 3 (Candidates)': `Actual Uploaded: ${stats.actualCandidatesUploaded}`
        },
        {
          'Row': 'Row 3 (Closed)',
          'Metric 1 (Requirements)': `Vacancies Closed: ${stats.totalVacanciesClosed}`,
          'Metric 2 (Potential Revenue)': `₹${stats.totalVacanciesClosedPotentialRevenue.toLocaleString('en-IN')}`,
          'Metric 3 (Candidates)': `Candidates Closed: ${stats.totalCandidatesClosed}`
        }
      ]);

      const allPassed = checks.every(c => c.pass);
      console.log(`Invariants Check for ${partnerName}: ${allPassed ? 'ALL PASSED ✅' : 'FAILED ❌'}`);
      if (!allPassed) {
        checks.filter(c => !c.pass).forEach(c => console.error(`  - FAILED: ${c.name}`));
      }
    }
  }

  console.log('\n[4/4] Summary & Audit Conclusion');
  console.log('='.repeat(80));
  console.log(`Evaluated Partners:  ${totalPartnersEvaluated}`);
  console.log(`Invariants Tested:   ${totalInvariantsTested}`);
  console.log(`Invariants Passed:   ${totalInvariantsPassed}`);
  console.log(`Success Rate:        ${((totalInvariantsPassed / totalInvariantsTested) * 100).toFixed(1)}%`);

  if (totalInvariantsPassed === totalInvariantsTested) {
    console.log('\n🎉 ALL PARTNER STATS SANITY CHECKS PASSED WITH 100% INTEGRITY!');
  } else {
    console.error('\n⚠️ SOME INVARIANTS FAILED. Please review the errors above.');
    process.exitCode = 1;
  }

  await mongoose.disconnect();
}

runSanityCheck().catch((err) => {
  console.error('Fatal Sanity Check Error:', err);
  process.exit(1);
});

