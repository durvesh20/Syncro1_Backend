const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const PlatformStats = require('../models/PlatformStats');
const slotService = require('./slotService');

const PLACED_STATUSES = ['JOINED', 'PLACED', 'HIRED'];

/**
 * Helper to compute placement revenue for a closed candidate.
 * If candidate has commission or billingAmount, use it; otherwise fallback to maxLPA * 5000.
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
  let maxLPA = Number(salaryMax) || 0;
  if (maxLPA >= 100000) {
    maxLPA = maxLPA / 100000;
  }
  return Math.round(maxLPA * 5000);
}

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
 * 
 * Platform Highlights (Real-Time Live Data):
 * 7. liveVacanciesClosed: count of candidates with status IN ['JOINED', 'PLACED', 'HIRED']
 * 8. liveRevenueEarned: sum of placement revenue for placed candidates
 */
async function computeLivePlatformStats() {
  const allJobs = await Job.find({}, 'vacancies salary status title');
  
  let totalVacancies = 0;
  let totalPotentialRevenue = 0;
  let totalActiveVacancies = 0;
  let activeVacanciesPotentialRevenue = 0;
  let totalActiveRequirements = 0;

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
      totalActiveRequirements += 1;
    }
  }

  const totalRequirements = allJobs.length;
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
    liveRevenueEarned
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
