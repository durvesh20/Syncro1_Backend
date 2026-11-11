const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const PlatformStats = require('../models/PlatformStats');
const slotService = require('./slotService');

const PLACED_STATUSES = ['JOINED', 'PLACED', 'HIRED'];

/**
 * Helper to compute placement revenue for a closed candidate.
 * If candidate has commission or billingAmount, use it; otherwise fallback to 5% of max CTC.
 */
function calculatePlacementRevenue(candidate, job) {
  if (candidate && candidate.commission && Number(candidate.commission) > 0) {
    return Math.round(Number(candidate.commission));
  }
  if (candidate && candidate.billingAmount && Number(candidate.billingAmount) > 0) {
    return Math.round(Number(candidate.billingAmount));
  }
  if (!job) return 0;
  let salaryMax = job.salary?.max ?? (typeof job.salary === 'number' ? job.salary : null);
  let maxSalary = Number(salaryMax) || 0;
  let maxCTCInRupees = 0;
  if (maxSalary > 0) {
    maxCTCInRupees = maxSalary < 100000 ? maxSalary * 100000 : maxSalary;
  }
  // 5% per candidate joined
  return Math.round(maxCTCInRupees * 0.05);
}

/**
 * Computes live platform-wide stats directly from the MongoDB database.
 * 
 * Row 1 (Platform Historic Totals - All-time Data):
 * 1. totalVacancies: sum of all vacancies across all jobs in the database
 * 2. totalPotentialRevenue: 
 *    Formula: (Average Max CTC of all requirements) * 5% * totalVacancies
 * 3. totalCandidatesUploaded: total count of all candidates in the database
 * 
 * Row 2 (Platform Active Operations):
 * 4. totalActiveVacancies: sum of vacancies for jobs where status === 'ACTIVE'
 * 5. activeVacanciesPotentialRevenue: 
 *    Formula: (Average Max CTC of active requirements) * 5% * totalActiveVacancies
 * 6. totalActiveCandidates: count of candidates with status NOT IN REJECTED_CANDIDATE_STATUSES
 * 
 * Platform Highlights (Real-Time Live Data):
 * 7. liveVacanciesClosed: count of candidates with status IN ['JOINED', 'PLACED', 'HIRED']
 * 8. liveRevenueEarned: sum of placement revenue for placed candidates (5% of candidate CTC)
 */
async function computeLivePlatformStats() {
  const allJobs = await Job.find({}, 'vacancies salary status title');
  
  let totalVacancies = 0;
  let totalActiveVacancies = 0;
  let totalActiveRequirements = 0;

  let sumTotalMaxCTC = 0;
  let validTotalSalaryCount = 0;

  let sumActiveMaxCTC = 0;
  let validActiveSalaryCount = 0;

  for (const job of allJobs) {
    const vac = Math.max(1, Number(job.vacancies) || 1);
    totalVacancies += vac;

    // Extract max salary in INR (Full CTC)
    let salaryMax = job.salary?.max ?? (typeof job.salary === 'number' ? job.salary : null);
    let maxSalary = Number(salaryMax) || 0;
    let maxCTCInRupees = 0;
    if (maxSalary > 0) {
      if (maxSalary < 100000) {
        // Stored in LPA, convert to full INR CTC (e.g. 12 LPA -> 12,00,000 INR)
        maxCTCInRupees = maxSalary * 100000;
      } else {
        maxCTCInRupees = maxSalary;
      }
    }

    if (maxCTCInRupees > 0) {
      sumTotalMaxCTC += maxCTCInRupees;
      validTotalSalaryCount += 1;
    }

    if (job.status === 'ACTIVE') {
      totalActiveVacancies += vac;
      totalActiveRequirements += 1;
      if (maxCTCInRupees > 0) {
        sumActiveMaxCTC += maxCTCInRupees;
        validActiveSalaryCount += 1;
      }
    }
  }

  const totalRequirements = allJobs.length;

  // 1. Total Potential Revenue calculation:
  // (Avg of total max CTC of the requirements) * 5% * total vacancies
  const divisorTotal = validTotalSalaryCount > 0 ? validTotalSalaryCount : (totalRequirements || 1);
  const avgTotalMaxCTC = totalRequirements > 0 ? (sumTotalMaxCTC / divisorTotal) : 0;
  const avgTotalCommission = avgTotalMaxCTC * 0.05; // 5% per candidate joined
  const totalPotentialRevenue = Math.round(avgTotalCommission * totalVacancies);

  // 2. Active Vacancies Potential Revenue calculation:
  // (Avg of active max CTC of active requirements) * 5% * total active vacancies
  const divisorActive = validActiveSalaryCount > 0 ? validActiveSalaryCount : (totalActiveRequirements || 1);
  const avgActiveMaxCTC = totalActiveRequirements > 0 ? (sumActiveMaxCTC / divisorActive) : 0;
  const avgActiveCommission = avgActiveMaxCTC * 0.05; // 5% per candidate joined
  const activeVacanciesPotentialRevenue = Math.round(avgActiveCommission * totalActiveVacancies);

  const totalCandidatesUploaded = await Candidate.countDocuments();
  const totalActiveCandidates = await Candidate.countDocuments({
    status: { $nin: slotService.REJECTED_CANDIDATE_STATUSES }
  });

  // Real-time live calculations for closed vacancies & revenue earned
  const placedCandidates = await Candidate.find({
    status: { $in: PLACED_STATUSES }
  }).populate('job', 'salary vacancies').lean();

  const liveVacanciesClosed = placedCandidates.length;
  let liveRevenueEarned = 0;
  for (const cand of placedCandidates) {
    liveRevenueEarned += calculatePlacementRevenue(cand, cand.job);
  }

  return {
    totalVacancies,
    totalPotentialRevenue,
    totalCandidatesUploaded,
    totalActiveVacancies,
    activeVacanciesPotentialRevenue,
    totalActiveCandidates,
    totalRequirements,
    totalActiveRequirements,
    liveVacanciesClosed,
    liveRevenueEarned,
    avgMaxCTC: Math.round(avgTotalMaxCTC),
    avgActiveMaxCTC: Math.round(avgActiveMaxCTC)
  };
}

