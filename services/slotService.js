// backend/services/slotService.js
const JobInterest = require('../models/JobInterest');

// STRICT RULES: Vendor (Talent Partner) submission slots for a vacancy are ONLY
// made available on these 7 specific rejection/drop statuses:
// 1. S1 Screening Reject
// 2. Client Screening Reject
// 3. Global Reject
// 4. Round Reject
// 5. Client Portal Duplicate
// 6. Candidate Drop
// 7. Consent Denied
const REJECTED_CANDIDATE_STATUSES = [
  // 1. S1 Screening Reject
  'S1_SCREEN_REJECT',
  'S1_REJECTED',

  // 2. Client Screening Reject
  'CLIENT_SCREEN_REJECT',
  'CLIENT_REJECTED',
  'COMPANY_REJECTED',

  // 3. Global Reject
  'GLOBAL_REJECT',
  'REJECTED',

  // 4. Round Reject
  'ROUND_REJECTED',
  'HR_REJECTED',
  'ASSESSMENT_FAILED',
  'OFFER_REJECTED',
  'OFFER_DECLINED',
  'CLIENT_PORTAL_DUPLICATE',
  'COMPANY_PORTAL_DUPLICATE',

  // 6. Candidate Drop
  'CANDIDATE_DROP',

  // 7. Consent Denied
  'CONSENT_DENIED',
];

/**
 * Calculates slot metrics for a talent partner on a specific job.
 * Rule: 1 vacancy = 5 slots.
 * Any candidate rejected at any level frees up their slot so the talent partner can upload a new one.
 * @param {ObjectId|string} jobId
 * @param {ObjectId|string} partnerId
 * @param {Object} [job] - optional Job document
 * @param {Object} [interest] - optional JobInterest document
 * @returns {Promise<{ submissionLimit: number, activeSubmissions: number, totalSubmissions: number, remainingSlots: number, canSubmit: boolean }>}
 */
async function getPartnerSlotMetrics(jobId, partnerId, job = null, interest = null) {
  const Candidate = require('../models/Candidate');
  const Job = require('../models/Job');

  if (!job) {
    job = await Job.findById(jobId);
  }

  const submissionLimit = (job?.vacancies || 1) * 5;

  const [activeSubmissions, totalSubmissions] = await Promise.all([
    Candidate.countDocuments({
      job: jobId,
      submittedBy: partnerId,
      status: { $nin: REJECTED_CANDIDATE_STATUSES }
    }),
    Candidate.countDocuments({
      job: jobId,
      submittedBy: partnerId
    })
  ]);

  const remainingSlots = Math.max(0, submissionLimit - activeSubmissions);
  const isJobBlocked = !job || job.status === 'ON_HOLD' || job.status === 'PAUSED' || ['CLOSED', 'FILLED'].includes(job.status);
  const isInterestActive = interest ? interest.status === 'ACTIVE' : true;
  const canSubmit = isInterestActive && !isJobBlocked && activeSubmissions < submissionLimit;

  // Sync JobInterest submissionLimit and submissionCount if interest is provided
  if (interest) {
    let changed = false;
    if (interest.submissionLimit !== submissionLimit) {
      interest.submissionLimit = submissionLimit;
      changed = true;
    }
    if (interest.submissionCount !== activeSubmissions) {
      interest.submissionCount = activeSubmissions;
      changed = true;
    }
    if (changed) {
      await interest.save();
    }
  }

  return {
    submissionLimit,
    activeSubmissions,
    totalSubmissions,
    remainingSlots,
    canSubmit
  };
}

/**
 * Synchronizes existing talent partner JobInterest submission limits when job vacancies change.
 * Rule: 1 vacancy = 5 slots.
 * @param {ObjectId|string} jobId
 * @param {number} oldVacancies
 * @param {number} newVacancies
 */
async function syncJobInterestSlots(jobId, oldVacancies, newVacancies) {
  try {
    const oldVac = Number(oldVacancies) || 1;
    const newVac = Number(newVacancies) || 1;

    if (oldVac === newVac) return;

    const slotDelta = (newVac - oldVac) * 5;
    const minRequiredSlots = newVac * 5;

    const interests = await JobInterest.find({ job: jobId });

    for (const interest of interests) {
      let updatedLimit = (interest.submissionLimit || 5) + slotDelta;

      // Ensure limit is at least the base min required for new vacancies
      if (updatedLimit < minRequiredSlots) {
        updatedLimit = minRequiredSlots;
      }

      // Never reduce submissionLimit below already submitted count
      if (interest.submissionCount && updatedLimit < interest.submissionCount) {
        updatedLimit = interest.submissionCount;
      }

      interest.submissionLimit = updatedLimit;
      await interest.save();
    }
  } catch (error) {
    console.error(`[SLOT-SERVICE] Error syncing job interest slots for job ${jobId}:`, error);
  }
}

/**
 * Ensures a single JobInterest document has at least base slots as per current job vacancies.
 * @param {Object} interest - JobInterest mongoose object
 * @param {Object} job - Job mongoose object
 */
async function ensureMinJobInterestSlots(interest, job) {
  if (!interest || !job) return interest;
  const minRequiredSlots = (job.vacancies || 1) * 5;
  if ((interest.submissionLimit || 0) < minRequiredSlots) {
    interest.submissionLimit = Math.max(interest.submissionCount || 0, minRequiredSlots);
    await interest.save();
  }
  return interest;
}

module.exports = {
  REJECTED_CANDIDATE_STATUSES,
  getPartnerSlotMetrics,
  syncJobInterestSlots,
  ensureMinJobInterestSlots
};
