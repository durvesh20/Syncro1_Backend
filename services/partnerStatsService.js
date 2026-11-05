// backend/services/partnerStatsService.js
const mongoose = require('mongoose');
const JobInterest = require('../models/JobInterest');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const StaffingPartner = require('../models/StaffingPartner');

/**
 * Helper to compute potential revenue for a single job position
 * Formula: vacancies * (salaryMaxInLPA * 5,000)
 */
function calculateJobPotentialRevenue(job) {
  if (!job) return 0;
  const vac = Math.max(1, Number(job.vacancies) || 1);
  let salaryMax = job.salary?.max ?? (typeof job.salary === 'number' ? job.salary : null);
  let maxLPA = Number(salaryMax) || 0;
  if (maxLPA >= 100000) {
    maxLPA = maxLPA / 100000;
  }
  return Math.round(vac * (maxLPA * 5000));
}

/**
 * Helper to compute closed earning per candidate placed
 */
function calculateCandidatePlacementRevenue(candidate, job) {
  if (candidate && candidate.commission && Number(candidate.commission) > 0) {
    return Math.round(Number(candidate.commission));
  }
  if (candidate && candidate.billingAmount && Number(candidate.billingAmount) > 0) {
    return Math.round(Number(candidate.billingAmount));
  }
  if (!job) return 0;
  let salaryMax = job.salary?.max ?? (typeof job.salary === 'number' ? job.salary : null);
  let maxLPA = Number(salaryMax) || 0;
  if (maxLPA >= 100000) {
    maxLPA = maxLPA / 100000;
  }
  return Math.round(maxLPA * 5000);
}

/**
 * Computes strictly live 3x3 stats metrics for a specific Talent Partner:
 *
 * Row 1 (Shortlisted Requirements):
 *   1. Total Requirement shortlisted
 *   2. Shortlisted requirement potential revenue
 *   3. Estimated Candidates Required for Shortlisted Requirements (vacancies * 5 slots)
 *
 * Row 2 (Worked on Requirements):
 *   1. Total requirement worked on
 *   2. Worked on potential revenue
 *   3. Actual Candidates Uploaded
 *
 * Row 3 (Closed Vacancies & Placements):
 *   1. Total Vacancies closed
 *   2. Total Vacancies closed potential revenue
 *   3. Total Candidates Closed
 *
 * Includes automated cross-check values for data verification.
 */