/**
 * Retrieves the effective platform stats to display.
 * Row 1 & Row 2 are ALWAYS strictly live data computed directly from MongoDB.
 * Highlight Cards (totalVacanciesClosed & totalRevenueEarned) combine real-time live data
 * with optional mock/offset data configured through backend/admin.
 */
async function getEffectivePlatformStats() {
  const liveStats = await computeLivePlatformStats();
  let statsDoc = await PlatformStats.findOne();

  if (!statsDoc) {
    statsDoc = await PlatformStats.create({
      totalVacanciesClosed: 0,
      totalRevenueEarned: 0,
      mockVacanciesClosed: 0,
      mockRevenueEarned: 0,
      mockMode: 'ADD'
    });
  }

  const mockMode = statsDoc.mockMode || 'ADD';
  const mockVacancies = Number(statsDoc.mockVacanciesClosed ?? statsDoc.totalVacanciesClosed ?? 0);
  const mockRevenue = Number(statsDoc.mockRevenueEarned ?? statsDoc.totalRevenueEarned ?? 0);

  let effectiveVacanciesClosed = liveStats.liveVacanciesClosed;
  let effectiveRevenueEarned = liveStats.liveRevenueEarned;

  if (mockMode === 'OVERRIDE') {
    effectiveVacanciesClosed = mockVacancies > 0 ? mockVacancies : liveStats.liveVacanciesClosed;
    effectiveRevenueEarned = mockRevenue > 0 ? mockRevenue : liveStats.liveRevenueEarned;
  } else {
    // Default 'ADD' mode: Real Data calculated in real-time + Mock Data added from backend
    effectiveVacanciesClosed = liveStats.liveVacanciesClosed + mockVacancies;
    effectiveRevenueEarned = liveStats.liveRevenueEarned + mockRevenue;
  }

  const effectiveStats = {
    // Strictly live data from MongoDB for Row 1 & Row 2:
    totalVacancies: liveStats.totalVacancies,
    totalPotentialRevenue: liveStats.totalPotentialRevenue,
    totalCandidatesUploaded: liveStats.totalCandidatesUploaded,
    totalActiveVacancies: liveStats.totalActiveVacancies,
    activeVacanciesPotentialRevenue: liveStats.activeVacanciesPotentialRevenue,
    totalActiveCandidates: liveStats.totalActiveCandidates,
    totalRequirements: liveStats.totalRequirements,
    totalActiveRequirements: liveStats.totalActiveRequirements,
    avgMaxCTC: liveStats.avgMaxCTC,
    avgActiveMaxCTC: liveStats.avgActiveMaxCTC,

    // Real-time live + backend mock configured for Highlight Cards:
    totalVacanciesClosed: effectiveVacanciesClosed,
    totalRevenueEarned: effectiveRevenueEarned,

    // Detailed breakdown for transparency & admin controls:
    liveVacanciesClosed: liveStats.liveVacanciesClosed,
    liveRevenueEarned: liveStats.liveRevenueEarned,
    mockVacanciesClosed: mockVacancies,
    mockRevenueEarned: mockRevenue,
    mockMode,
  };

  return {
    stats: effectiveStats,
    liveStats,
    mockMode,
    mockVacanciesClosed: mockVacancies,
    mockRevenueEarned: mockRevenue,
    updatedAt: statsDoc.updatedAt
  };
}

/**
 * Updates manual / mock platform stats for the 2 highlight cards.
 */
async function updatePlatformStatsOverrides({
  updatedBy,
  totalVacanciesClosed,
  totalRevenueEarned,
  mockVacanciesClosed,
  mockRevenueEarned,
  mockMode
}) {
  let statsDoc = await PlatformStats.findOne();
  if (!statsDoc) {
    statsDoc = new PlatformStats();
  }

  const vacanciesVal = mockVacanciesClosed !== undefined ? mockVacanciesClosed : totalVacanciesClosed;
  const revenueVal = mockRevenueEarned !== undefined ? mockRevenueEarned : totalRevenueEarned;

  if (vacanciesVal !== undefined && vacanciesVal !== null && vacanciesVal !== '') {
    const val = Math.max(0, Number(vacanciesVal) || 0);
    statsDoc.totalVacanciesClosed = val;
    statsDoc.mockVacanciesClosed = val;
  }

  if (revenueVal !== undefined && revenueVal !== null && revenueVal !== '') {
    const val = Math.max(0, Number(revenueVal) || 0);
    statsDoc.totalRevenueEarned = val;
    statsDoc.mockRevenueEarned = val;
  }

  if (mockMode && ['ADD', 'OVERRIDE'].includes(mockMode)) {
    statsDoc.mockMode = mockMode;
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
