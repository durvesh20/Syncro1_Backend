const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const PlatformStats = require('../models/PlatformStats');
const slotService = require('./slotService');

/**
 * Computes live platform-wide stats directly from the MongoDB database.
 * 
 * Row 1 (Platform Historic Totals - All-time Data):
 * 1. totalVacancies: sum of all vacancies across all jobs in the database
 * 2. totalPotentialRevenue: sum of potential revenue across all jobs in the database
 *    Formula: jobVacancies * (salaryMaxInLPA * 5000)
 * 3. totalCandidatesUploaded: total count of all candidates in the database
 * 
 * Row 2 (Platform Active Operations):
 * 4. totalActiveVacancies: sum of vacancies for jobs where status === 'ACTIVE'
 * 5. activeVacanciesPotentialRevenue: sum of potential revenue for active jobs
 * 6. totalActiveCandidates: count of candidates with status NOT IN REJECTED_CANDIDATE_STATUSES
 */
async function computeLivePlatformStats() {
  const allJobs = await Job.find({}, 'vacancies salary status title');
  
  let totalVacancies = 0;
  let totalPotentialRevenue = 0;
  let totalActiveVacancies = 0;
  let activeVacanciesPotentialRevenue = 0;

  for (const job of allJobs) {
    const vac = Math.max(1, Number(job.vacancies) || 1);
    
    // Extract max salary in LPA (Lakhs Per Annum)
    let salaryMax = job.salary?.max ?? (typeof job.salary === 'number' ? job.salary : null);
    let maxLPA = Number(salaryMax) || 0;
    if (maxLPA >= 100000) {
      maxLPA = maxLPA / 100000;
    }
    
    // Max earning per placement = maxLPA * 5000
    // Total potential for this job = vac * earningPerPlacement
    const earningPerPlacement = maxLPA * 5000;
    const jobPotential = vac * earningPerPlacement;

    totalVacancies += vac;
    totalPotentialRevenue += jobPotential;

    if (job.status === 'ACTIVE') {
      totalActiveVacancies += vac;
      activeVacanciesPotentialRevenue += jobPotential;
    }
  }

  const totalCandidatesUploaded = await Candidate.countDocuments();
  const totalActiveCandidates = await Candidate.countDocuments({
    status: { $nin: slotService.REJECTED_CANDIDATE_STATUSES }
  });

  return {
    totalVacancies,
    totalPotentialRevenue,
    totalCandidatesUploaded,
    totalActiveVacancies,
    activeVacanciesPotentialRevenue,
    totalActiveCandidates
  };
}

/**
 * Retrieves the effective platform stats to display.
 * Row 1 (Platform Historic Totals) and Row 2 (Platform Active Operations) are ALWAYS strictly
 * live data computed directly from the MongoDB database (no manual overrides).
 * The only manual fields managed by Admin in website modification are totalVacanciesClosed and totalRevenueEarned.
 */
async function getEffectivePlatformStats() {
  const liveStats = await computeLivePlatformStats();
  let statsDoc = await PlatformStats.findOne();

  if (!statsDoc) {
    statsDoc = await PlatformStats.create({
      totalVacanciesClosed: 0,
      totalRevenueEarned: 0
    });
  }

  const effectiveStats = {
    // Strictly live data from MongoDB for Row 1 & Row 2:
    totalVacancies: liveStats.totalVacancies,
    totalPotentialRevenue: liveStats.totalPotentialRevenue,
    totalCandidatesUploaded: liveStats.totalCandidatesUploaded,
    totalActiveVacancies: liveStats.totalActiveVacancies,
    activeVacanciesPotentialRevenue: liveStats.activeVacanciesPotentialRevenue,
    totalActiveCandidates: liveStats.totalActiveCandidates,

    // Manually configured by admin in Website Management:
    totalVacanciesClosed: statsDoc.totalVacanciesClosed || 0,
    totalRevenueEarned: statsDoc.totalRevenueEarned || 0,
  };

  return {
    stats: effectiveStats,
    liveStats,
    updatedAt: statsDoc.updatedAt
  };
}

/**
 * Updates manual platform stats (only totalVacanciesClosed and totalRevenueEarned).
 */
async function updatePlatformStatsOverrides({ updatedBy, totalVacanciesClosed, totalRevenueEarned }) {
  let statsDoc = await PlatformStats.findOne();
  if (!statsDoc) {
    statsDoc = new PlatformStats();
  }

  if (totalVacanciesClosed !== undefined && totalVacanciesClosed !== null && totalVacanciesClosed !== '') {
    statsDoc.totalVacanciesClosed = Math.max(0, Number(totalVacanciesClosed) || 0);
  }
  if (totalRevenueEarned !== undefined && totalRevenueEarned !== null && totalRevenueEarned !== '') {
    statsDoc.totalRevenueEarned = Math.max(0, Number(totalRevenueEarned) || 0);
  }

  if (updatedBy) {
    statsDoc.updatedBy = updatedBy;
  }

  await statsDoc.save();
  return getEffectivePlatformStats();
}

module.exports = {
  computeLivePlatformStats,
  getEffectivePlatformStats,
  updatePlatformStatsOverrides
};
