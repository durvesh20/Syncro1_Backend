#!/usr/bin/env node
/**
 * ==============================================================================
 * SYNCRO1 PLATFORM STATS SANITY TEST & VERIFICATION SCRIPT
 * ==============================================================================
 * This script runs an exhaustive, ground-truth verification of all 6 platform metrics
 * against the live MongoDB database:
 * 
 * 1. Total Vacancies (across all jobs in the database)
 * 2. Total Potential Revenue (sum of all jobs: vacancies * (salaryMaxInLPA * 5000))
 * 3. Total Candidates Uploaded (count of all candidates in the database)
 * 4. Total Active Vacancies (sum of vacancies for ACTIVE jobs)
 * 5. Active Vacancies Potential Revenue (sum of active jobs: vacancies * (salaryMaxInLPA * 5000))
 * 6. Total Active Candidates (count of candidates NOT IN REJECTED_CANDIDATE_STATUSES)
 * ==============================================================================
 */

const path = require('path');
require('../config/env');
const connectDB = require('../config/db');
const mongoose = require('mongoose');

const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const PlatformStats = require('../models/PlatformStats');
const slotService = require('../services/slotService');
const platformStatsService = require('../services/platformStatsService');

function formatCurrency(val) {
  return '₹' + Number(val || 0).toLocaleString('en-IN');
}

function formatNumber(val) {
  return Number(val || 0).toLocaleString('en-IN');
}

