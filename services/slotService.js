// backend/services/slotService.js
const JobInterest = require('../models/JobInterest');

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
  syncJobInterestSlots,
  ensureMinJobInterestSlots
};