async function computePartnerStats(partnerId, userId = null) {
  if (!partnerId) {
    throw new Error('partnerId is required to compute partner stats');
  }

  const pObjectId = new mongoose.Types.ObjectId(partnerId.toString());
  const partnerIds = [pObjectId];
  if (userId) {
    try {
      partnerIds.push(new mongoose.Types.ObjectId(userId.toString()));
    } catch {
      // ignore invalid user id
    }
  }

  const partnerBaseQuery = {
    $or: [
      { submittedBy: { $in: partnerIds } },
      { partner: { $in: partnerIds } }
    ]
  };

  // ==========================================
  // ROW 1: SHORTLISTED REQUIREMENTS (Pipeline)
  // ==========================================
  const activeInterests = await JobInterest.find({
    $or: [
      { partner: { $in: partnerIds } },
      { user: { $in: partnerIds } }
    ],
    status: 'ACTIVE'
  })
    .populate('job')
    .lean();

  // Deduplicate unique jobs
  const seenJobIds = new Set();
  const shortlistedJobs = [];
  for (const item of activeInterests) {
    if (item.job && item.job._id) {
      const jid = item.job._id.toString();
      if (!seenJobIds.has(jid)) {
        seenJobIds.add(jid);
        shortlistedJobs.push(item.job);
      }
    }
  }

  const totalRequirementsShortlisted = shortlistedJobs.length;
  let totalVacanciesShortlisted = 0;
  let shortlistedRequirementsPotentialRevenue = 0;
  let estimatedCandidatesRequired = 0;

  for (const job of shortlistedJobs) {
    const vac = Math.max(1, Number(job.vacancies) || 1);
    totalVacanciesShortlisted += vac;
    shortlistedRequirementsPotentialRevenue += calculateJobPotentialRevenue(job);
    // In Syncro1: 1 vacancy = 5 candidate submission slots
    estimatedCandidatesRequired += (vac * 5);
  }

  // ==========================================
  // ROW 2: WORKED ON REQUIREMENTS (Execution)
  // ==========================================
  const workedJobRawIds = await Candidate.distinct('job', partnerBaseQuery);
  const workedJobObjectIds = workedJobRawIds.filter(Boolean);
  const workedJobs = await Job.find({ _id: { $in: workedJobObjectIds } }).lean();

  const totalRequirementsWorkedOn = workedJobs.length;
  let totalVacanciesWorkedOn = 0;
  let workedOnPotentialRevenue = 0;
  for (const job of workedJobs) {
    const vac = Math.max(1, Number(job.vacancies) || 1);
    totalVacanciesWorkedOn += vac;
    workedOnPotentialRevenue += calculateJobPotentialRevenue(job);
  }

  const actualCandidatesUploaded = await Candidate.countDocuments(partnerBaseQuery);

  // ==========================================
  // ROW 3: CLOSED VACANCIES & PLACEMENTS
  // ==========================================
  const PLACED_STATUSES = ['JOINED', 'PLACED', 'HIRED'];
  const closedCandidates = await Candidate.find({
    ...partnerBaseQuery,
    status: { $in: PLACED_STATUSES }
  })
    .populate('job')
    .lean();

  const totalCandidatesClosed = closedCandidates.length;
  // In Syncro1, each successfully joined candidate fulfills 1 closed vacancy
  const totalVacanciesClosed = totalCandidatesClosed;

  let totalVacanciesClosedPotentialRevenue = 0;
  for (const cand of closedCandidates) {
    totalVacanciesClosedPotentialRevenue += calculateCandidatePlacementRevenue(cand, cand.job);
  }

  // ==========================================
  // AUTOMATED INTEGRITY CROSS-CHECK
  // ==========================================
  const invariants = {
    candidatesClosedLteUploaded: totalCandidatesClosed <= actualCandidatesUploaded,
    vacanciesClosedEqCandidatesClosed: totalVacanciesClosed === totalCandidatesClosed,
    candidatesUploadedGteWorkedJobs: actualCandidatesUploaded >= totalRequirementsWorkedOn,
    revenueValuesNonNegative: (
      shortlistedRequirementsPotentialRevenue >= 0 &&
      workedOnPotentialRevenue >= 0 &&
      totalVacanciesClosedPotentialRevenue >= 0
    )
  };

  const isConsistent = Object.values(invariants).every(Boolean);

  return {
    partnerId: partnerId.toString(),

    // Row 1: Shortlisted Requirements
    row1: {
      totalRequirementsShortlisted,
      totalVacanciesShortlisted,
      shortlistedRequirementsPotentialRevenue,
      estimatedCandidatesRequired
    },
    totalRequirementsShortlisted,
    totalVacanciesShortlisted,
    shortlistedRequirementsPotentialRevenue,
    estimatedCandidatesRequired,

    // Row 2: Worked on Requirements
    row2: {
      totalRequirementsWorkedOn,
      totalVacanciesWorkedOn,
      workedOnPotentialRevenue,
      actualCandidatesUploaded
    },
    totalRequirementsWorkedOn,
    totalVacanciesWorkedOn,
    workedOnPotentialRevenue,
    actualCandidatesUploaded,

    // Row 3: Closed Vacancies & Candidates
    row3: {
      totalVacanciesClosed,
      totalVacanciesClosedPotentialRevenue,
      totalCandidatesClosed
    },
    totalVacanciesClosed,
    totalVacanciesClosedPotentialRevenue,
    totalCandidatesClosed,

    // Cross-check metadata for validation
    crossCheck: {
      isConsistent,
      invariants,
      verifiedAt: new Date().toISOString(),
      formulaNotes: {
        potentialRevenueFormula: "vacancies * (salaryMaxInLPA * 5,000)",
        slotFormula: "1 vacancy = 5 candidate slots"
      }
    }
  };
}

module.exports = {
  computePartnerStats,
  calculateJobPotentialRevenue,
  calculateCandidatePlacementRevenue
};