async function runSanityCheck() {
  console.log('='.repeat(80));
  console.log('SYNCRO1 PLATFORM STATS SANITY & AUDIT VERIFICATION');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${new Date().toISOString()}`);

  console.log('\n[1/5] Connecting to Database...');
  await connectDB();
  console.log('Connected to MongoDB successfully.\n');

  console.log('[2/5] Inspecting Jobs Collection...');
  const allJobs = await Job.find({}, 'title vacancies salary status uniqueId');
  console.log(`Total Job Documents Found: ${allJobs.length}`);

  // Status breakdown
  const jobStatusCounts = {};
  const jobStatusVacancies = {};
  const jobStatusRevenue = {};

  let computedTotalVacancies = 0;
  let computedTotalPotentialRevenue = 0;
  let computedActiveVacancies = 0;
  let computedActivePotentialRevenue = 0;

  for (const job of allJobs) {
    const status = job.status || 'UNKNOWN';
    const vac = Math.max(1, Number(job.vacancies) || 1);

    let salaryMax = job.salary?.max ?? (typeof job.salary === 'number' ? job.salary : null);
    let maxLPA = Number(salaryMax) || 0;
    if (maxLPA >= 100000) {
      maxLPA = maxLPA / 100000;
    }
    const earningPerPlacement = maxLPA * 5000;
    const jobPotential = vac * earningPerPlacement;

    jobStatusCounts[status] = (jobStatusCounts[status] || 0) + 1;
    jobStatusVacancies[status] = (jobStatusVacancies[status] || 0) + vac;
    jobStatusRevenue[status] = (jobStatusRevenue[status] || 0) + jobPotential;

    computedTotalVacancies += vac;
    computedTotalPotentialRevenue += jobPotential;

    if (status === 'ACTIVE') {
      computedActiveVacancies += vac;
      computedActivePotentialRevenue += jobPotential;
    }
  }

  console.log('\n--- Jobs Breakdown by Status ---');
  console.table(
    Object.keys(jobStatusCounts).map(status => ({
      Status: status,
      'Job Count': jobStatusCounts[status],
      'Total Vacancies': jobStatusVacancies[status],
      'Potential Revenue': formatCurrency(jobStatusRevenue[status]),
      'Potential Revenue (Raw)': jobStatusRevenue[status]
    }))
  );

  console.log('\n[3/5] Inspecting Candidates Collection...');
  const totalCandidates = await Candidate.countDocuments();
  console.log(`Total Candidates Found: ${totalCandidates}`);

  // Status breakdown for candidates
  const candidateStatusAgg = await Candidate.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  const rejectedSet = new Set(slotService.REJECTED_CANDIDATE_STATUSES);
  let computedRejectedCount = 0;
  let computedActiveCandidates = 0;

  const candidateTable = candidateStatusAgg.map(item => {
    const isRejected = rejectedSet.has(item._id);
    if (isRejected) {
      computedRejectedCount += item.count;
    } else {
      computedActiveCandidates += item.count;
    }
    return {
      Status: item._id || 'NO_STATUS',
      Count: item.count,
      Classification: isRejected ? 'REJECTED (Slot Freed)' : 'ACTIVE (In Pipeline)'
    };
  });

  console.log('\n--- Candidates Breakdown by Status ---');
  console.table(candidateTable);

  console.log(`Rejected Status Candidates: ${computedRejectedCount}`);
  console.log(`Active Candidates:           ${computedActiveCandidates}`);

  console.log('\n[4/5] Executing platformStatsService.computeLivePlatformStats()...');
  const serviceStats = await platformStatsService.computeLivePlatformStats();

  console.log('\n[5/5] Validating Invariants and Assertions...');

  const results = [
    {
      metric: 'Total Vacancies',
      expected: computedTotalVacancies,
      received: serviceStats.totalVacancies,
      formatted: formatNumber(serviceStats.totalVacancies),
      pass: computedTotalVacancies === serviceStats.totalVacancies && serviceStats.totalVacancies >= 0
    },
    {
      metric: 'Total Potential Revenue',
      expected: computedTotalPotentialRevenue,
      received: serviceStats.totalPotentialRevenue,
      formatted: formatCurrency(serviceStats.totalPotentialRevenue),
      pass: computedTotalPotentialRevenue === serviceStats.totalPotentialRevenue && serviceStats.totalPotentialRevenue >= 0
    },
    {
      metric: 'Total Candidates Uploaded',
      expected: totalCandidates,
      received: serviceStats.totalCandidatesUploaded,
      formatted: formatNumber(serviceStats.totalCandidatesUploaded),
      pass: totalCandidates === serviceStats.totalCandidatesUploaded && serviceStats.totalCandidatesUploaded >= 0
    },
    {
      metric: 'Total Active Vacancies',
      expected: computedActiveVacancies,
      received: serviceStats.totalActiveVacancies,
      formatted: formatNumber(serviceStats.totalActiveVacancies),
      pass: computedActiveVacancies === serviceStats.totalActiveVacancies && serviceStats.totalActiveVacancies >= 0
    },
    {
      metric: 'Active Vacancies Potential Revenue',
      expected: computedActivePotentialRevenue,
      received: serviceStats.activeVacanciesPotentialRevenue,
      formatted: formatCurrency(serviceStats.activeVacanciesPotentialRevenue),
      pass: computedActivePotentialRevenue === serviceStats.activeVacanciesPotentialRevenue && serviceStats.activeVacanciesPotentialRevenue >= 0
    },
    {
      metric: 'Total Active Candidates',
      expected: computedActiveCandidates,
      received: serviceStats.totalActiveCandidates,
      formatted: formatNumber(serviceStats.totalActiveCandidates),
      pass: computedActiveCandidates === serviceStats.totalActiveCandidates && serviceStats.totalActiveCandidates >= 0
    }
  ];

  console.table(
    results.map(r => ({
      Metric: r.metric,
      'Exact Value': r.received,
      'Formatted (UI Display)': r.formatted,
      'Sanity Check': r.pass ? 'PASSED ✅' : 'FAILED ❌'
    }))
  );

  // Invariant checks
  const invariants = [
    {
      name: 'Active Vacancies <= Total Vacancies',
      passed: serviceStats.totalActiveVacancies <= serviceStats.totalVacancies
    },
    {
      name: 'Active Potential Revenue <= Total Potential Revenue',
      passed: serviceStats.activeVacanciesPotentialRevenue <= serviceStats.totalPotentialRevenue
    },
    {
      name: 'Active Candidates <= Total Candidates',
      passed: serviceStats.totalActiveCandidates <= serviceStats.totalCandidatesUploaded
    }
  ];

  console.log('\n--- Business Logic Invariants ---');
  for (const inv of invariants) {
    console.log(`[${inv.passed ? 'PASS ✅' : 'FAIL ❌'}] ${inv.name}`);
    if (!inv.passed) throw new Error(`Invariant failed: ${inv.name}`);
  }

  // Cross check with effective stats
  const effective = await platformStatsService.getEffectivePlatformStats();
  console.log('\n--- Effective Stats Output for Talent Partner Dashboard ---');
  console.log('Row 1 & Row 2: Strictly Live Data (MongoDB)');
  console.log(JSON.stringify(effective.stats, null, 2));

  for (const r of results) {
    if (!r.pass) {
      throw new Error(`Sanity test failed for ${r.metric}: expected ${r.expected}, received ${r.received}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('ALL SANITY TESTS PASSED SUCCESSFULLY! (100% Data Integrity Verified)');
  console.log('='.repeat(80));

  await mongoose.disconnect();
}

runSanityCheck().catch(async (err) => {
  console.error('\n❌ SANITY TEST ENCOUNTERED AN ERROR:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});

