// backend/services/partnerProgramService.js
const mongoose = require('mongoose');
const { PartnerPointEvent, STAGES, STAGE_POINTS } = require('../models/PartnerPointEvent');
const PartnerTournament = require('../models/PartnerTournament');
const StaffingPartner = require('../models/StaffingPartner');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const Company = require('../models/Company');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Status category definitions mapped strictly to the new 7 tournament milestone rules
// 1: S1 Review -> S1_REVIEW
const S1_REVIEW_STATES = new Set(['S1_REVIEW']);
// 2: S1 Screen Select -> S1_SCREEN_SELECT
const S1_SCREEN_SELECT_STATES = new Set(['S1_SCREEN_SELECT']);
// 3: Client Screen Select -> CLIENT_SCREEN_SELECT
const CLIENT_SCREEN_SELECT_STATES = new Set(['CLIENT_SCREEN_SELECT']);
// 5: Offered and Offered Accepted -> OFFERED, OFFER_ACCEPTED
const OFFER_STATES = new Set(['OFFERED', 'OFFER_ACCEPTED']);
// 6: Joined -> JOINED, HIRED
const JOINED_STATES = new Set(['JOINED', 'HIRED']);
// 7: 90 Days Candidate Retention -> Trigger status keep none for just backend only like no points
const RETENTION_90_DAYS_STATES = new Set([]);

// Backward compatibility legacy aliases
const SCREENED_STATES = S1_REVIEW_STATES;
const SUBMITTED_STATES = S1_SCREEN_SELECT_STATES;
const INTERVIEW_STATES = CLIENT_SCREEN_SELECT_STATES;
const SELECTED_STATES = OFFER_STATES;

function isAssessmentRound(roundType) {
  if (!roundType) return false;
  const s = String(roundType).trim().toUpperCase();
  return s === 'ASSESSMENT' || s.includes('ASSESSMENT') || s.includes('TEST');
}

/**
 * Check if candidate has been selected / shortlisted for Round 2 of the interview pipeline,
 * explicitly excluding any Assessment round.
 * e.g. [Assessment, L1, L2, HR] -> Round 2 of interview is L2.
 * e.g. [L1, L2, HR] -> Round 2 of interview is L2.
 */
function isCandidateEligibleForRound2(cand) {
  if (!cand) return false;

  const status = String(cand.status || '').toUpperCase();
  const lateStates = [
    'ROUND_SELECTED_DIRECT_HR',
    'HR_ROUND_PENDING',
    'HR_SELECTED',
    'HR_ON_HOLD',
    'OFFERED',
    'OFFER_SENT',
    'OFFER_ACCEPTED',
    'ONBOARDING',
    'JOINED',
    'HIRED'
  ];
  if (lateStates.includes(status)) return true;
  if (cand.statusHistory?.some(h => lateStates.includes(String(h.status || '').toUpperCase()))) return true;

  const rounds = (Array.isArray(cand.rounds) && cand.rounds.length > 0)
    ? cand.rounds
    : (cand.job?.pipelineTemplate || []);

  const nonAssessmentRounds = rounds.filter(r => !isAssessmentRound(r.roundType));
  if (nonAssessmentRounds.length >= 2) {
    const round1 = nonAssessmentRounds[0];
    const round2 = nonAssessmentRounds[1];

    const activeRoundStates = [
      'SLOTS_NOT_PUBLISHED',
      'SLOTS_PUBLISHED',
      'SLOT_ASSIGNED',
      'SLOT_DETAILS_SHARED',
      'INTERVIEW_SCHEDULED',
      'INTERVIEW_CONFIRMED',
      'INTERVIEW_CONDUCTED',
      'PASSED',
      'ROUND_PASSED',
      'ROUND_SELECTED_NEXT'
    ];
    if (round2.status && activeRoundStates.includes(String(round2.status).toUpperCase())) return true;
    if (round1.status && ['PASSED', 'ROUND_PASSED'].includes(String(round1.status).toUpperCase())) return true;
  }

  if (status === 'ROUND_SELECTED_NEXT') return true;
  if (cand.statusHistory?.some(h => String(h.status || '').toUpperCase() === 'ROUND_SELECTED_NEXT')) return true;

  return false;
}

/**
 * Check if candidate has reached 90 days of retention
 * Strict requirement: Trigger Status keep none for just backend only like no points, but show as currently showing
 */
function isCandidateEligibleForRetention90(cand) {
  // Trigger status keep none for just backend only like no points
  return false;
}

/**
 * Extract authoritative timestamps for each milestone stage from a candidate's history and data
 */
function getMilestoneEventDates(cand) {
  if (!cand) return {};

  const history = Array.isArray(cand.statusHistory) ? cand.statusHistory : [];

  const findEarliestDate = (statuses) => {
    const statusSet = new Set(statuses.map(s => String(s).toUpperCase()));
    let earliest = null;
    for (const h of history) {
      if (h.status && statusSet.has(String(h.status).toUpperCase()) && h.changedAt) {
        const d = new Date(h.changedAt);
        if (!isNaN(d.getTime())) {
          if (!earliest || d < earliest) earliest = d;
        }
      }
    }
    return earliest;
  };

  const candCreated = cand.createdAt ? new Date(cand.createdAt) : null;
  const candUpdated = cand.updatedAt ? new Date(cand.updatedAt) : candCreated;

  // 1. S1 Review: Trigger Status: S1_REVIEW
  let s1ReviewDate = findEarliestDate(['S1_REVIEW']);
  if (!s1ReviewDate && String(cand.status || '').toUpperCase() === 'S1_REVIEW' && candCreated) {
    s1ReviewDate = candCreated;
  }

  // 2. S1 Screen Select: Trigger Status: S1_SCREEN_SELECT
  let s1ScreenSelectDate = findEarliestDate(['S1_SCREEN_SELECT']);
  if (!s1ScreenSelectDate && String(cand.status || '').toUpperCase() === 'S1_SCREEN_SELECT' && candUpdated) {
    s1ScreenSelectDate = candUpdated;
  }

  // 3. Client Screen Select: Trigger Status: CLIENT_SCREEN_SELECT
  let clientScreenSelectDate = findEarliestDate(['CLIENT_SCREEN_SELECT']);
  if (!clientScreenSelectDate && String(cand.status || '').toUpperCase() === 'CLIENT_SCREEN_SELECT' && candUpdated) {
    clientScreenSelectDate = candUpdated;
  }

  // 4. Round 2 Selection: when candidate was shortlisted/selected for Round 2 of interview (excluding assessment)
  let round2Date = findEarliestDate([
    'ROUND_SELECTED_NEXT', 'ROUND_SELECTED_DIRECT_HR',
    'HR_ROUND_PENDING', 'HR_SELECTED', 'HR_ON_HOLD'
  ]);
  const rounds = (Array.isArray(cand.rounds) && cand.rounds.length > 0)
    ? cand.rounds
    : (cand.job?.pipelineTemplate || []);
  const nonAssessmentRounds = rounds.filter(r => !isAssessmentRound(r.roundType));
  if (nonAssessmentRounds.length >= 2) {
    const r2 = nonAssessmentRounds[1];
    if (r2.scheduledAt && !isNaN(new Date(r2.scheduledAt).getTime())) {
      const d = new Date(r2.scheduledAt);
      if (!round2Date || d < round2Date) round2Date = d;
    }
    const r1 = nonAssessmentRounds[0];
    if (r1.passedAt && !isNaN(new Date(r1.passedAt).getTime())) {
      const d = new Date(r1.passedAt);
      if (!round2Date || d < round2Date) round2Date = d;
    }
  }

  // 5. Offered and Offered Accepted: Trigger Statuses: OFFERED, OFFER_ACCEPTED
  let offeredDate = findEarliestDate(['OFFERED', 'OFFER_ACCEPTED']);
  if (cand.offer?.offerDate && !isNaN(new Date(cand.offer.offerDate).getTime())) {
    const d = new Date(cand.offer.offerDate);
    if (!offeredDate || d < offeredDate) offeredDate = d;
  }
  if (cand.offer?.createdAt && !isNaN(new Date(cand.offer.createdAt).getTime())) {
    const d = new Date(cand.offer.createdAt);
    if (!offeredDate || d < offeredDate) offeredDate = d;
  }
  if (!offeredDate && OFFER_STATES.has(String(cand.status || '').toUpperCase()) && candUpdated) {
    offeredDate = candUpdated;
  }

  // 6. Joined: Trigger Statuses: JOINED, HIRED
  let joinedDate = findEarliestDate(['JOINED', 'HIRED']);
  if (cand.joiningDate && !isNaN(new Date(cand.joiningDate).getTime())) {
    const d = new Date(cand.joiningDate);
    if (!joinedDate || d < joinedDate) joinedDate = d;
  }
  if (cand.offer?.joiningDate && !isNaN(new Date(cand.offer.joiningDate).getTime())) {
    const d = new Date(cand.offer.joiningDate);
    if (!joinedDate || d < joinedDate) joinedDate = d;
  }
  if (!joinedDate && JOINED_STATES.has(String(cand.status || '').toUpperCase()) && candUpdated) {
    joinedDate = candUpdated;
  }

  // 7. 90 Days Candidate Retention: Trigger status keep none for just backend only like no points
  const retentionDate = null;

  return {
    s1ReviewDate,
    s1ScreenSelectDate,
    clientScreenSelectDate,
    round2Date,
    offeredDate,
    joinedDate,
    retentionDate
  };
}

/**
 * Helper to compute live metadata for a tournament
 */
function formatTournament(tournament, partnerId = null) {
  if (!tournament) return null;
  const tObj = typeof tournament.toObject === 'function' ? tournament.toObject() : { ...tournament };
  const now = new Date();
  const start = new Date(tObj.startDate);
  const end = new Date(tObj.endDate);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let status = 'ACTIVE';
  if (!tObj.isActive) {
    status = 'PAUSED';
  } else if (now > end) {
    status = 'COMPLETED';
  } else if (start > endOfToday) {
    status = 'UPCOMING';
  } else {
    status = 'ACTIVE';
  }

  const totalDurationMs = Math.max(end - start, 1);
  const elapsedMs = Math.max(0, Math.min(now - start, totalDurationMs));
  const progressPercent = status === 'COMPLETED' ? 100 : (status === 'UPCOMING' ? 0 : Math.round((elapsedMs / totalDurationMs) * 100));

  const timeRemainingMs = Math.max(0, end - now);
  const remainingDays = Math.floor(timeRemainingMs / (1000 * 60 * 60 * 24));
  const remainingHours = Math.floor((timeRemainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  const partnerIdStr = partnerId ? String(partnerId) : null;
  const hasJoined = partnerIdStr
    ? Array.isArray(tObj.participants) && tObj.participants.some(p => String(p.partner?._id || p.partner || p) === partnerIdStr)
    : false;

  const officialRules = {
    s1ReviewPoints: 10,
    s1ScreenSelectPoints: 10,
    clientScreenSelectPoints: 10,
    round2Points: 10,
    offeredPoints: 20,
    joinedPoints: 20,
    retention90Points: 20,
    ...(tObj.rules || {})
  };

  const defaultBadges = [
    { icon: '💎', title: 'Platinum Tier', desc: 'Top 1%–10% performing partners on the leaderboard' },
    { icon: '🥇', title: 'Gold Tier', desc: 'Top 11%–25% performing partners on the leaderboard' },
    { icon: '🥈', title: 'Silver Tier', desc: 'Top 26%–50% performing partners on the leaderboard' },
    { icon: '🥉', title: 'Bronze Tier', desc: 'Top 51%–100% performing partners on the leaderboard' }
  ];

  const recognitionBadges = (Array.isArray(tObj.recognitionBadges) && tObj.recognitionBadges.length > 0)
    ? tObj.recognitionBadges
    : defaultBadges;

  return {
    ...tObj,
    rules: officialRules,
    recognitionBadges,
    liveStatus: status,
    progressPercent,
    remainingDays,
    remainingHours,
    hasJoined: Boolean(hasJoined),
    timeRemainingFormatted: status === 'COMPLETED' ? 'Tournament Ended' : (status === 'UPCOMING' ? 'Starts Soon' : `${remainingDays}d ${remainingHours}h remaining`)
  };
}

/**
 * Get or initialize current active tournament (defaults to latest active or latest created)
 */
async function getCurrentTournament(partnerId = null) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Try finding currently running active tournament
  let tournament = await PartnerTournament.findOne({
    isActive: true,
    status: { $nin: ['PAUSED', 'COMPLETED'] },
    startDate: { $lte: endOfToday },
    endDate: { $gte: startOfToday }
  }).sort({ createdAt: -1 });

  // If none active right now, try finding any active or latest
  if (!tournament) {
    tournament = await PartnerTournament.findOne({ isActive: true }).sort({ createdAt: -1 });
  }

  if (!tournament) {
    tournament = await PartnerTournament.findOne().sort({ createdAt: -1 });
  }

  if (!tournament) {
    // Automatically seed an active tournament covering the current month if none exists
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    tournament = await PartnerTournament.create({
      title: 'Syncro1 Vendor Performance Challenge 🏆',
      description: 'Quality + Speed + Consistency = Higher Score & Recognition 🏆',
      startDate: startOfMonth,
      endDate: endOfMonth,
      status: 'ACTIVE',
      isActive: true
    });
  }

  return formatTournament(tournament, partnerId);
}

/**
 * Get all tournaments (active, upcoming, and past/completed)
 * Optionally enriched with partner enrollment and live standing if partnerId is provided
 */
async function getAllTournaments(partnerId = null) {
  let tournaments = await PartnerTournament.find().sort({ startDate: -1, createdAt: -1 });

  if (!tournaments || tournaments.length === 0) {
    await getCurrentTournament(partnerId);
    tournaments = await PartnerTournament.find().sort({ startDate: -1, createdAt: -1 });
  }

  const formattedTournaments = tournaments.map(t => {
    const formatted = formatTournament(t, partnerId);
    formatted.participantsCount = (t.participants && t.participants.length) || 0;
    return formatted;
  });

  if (!partnerId) {
    return formattedTournaments.map(t => ({
      ...t,
      hasJoined: false,
      userRank: null,
      userTier: null,
      userTierName: null,
      userPercentile: null,
      userPoints: 0,
      userBreakdown: null,
      userBadges: []
    }));
  }

  const partnerIdStr = String(partnerId);

  // For each tournament, determine if partner has joined and compute their rank and points
  const enriched = await Promise.all(formattedTournaments.map(async (t) => {
    const isParticipant = Array.isArray(t.participants) && t.participants.some(p => String(p.partner?._id || p.partner || p) === partnerIdStr);

    const hasJoined = Boolean(isParticipant);

    if (!hasJoined) {
      return {
        ...t,
        hasJoined: false,
        userRank: null,
        userTier: null,
        userTierName: null,
        userPercentile: null,
        userPoints: 0,
        userBreakdown: null,
        userBadges: []
      };
    }

    try {
      const stats = await getPartnerProgramStats(partnerId, { tournamentId: t._id, sync: false });
      return {
        ...t,
        hasJoined: true,
        userRank: stats.rank,
        userTier: stats.tier,
        userTierName: stats.tierName,
        userPercentile: stats.percentile,
        userPoints: stats.totalPoints,
        userBreakdown: stats.breakdown,
        userBadges: stats.badges || [],
        participantsCount: stats.totalParticipants || t.participantsCount
      };
    } catch (err) {
      return {
        ...t,
        hasJoined: true,
        userRank: null,
        userTier: null,
        userTierName: null,
        userPercentile: null,
        userPoints: 0,
        userBreakdown: null,
        userBadges: []
      };
    }
  }));

  return enriched;
}

/**
 * Get a specific tournament by ID with formatted live status
 */
async function getTournamentById(id, partnerId = null) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return getCurrentTournament(partnerId);
  }
  const tournament = await PartnerTournament.findById(id);
  if (!tournament) {
    return getCurrentTournament(partnerId);
  }
  return formatTournament(tournament, partnerId);
}

/**
 * Create a new tournament / program
 */
async function createTournament(data, userId) {
  const { title, description, bgImage, startDate, endDate, isActive, rules, recognitionBadges } = data;
  const now = new Date();
  const start = startDate ? new Date(startDate) : now;
  const end = endDate ? new Date(endDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let status = 'ACTIVE';
  const activeFlag = isActive !== undefined ? Boolean(isActive) : true;
  if (!activeFlag) status = 'PAUSED';
  else if (now > end) status = 'COMPLETED';
  else if (start > endOfToday) status = 'UPCOMING';
  else status = 'ACTIVE';

  const tournament = await PartnerTournament.create({
    title: title || 'Syncro1 Vendor Performance Challenge 🏆',
    description: description || 'Quality + Speed + Consistency = Higher Score & Recognition 🏆',
    bgImage: bgImage || '',
    startDate: start,
    endDate: end,
    isActive: activeFlag,
    status,
    rules: rules || {},
    recognitionBadges: Array.isArray(recognitionBadges) && recognitionBadges.length > 0 ? recognitionBadges : undefined,
    createdBy: userId
  });

  // New tournament starts completely clean with 0 participants.
  // Talent partners will only participate and earn points once they explicitly enter the challenge.
  return formatTournament(tournament);
}

/**
 * Update an existing tournament by ID
 */
async function updateTournament(id, data, userId) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Valid Tournament ID is required');
  }

  const tournament = await PartnerTournament.findById(id);
  if (!tournament) {
    throw new Error('Tournament not found');
  }

  const { title, description, bgImage, startDate, endDate, isActive, rules, recognitionBadges } = data;
  const now = new Date();
  const start = startDate ? new Date(startDate) : tournament.startDate;
  const end = endDate ? new Date(endDate) : tournament.endDate;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let status = 'ACTIVE';
  const activeFlag = isActive !== undefined ? Boolean(isActive) : tournament.isActive;
  if (!activeFlag) status = 'PAUSED';
  else if (now > end) status = 'COMPLETED';
  else if (start > endOfToday) status = 'UPCOMING';
  else status = 'ACTIVE';

  if (title) tournament.title = title;
  if (description !== undefined) tournament.description = description;
  if (bgImage !== undefined) tournament.bgImage = bgImage;
  tournament.startDate = start;
  tournament.endDate = end;
  tournament.isActive = activeFlag;
  tournament.status = status;
  if (rules) tournament.rules = { ...tournament.rules, ...rules };
  if (recognitionBadges !== undefined) {
    tournament.recognitionBadges = Array.isArray(recognitionBadges) ? recognitionBadges : [];
  }
  tournament.createdBy = userId || tournament.createdBy;

  await tournament.save();

  // Recalibrate points for updated date range
  try {
    await backfillExistingPoints(tournament._id);
  } catch (err) {
    console.error('[PARTNER_PROGRAM] Auto-recalculate on update failed:', err.message);
  }

  return formatTournament(tournament);
}

/**
 * Delete a tournament and its associated points events
 */
async function deleteTournament(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Valid Tournament ID is required');
  }

  await PartnerTournament.findByIdAndDelete(id);
  await PartnerPointEvent.deleteMany({ tournament: id });
  return { success: true, message: 'Tournament deleted successfully' };
}

/**
 * Save or update tournament configuration (backward compatibility)
 */
async function saveTournament(data, userId) {
  const { id } = data;
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    return updateTournament(id, data, userId);
  } else {
    // If an active one exists, update it, otherwise create new
    const existing = await PartnerTournament.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (existing) {
      return updateTournament(existing._id, data, userId);
    } else {
      return createTournament(data, userId);
    }
  }
}

/**
 * Synchronize and award eligible candidate milestone points strictly for a specific partner in a tournament.
 * Idempotent: Never wipes existing points indiscriminately; only awards newly reached milestones.
 */
async function syncPartnerCandidatesForTournament(tournamentId, partnerId, options = {}) {
  const { silent = false } = options;
  if (!tournamentId || !partnerId) return;

  const tournament = await PartnerTournament.findById(tournamentId);
  if (!tournament) return;

  const start = new Date(tournament.startDate);
  const end = new Date(tournament.endDate);

  // Fetch already recorded milestone events for this partner in this tournament to prevent duplicate awards & redundant DB operations
  const existingEvents = await PartnerPointEvent.find({
    tournament: tournamentId,
    partner: partnerId,
    stage: { $ne: STAGES.MANUAL_ADJUSTMENT }
  }).select('candidate stage').lean();

  const awardedSet = new Set(
    existingEvents.map(e => `${String(e.candidate)}_${e.stage}`)
  );

  const candidates = await Candidate.find({
    submittedBy: partnerId
  })
    .populate('job', 'title company')
    .populate('company', 'companyName')
    .lean();

  const isInWindow = (d) => Boolean(d && !isNaN(d.getTime()) && d >= start && d <= end);

  for (const cand of candidates) {
    try {
      const candidateDoc = {
        ...cand,
        jobTitle: cand.job?.title || 'Position',
        companyName: cand.company?.companyName || 'Company'
      };

      const candIdStr = String(cand._id);
      const status = String(cand.status || '').toUpperCase();
      const isNegative = ['CONSENT_DENIED', 'CLIENT_PORTAL_DUPLICATE', 'COMPANY_PORTAL_DUPLICATE', 'ADMIN_REJECTED', 'WITHDRAWN', 'CANDIDATE_DROP'].includes(status);

      // If candidate transitioned to a terminal negative state, purge their candidate points for this tournament
      if (isNegative) {
        await PartnerPointEvent.deleteMany({
          tournament: tournamentId,
          partner: partnerId,
          candidate: cand._id,
          stage: { $ne: STAGES.MANUAL_ADJUSTMENT }
        });
        continue;
      }

      const mDates = getMilestoneEventDates(cand);
      const historyStatuses = new Set((cand.statusHistory || []).map(h => String(h.status || '').toUpperCase()));
      const hasReachedStatus = (stateSet) => stateSet.has(status) || Array.from(stateSet).some(s => historyStatuses.has(s));

      const isS1ReviewEligible = Boolean(cand.email && cand.firstName && hasReachedStatus(S1_REVIEW_STATES));
      const isS1ScreenSelectEligible = hasReachedStatus(S1_SCREEN_SELECT_STATES);
      const isClientScreenSelectEligible = hasReachedStatus(CLIENT_SCREEN_SELECT_STATES);
      const isRound2Eligible = isCandidateEligibleForRound2(cand);
      const isOfferedEligible = hasReachedStatus(OFFER_STATES);
      const isJoinedEligible = hasReachedStatus(JOINED_STATES);
      const isRetention90Eligible = isCandidateEligibleForRetention90(cand);

      // 1. Award S1 Review (10 Points) - strictly within tournament window
      if (isS1ReviewEligible && isInWindow(mDates.s1ReviewDate) && !awardedSet.has(`${candIdStr}_${STAGES.S1_REVIEW}`)) {
        await awardPoints(candidateDoc, STAGES.S1_REVIEW, tournamentId, mDates.s1ReviewDate, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.S1_REVIEW}`);
      }

      // 2. Award S1 Screen Select (10 Points) - strictly within tournament window
      if (isS1ScreenSelectEligible && isInWindow(mDates.s1ScreenSelectDate) && !awardedSet.has(`${candIdStr}_${STAGES.S1_SCREEN_SELECT}`)) {
        await awardPoints(candidateDoc, STAGES.S1_SCREEN_SELECT, tournamentId, mDates.s1ScreenSelectDate, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.S1_SCREEN_SELECT}`);
      }

      // 3. Award Client Screen Select (10 Points) - strictly within tournament window
      if (isClientScreenSelectEligible && isInWindow(mDates.clientScreenSelectDate) && !awardedSet.has(`${candIdStr}_${STAGES.CLIENT_SCREEN_SELECT}`)) {
        await awardPoints(candidateDoc, STAGES.CLIENT_SCREEN_SELECT, tournamentId, mDates.clientScreenSelectDate, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.CLIENT_SCREEN_SELECT}`);
      }

      // 4. Award Round 2 Selection (10 Points) - strictly within tournament window
      if (isRound2Eligible && isInWindow(mDates.round2Date) && !awardedSet.has(`${candIdStr}_${STAGES.ROUND_2_SELECTION}`)) {
        await awardPoints(candidateDoc, STAGES.ROUND_2_SELECTION, tournamentId, mDates.round2Date, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.ROUND_2_SELECTION}`);
      }

      // 5. Award Offered & Offered Accepted (20 Points) - strictly within tournament window
      if (isOfferedEligible && isInWindow(mDates.offeredDate) && !awardedSet.has(`${candIdStr}_${STAGES.OFFERED}`)) {
        await awardPoints(candidateDoc, STAGES.OFFERED, tournamentId, mDates.offeredDate, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.OFFERED}`);
      }

      // 6. Award Joined (20 Points) - strictly within tournament window
      if (isJoinedEligible && isInWindow(mDates.joinedDate) && !awardedSet.has(`${candIdStr}_${STAGES.JOINED}`)) {
        await awardPoints(candidateDoc, STAGES.JOINED, tournamentId, mDates.joinedDate, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.JOINED}`);
      }

      // 7. Award 90 days Candidate Retention (20 Points) - strictly within tournament window
      if (isRetention90Eligible && isInWindow(mDates.retentionDate) && !awardedSet.has(`${candIdStr}_${STAGES.RETENTION_90_DAYS}`)) {
        await awardPoints(candidateDoc, STAGES.RETENTION_90_DAYS, tournamentId, mDates.retentionDate, { silent });
        awardedSet.add(`${candIdStr}_${STAGES.RETENTION_90_DAYS}`);
      }
    } catch (err) {
      console.error(`[PARTNER_PROGRAM] Error syncing candidate ${cand._id} for partner ${partnerId}:`, err.message);
    }
  }
}

/**
 * Enter / Sign up partner for a tournament
 */
async function enterTournament(tournamentId, partnerId) {
  if (!tournamentId || !mongoose.Types.ObjectId.isValid(tournamentId)) {
    throw new Error('Valid Tournament ID is required');
  }
  if (!partnerId || !mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error('Valid Partner ID is required');
  }

  const tournament = await PartnerTournament.findById(tournamentId);
  if (!tournament) {
    throw new Error('Tournament not found');
  }

  if (!tournament.participants) {
    tournament.participants = [];
  }

  const partnerIdStr = String(partnerId);
  const alreadyJoined = tournament.participants.some(
    p => String(p.partner?._id || p.partner || p) === partnerIdStr
  );

  if (!alreadyJoined) {
    tournament.participants.push({
      partner: partnerId,
      joinedAt: new Date()
    });
    await tournament.save();
  }

  // Sync any candidates this partner submitted that match the tournament timeline
  await syncPartnerCandidatesForTournament(tournament._id, partnerId);

  // Retrieve current updated stats
  const stats = await getPartnerProgramStats(partnerId, { tournamentId: tournament._id });

  return {
    success: true,
    alreadyJoined,
    message: alreadyJoined ? 'You are already enrolled in this tournament' : 'Successfully entered tournament! 🏆',
    tournament: formatTournament(tournament),
    stats
  };
}

/**
 * Idempotently award points for a specific milestone stage
 */
async function awardPoints(candidateDoc, stage, tournamentId = null, awardedDate = new Date(), options = {}) {
  const { silent = false } = options;
  if (!candidateDoc) return null;

  // Partner ID may be candidateDoc.submittedBy (id or object)
  const partnerId = candidateDoc.submittedBy?._id || candidateDoc.submittedBy;
  if (!partnerId) return null;

  const points = STAGE_POINTS[stage];
  if (!points) return null;

  const candidateId = candidateDoc._id;
  if (!candidateId) return null;

  const effectiveTournamentId = (tournamentId && mongoose.Types.ObjectId.isValid(tournamentId)) ? tournamentId : null;

  // Pre-check: Avoid duplicate DB write attempts and repetitive logs if already awarded
  const existingEvent = await PartnerPointEvent.findOne({
    tournament: effectiveTournamentId,
    partner: partnerId,
    candidate: candidateId,
    stage
  }).lean();

  if (existingEvent) {
    return existingEvent;
  }

  let jobId = candidateDoc.job?._id || candidateDoc.job || null;
  let companyId = candidateDoc.company?._id || candidateDoc.company || null;

  let jobTitle = candidateDoc.jobTitle || candidateDoc.job?.title || '';
  let companyName = candidateDoc.companyName || candidateDoc.company?.companyName || '';

  // If company or job info is missing, try to resolve from Job model
  if ((!companyId || !jobTitle) && jobId && mongoose.Types.ObjectId.isValid(jobId)) {
    try {
      const Job = mongoose.model('Job');
      const jobDoc = await Job.findById(jobId).select('company title').populate('company', 'companyName').lean();
      if (jobDoc) {
        if (!companyId) companyId = jobDoc.company?._id || jobDoc.company;
        if (!jobTitle) jobTitle = jobDoc.title;
        if (!companyName && jobDoc.company?.companyName) companyName = jobDoc.company.companyName;
      }
    } catch (_) {}
  }

  const metadata = {
    candidateName: `${candidateDoc.firstName || ''} ${candidateDoc.lastName || ''}`.trim() || 'Candidate',
    candidateEmail: candidateDoc.email || '',
    jobTitle: jobTitle || 'Job Position',
    companyName: companyName || 'Company'
  };

  try {
    const eventPayload = {
      partner: partnerId,
      candidate: candidateId,
      stage,
      points,
      metadata,
      awardedAt: awardedDate || new Date()
    };

    if (effectiveTournamentId) {
      eventPayload.tournament = effectiveTournamentId;
    }
    if (jobId && mongoose.Types.ObjectId.isValid(jobId)) {
      eventPayload.job = jobId;
    }
    if (companyId && mongoose.Types.ObjectId.isValid(companyId)) {
      eventPayload.company = companyId;
    }

    const event = await PartnerPointEvent.create(eventPayload);

    if (!silent) {
      console.log(`[PARTNER_PROGRAM_POINTS] Awarded ${points} pts to partner ${partnerId} for candidate ${candidateId} stage ${stage} (Tournament: ${effectiveTournamentId})`);
    }
    return event;
  } catch (err) {
    // Duplicate key error (code 11000) indicates points already awarded for this milestone in this tournament
    if (err.code === 11000) {
      return null;
    }
    console.error(`[PARTNER_PROGRAM_POINTS] Error awarding points:`, err.message);
    return null;
  }
}

/**
 * Process candidate state transitions in real time and award eligible stages across ALL active tournaments
 */
async function processCandidateStageChange(candidateDoc) {
  if (!candidateDoc || !candidateDoc._id) return;

  // Fetch full/fresh candidate document if needed
  let doc = candidateDoc;
  try {
    const fresh = await Candidate.findById(candidateDoc._id)
      .populate('job', 'title company')
      .populate('company', 'companyName')
      .lean();
    if (fresh) doc = fresh;
  } catch (_) {}

  const partnerId = doc.submittedBy?._id || doc.submittedBy;
  if (!partnerId) return;

  const status = doc.status || 'DRAFT';

  // Terminal / rejected states do not get real-time advancement points
  if (['CONSENT_DENIED', 'CLIENT_PORTAL_DUPLICATE', 'COMPANY_PORTAL_DUPLICATE', 'ADMIN_REJECTED', 'WITHDRAWN', 'CANDIDATE_DROP'].includes(status)) {
    return;
  }

  const now = new Date();

  // Find all active tournaments running currently whose date window covers today or are ACTIVE
  let activeTournaments = [];
  try {
    activeTournaments = await PartnerTournament.find({
      isActive: true,
      status: { $nin: ['PAUSED', 'COMPLETED'] }
    });
  } catch (err) {
    console.error('[PARTNER_PROGRAM] Error querying active tournaments:', err.message);
  }

  if (!activeTournaments || activeTournaments.length === 0) {
    try {
      activeTournaments = await PartnerTournament.find({ isActive: true });
    } catch (_) {}
  }

  if (!activeTournaments || activeTournaments.length === 0) {
    const current = await getCurrentTournament();
    if (current && current.isActive !== false) {
      activeTournaments = [current];
    }
  }

  if (!activeTournaments || activeTournaments.length === 0) {
    return;
  }

  const candCreated = new Date(doc.createdAt || now);

  const historyStatuses = new Set((doc.statusHistory || []).map(h => String(h.status || '').toUpperCase()));
  const hasReachedStatus = (stateSet) => stateSet.has(status) || Array.from(stateSet).some(s => historyStatuses.has(s));

  const isS1ReviewEligible = Boolean(doc.email && doc.firstName && hasReachedStatus(S1_REVIEW_STATES));
  const isS1ScreenSelectEligible = hasReachedStatus(S1_SCREEN_SELECT_STATES);
  const isClientScreenSelectEligible = hasReachedStatus(CLIENT_SCREEN_SELECT_STATES);
  const isRound2Eligible = isCandidateEligibleForRound2(doc);
  const isOfferedEligible = hasReachedStatus(OFFER_STATES);
  const isJoinedEligible = hasReachedStatus(JOINED_STATES);
  const isRetention90Eligible = isCandidateEligibleForRetention90(doc);

  // Award points independently for each active tournament ONLY IF partner has entered the tournament
  const partnerIdStr = String(partnerId);
  for (const activeTournament of activeTournaments) {
    const isEnrolled = Array.isArray(activeTournament.participants) &&
      activeTournament.participants.some(p => String(p.partner?._id || p.partner || p) === partnerIdStr);

    if (!isEnrolled) {
      // Talent partner has not entered this tournament challenge
      continue;
    }

    const tournamentId = activeTournament._id;
    const start = new Date(activeTournament.startDate);
    const end = new Date(activeTournament.endDate);

    // Strictly ensure tournament is currently running and active
    if (now < start || now > end) {
      continue;
    }

    const mDates = getMilestoneEventDates(doc);
    const isInWindow = (d) => Boolean(d && !isNaN(d.getTime()) && d >= start && d <= end);

    // 1. S1 Review (10 Points)
    if (isS1ReviewEligible && isInWindow(mDates.s1ReviewDate || now)) {
      await awardPoints(doc, STAGES.S1_REVIEW, tournamentId, mDates.s1ReviewDate || now);
    }

    // 2. S1 Screen Select (10 Points)
    if (isS1ScreenSelectEligible && isInWindow(mDates.s1ScreenSelectDate || now)) {
      await awardPoints(doc, STAGES.S1_SCREEN_SELECT, tournamentId, mDates.s1ScreenSelectDate || now);
    }

    // 3. Client Screen Select (10 Points)
    if (isClientScreenSelectEligible && isInWindow(mDates.clientScreenSelectDate || now)) {
      await awardPoints(doc, STAGES.CLIENT_SCREEN_SELECT, tournamentId, mDates.clientScreenSelectDate || now);
    }

    // 4. Round 2 Selection (10 Points - 2nd interview round excluding assessment)
    if (isRound2Eligible && isInWindow(mDates.round2Date || now)) {
      await awardPoints(doc, STAGES.ROUND_2_SELECTION, tournamentId, mDates.round2Date || now);
    }

    // 5. Offered & Accepted (20 Points)
    if (isOfferedEligible && isInWindow(mDates.offeredDate || now)) {
      await awardPoints(doc, STAGES.OFFERED, tournamentId, mDates.offeredDate || now);
    }

    // 6. Joined (20 Points)
    if (isJoinedEligible && isInWindow(mDates.joinedDate || now)) {
      await awardPoints(doc, STAGES.JOINED, tournamentId, mDates.joinedDate || now);
    }

    // 7. 90 days Candidate Retention (20 Points)
    if (isRetention90Eligible && isInWindow(mDates.retentionDate || now)) {
      await awardPoints(doc, STAGES.RETENTION_90_DAYS, tournamentId, mDates.retentionDate || now);
    }
  }
}

/**
 * Compute partner ranking tier and badge based on tournament percentile:
 * 1 - 10%:   Platinum (💎)
 * 11 - 25%:  Gold (🥇)
 * 26 - 50%:  Silver (🥈)
 * 51 - 100%: Bronze (🥉)
 */
function getTierFromRank(rank, totalParticipants) {
  if (!rank || rank <= 0) {
    return {
      tier: 'UNRANKED',
      name: 'Unranked',
      percentile: 100,
      badge: null
    };
  }

  const total = Math.max(1, totalParticipants || 1);
  const percentile = (rank / total) * 100;

  if (rank === 1 || percentile <= 10) {
    return {
      tier: 'PLATINUM',
      name: 'Platinum Tier',
      range: 'Top 1–10%',
      percentile,
      badge: {
        type: 'PLATINUM',
        title: 'Platinum Tier Partner (Top 1–10%)',
        icon: '💎'
      }
    };
  } else if (percentile <= 25) {
    return {
      tier: 'GOLD',
      name: 'Gold Tier',
      range: 'Top 11–25%',
      percentile,
      badge: {
        type: 'GOLD',
        title: 'Gold Tier Partner (Top 11–25%)',
        icon: '🥇'
      }
    };
  } else if (percentile <= 50) {
    return {
      tier: 'SILVER',
      name: 'Silver Tier',
      range: 'Top 26–50%',
      percentile,
      badge: {
        type: 'SILVER',
        title: 'Silver Tier Partner (Top 26–50%)',
        icon: '🥈'
      }
    };
  } else {
    return {
      tier: 'BRONZE',
      name: 'Bronze Tier',
      range: 'Top 51–100%',
      percentile,
      badge: {
        type: 'BRONZE',
        title: 'Bronze Tier Partner (Top 51–100%)',
        icon: '🥉'
      }
    };
  }
}

/**
 * Calculate Leaderboard with rankings, point breakdown and recognition badges
 * Scoped strictly to the selected tournament (or current active tournament if none specified)
 */
async function getLeaderboard({ limit = null, tournamentId = null } = {}) {
  let effectiveTournamentId = tournamentId;
  let tournamentDoc = null;
  if (!effectiveTournamentId || effectiveTournamentId === 'current') {
    tournamentDoc = await getCurrentTournament();
    if (tournamentDoc) {
      effectiveTournamentId = tournamentDoc._id;
    }
  } else if (effectiveTournamentId !== 'all' && mongoose.Types.ObjectId.isValid(effectiveTournamentId)) {
    tournamentDoc = await PartnerTournament.findById(effectiveTournamentId).populate('participants.partner').lean();
  }

  // Build lookup of partners who have actually joined/entered this tournament
  const enrolledPartnerMap = new Map();
  if (tournamentDoc && Array.isArray(tournamentDoc.participants)) {
    for (const p of tournamentDoc.participants) {
      const pid = String(p.partner?._id || p.partner || p);
      if (pid) {
        enrolledPartnerMap.set(pid, {
          partnerId: pid,
          partnerObj: (p.partner && typeof p.partner === 'object' && p.partner._id) ? p.partner : null,
          joinedAt: p.joinedAt || new Date()
        });
      }
    }
  }

  const matchStage = {};
  if (effectiveTournamentId && effectiveTournamentId !== 'all' && mongoose.Types.ObjectId.isValid(effectiveTournamentId)) {
    matchStage.tournament = new mongoose.Types.ObjectId(effectiveTournamentId);
  }

  const agg = [
    { $match: matchStage },
    {
      $group: {
        _id: '$partner',
        totalPoints: { $sum: '$points' },
        s1ReviewCount: {
          $sum: { $cond: [{ $in: ['$stage', [STAGES.S1_REVIEW, 'SCREENED']] }, 1, 0] }
        },
        s1ScreenSelectCount: {
          $sum: { $cond: [{ $in: ['$stage', [STAGES.S1_SCREEN_SELECT, 'SUBMITTED_TO_COMPANY']] }, 1, 0] }
        },
        clientScreenSelectCount: {
          $sum: { $cond: [{ $in: ['$stage', [STAGES.CLIENT_SCREEN_SELECT, 'INTERVIEW_SCHEDULED']] }, 1, 0] }
        },
        round2Count: {
          $sum: { $cond: [{ $in: ['$stage', [STAGES.ROUND_2_SELECTION, 'SELECTED']] }, 1, 0] }
        },
        offeredCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.OFFERED] }, 1, 0] }
        },
        joinedCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.JOINED] }, 1, 0] }
        },
        retention90Count: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.RETENTION_90_DAYS] }, 1, 0] }
        },
        manualPoints: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.MANUAL_ADJUSTMENT] }, '$points', 0] }
        },
        lastAwardedAt: { $max: '$awardedAt' }
      }
    },
    {
      $lookup: {
        from: 'staffingpartners',
        localField: '_id',
        foreignField: '_id',
        as: 'partnerDetails'
      }
    },
    { $unwind: { path: '$partnerDetails', preserveNullAndEmptyArrays: true } }
  ];

  const results = await PartnerPointEvent.aggregate(agg);

  // Filter: ONLY include partners who have actually joined this tournament OR are simulated manual partners created for this program
  const eligibleResults = results.filter(item => {
    const pIdStr = String(item._id);
    return enrolledPartnerMap.has(pIdStr) || Boolean(item.partnerDetails?.isManualProgramPartner);
  });

  // Calculate points strictly by rule: 10, 10, 10, 10, 20, 20, 20
  const processedPartners = eligibleResults.map(item => {
    const s1ReviewPts = (item.s1ReviewCount || 0) * 10;
    const s1ScreenSelectPts = (item.s1ScreenSelectCount || 0) * 10;
    const clientScreenSelectPts = (item.clientScreenSelectCount || 0) * 10;
    const round2Pts = (item.round2Count || 0) * 10;
    const offeredPts = (item.offeredCount || 0) * 20;
    const joinedPts = (item.joinedCount || 0) * 20;
    const retention90Pts = (item.retention90Count || 0) * 20;
    const manualPts = item.manualPoints || 0;

    const totalPts = s1ReviewPts + s1ScreenSelectPts + clientScreenSelectPts + round2Pts + offeredPts + joinedPts + retention90Pts + manualPts;

    const partnerName = item.partnerDetails ?
      `${item.partnerDetails.firstName || ''} ${item.partnerDetails.lastName || ''}`.trim() || 'Partner'
      : 'Partner';

    return {
      partnerId: item._id,
      partnerName,
      firmName: item.partnerDetails?.firmName || 'Partner Firm',
      city: item.partnerDetails?.city || '',
      state: item.partnerDetails?.state || '',
      totalPoints: totalPts,
      isManualProgramPartner: Boolean(item.partnerDetails?.isManualProgramPartner),
      breakdown: {
        s1_review: { count: item.s1ReviewCount || 0, points: s1ReviewPts },
        s1_screen_select: { count: item.s1ScreenSelectCount || 0, points: s1ScreenSelectPts },
        client_screen_select: { count: item.clientScreenSelectCount || 0, points: clientScreenSelectPts },
        round_2_selection: { count: item.round2Count || 0, points: round2Pts },
        offered: { count: item.offeredCount || 0, points: offeredPts },
        joined: { count: item.joinedCount || 0, points: joinedPts },
        retention_90_days: { count: item.retention90Count || 0, points: retention90Pts },
        manual: { count: item.manualPoints ? 1 : 0, points: manualPts },
        screened: { count: item.s1ReviewCount || 0, points: s1ReviewPts },
        submitted: { count: item.s1ScreenSelectCount || 0, points: s1ScreenSelectPts },
        interviewed: { count: item.clientScreenSelectCount || 0, points: clientScreenSelectPts },
        selected: { count: item.round2Count || 0, points: round2Pts }
      },
      lastAwardedAt: item.lastAwardedAt,
      joinedCount: item.joinedCount || 0,
      round2Count: item.round2Count || 0
    };
  });

  // Sort by official tournament total points descending
  processedPartners.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.joinedCount !== a.joinedCount) return b.joinedCount - a.joinedCount;
    if (b.round2Count !== a.round2Count) return b.round2Count - a.round2Count;
    return String(a.partnerId).localeCompare(String(b.partnerId));
  });

  // For partners who entered the tournament but have not scored points yet (0 points),
  // include them in rankings below the partners with points.
  const rankedPartnerIdSet = new Set(processedPartners.map(p => String(p.partnerId)));
  const unrankedEnrolled = [];
  for (const [pid, info] of enrolledPartnerMap.entries()) {
    if (!rankedPartnerIdSet.has(pid)) {
      unrankedEnrolled.push(info);
    }
  }

  // Total participants in the tournament
  const totalParticipants = Math.max(1, processedPartners.length + unrankedEnrolled.length);

  const rankedPartners = processedPartners.map((item, index) => {
    const rank = index + 1;
    const tierInfo = getTierFromRank(rank, totalParticipants);
    const badges = tierInfo.badge ? [tierInfo.badge] : [];

    return {
      rank,
      tier: tierInfo.tier,
      tierName: tierInfo.name,
      percentile: Math.round(tierInfo.percentile * 10) / 10,
      partnerId: item.partnerId,
      partnerName: item.partnerName,
      firmName: item.firmName,
      city: item.city,
      state: item.state,
      totalPoints: item.totalPoints,
      isManualProgramPartner: item.isManualProgramPartner,
      breakdown: item.breakdown,
      badges,
      lastAwardedAt: item.lastAwardedAt
    };
  });

  if (unrankedEnrolled.length > 0) {
    const missingIds = unrankedEnrolled.filter(e => !e.partnerObj).map(e => e.partnerId);
    let missingDocsMap = new Map();
    if (missingIds.length > 0) {
      const fetched = await StaffingPartner.find({ _id: { $in: missingIds } }).lean();
      for (const f of fetched) {
        missingDocsMap.set(String(f._id), f);
      }
    }

    for (const info of unrankedEnrolled) {
      const pDoc = info.partnerObj || missingDocsMap.get(info.partnerId);
      const nextRank = rankedPartners.length + 1;
      const tierInfo = getTierFromRank(nextRank, totalParticipants);
      const badges = tierInfo.badge ? [tierInfo.badge] : [];

      rankedPartners.push({
        rank: nextRank,
        tier: tierInfo.tier,
        tierName: tierInfo.name,
        percentile: Math.round(tierInfo.percentile * 10) / 10,
        partnerId: info.partnerId,
        partnerName: pDoc ? `${pDoc.firstName || ''} ${pDoc.lastName || ''}`.trim() || 'Partner' : 'Partner',
        firmName: pDoc?.firmName || 'Partner Firm',
        city: pDoc?.city || '',
        state: pDoc?.state || '',
        totalPoints: 0,
        isManualProgramPartner: Boolean(pDoc?.isManualProgramPartner),
        breakdown: {
          s1_review: { count: 0, points: 0 },
          s1_screen_select: { count: 0, points: 0 },
          client_screen_select: { count: 0, points: 0 },
          round_2_selection: { count: 0, points: 0 },
          offered: { count: 0, points: 0 },
          joined: { count: 0, points: 0 },
          retention_90_days: { count: 0, points: 0 },
          manual: { count: 0, points: 0 },
          screened: { count: 0, points: 0 },
          submitted: { count: 0, points: 0 },
          interviewed: { count: 0, points: 0 },
          selected: { count: 0, points: 0 }
        },
        badges,
        lastAwardedAt: null
      });
    }
  }

  const topLimit = (limit && Number(limit) > 0) ? rankedPartners.slice(0, Number(limit)) : rankedPartners;

  return {
    totalParticipants: rankedPartners.length,
    leaderboard: topLimit,
    allRankings: rankedPartners
  };
}

/**
 * Get detailed stats and recent transactions for a single partner in a tournament
 */
async function getPartnerProgramStats(partnerId, { tournamentId = null, sync = false } = {}) {
  let effectiveTournamentId = tournamentId;
  let tournamentDoc = null;
  if (!effectiveTournamentId || effectiveTournamentId === 'current') {
    tournamentDoc = await getCurrentTournament();
    if (tournamentDoc) {
      effectiveTournamentId = tournamentDoc._id;
    }
  } else if (effectiveTournamentId !== 'all' && mongoose.Types.ObjectId.isValid(effectiveTournamentId)) {
    tournamentDoc = await PartnerTournament.findById(effectiveTournamentId).select('participants').lean();
  }

  // Only sync candidate points if explicitly requested (read queries default to sync: false)
  if (sync && tournamentDoc && effectiveTournamentId && effectiveTournamentId !== 'all') {
    try {
      await syncPartnerCandidatesForTournament(effectiveTournamentId, partnerId, { silent: true });
    } catch (_) {}
  }

  const { allRankings } = await getLeaderboard({ limit: 1000, tournamentId: effectiveTournamentId });

  const partnerIdStr = String(partnerId);
  const partnerRankInfo = allRankings.find(p => String(p.partnerId) === partnerIdStr);

  // Check if partner has actually joined / entered this tournament
  const isEnrolled = Array.isArray(tournamentDoc?.participants) &&
    tournamentDoc.participants.some(p => String(p.partner?._id || p.partner || p) === partnerIdStr);

  const hasJoined = Boolean(isEnrolled);

  const filter = { partner: partnerId };
  if (effectiveTournamentId && effectiveTournamentId !== 'all' && mongoose.Types.ObjectId.isValid(effectiveTournamentId)) {
    filter.tournament = effectiveTournamentId;
  }

  // Fetch recent point events for this tournament only if partner has joined
  const recentEvents = hasJoined ? await PartnerPointEvent.find(filter)
    .sort({ awardedAt: -1 })
    .limit(20)
    .lean() : [];

  const partnerDoc = await StaffingPartner.findById(partnerId).lean();

  const rank = hasJoined && partnerRankInfo ? partnerRankInfo.rank : null;
  const tier = hasJoined && partnerRankInfo ? partnerRankInfo.tier : null;
  const tierName = hasJoined && partnerRankInfo ? partnerRankInfo.tierName : null;
  const percentile = hasJoined && partnerRankInfo ? partnerRankInfo.percentile : null;
  const totalPoints = hasJoined && partnerRankInfo ? partnerRankInfo.totalPoints : 0;
  const defaultBreakdown = {
    s1_review: { count: 0, points: 0 },
    s1_screen_select: { count: 0, points: 0 },
    client_screen_select: { count: 0, points: 0 },
    round_2_selection: { count: 0, points: 0 },
    offered: { count: 0, points: 0 },
    joined: { count: 0, points: 0 },
    retention_90_days: { count: 0, points: 0 },
    manual: { count: 0, points: 0 },
    screened: { count: 0, points: 0 },
    submitted: { count: 0, points: 0 },
    interviewed: { count: 0, points: 0 },
    selected: { count: 0, points: 0 }
  };
  const breakdown = hasJoined && partnerRankInfo ? partnerRankInfo.breakdown : defaultBreakdown;
  const badges = hasJoined && partnerRankInfo ? partnerRankInfo.badges : [];

  return {
    partnerId,
    firmName: partnerDoc?.firmName || 'Your Firm',
    partnerName: partnerDoc ? `${partnerDoc.firstName || ''} ${partnerDoc.lastName || ''}`.trim() : 'You',
    hasJoined,
    rank,
    tier,
    tierName,
    percentile,
    totalPoints,
    breakdown,
    badges,
    totalParticipants: allRankings.length,
    recentEvents
  };
}

/**
 * Get Admin Partner Rankings with search, pagination, and KPI totals
 */
async function getAdminPartnerRankings({ search = '', page = 1, limit = 50, tournamentId = null } = {}) {
  let effectiveTournamentId = tournamentId;
  if (!effectiveTournamentId || effectiveTournamentId === 'current') {
    const currentT = await getCurrentTournament();
    if (currentT) {
      effectiveTournamentId = currentT._id;
    }
  }

  const { allRankings } = await getLeaderboard({ limit: 5000, tournamentId: effectiveTournamentId });

  // Admin rankings only include partners who are enrolled in this tournament (plus any manual program partners)
  const completeRankings = allRankings;

  // Filter by search query if provided
  let filtered = completeRankings;
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = completeRankings.filter(p =>
      p.partnerName.toLowerCase().includes(q) ||
      p.firmName.toLowerCase().includes(q) ||
      (p.city && p.city.toLowerCase().includes(q))
    );
  }

  // Calculate platform KPIs for this tournament across the 7 milestones
  const totalPointsAwarded = allRankings.reduce((sum, p) => sum + (p.totalPoints || 0), 0);
  const totalS1Review = allRankings.reduce((sum, p) => sum + (p.breakdown?.s1_review?.count ?? p.breakdown?.screened?.count ?? 0), 0);
  const totalS1ScreenSelect = allRankings.reduce((sum, p) => sum + (p.breakdown?.s1_screen_select?.count ?? p.breakdown?.submitted?.count ?? 0), 0);
  const totalClientScreenSelect = allRankings.reduce((sum, p) => sum + (p.breakdown?.client_screen_select?.count ?? p.breakdown?.interviewed?.count ?? 0), 0);
  const totalRound2Selection = allRankings.reduce((sum, p) => sum + (p.breakdown?.round_2_selection?.count ?? p.breakdown?.selected?.count ?? 0), 0);
  const totalOffered = allRankings.reduce((sum, p) => sum + (p.breakdown?.offered?.count || 0), 0);
  const totalJoined = allRankings.reduce((sum, p) => sum + (p.breakdown?.joined?.count || 0), 0);
  const totalRetention90 = allRankings.reduce((sum, p) => sum + (p.breakdown?.retention_90_days?.count || 0), 0);
  const topPartner = allRankings[0] || null;

  // Pagination
  const startIndex = (page - 1) * limit;
  const paginatedRankings = filtered.slice(startIndex, startIndex + limit);

  return {
    kpis: {
      totalPointsAwarded,
      totalPartnersParticipating: completeRankings.length,
      activePartnersScored: completeRankings.filter(p => p.totalPoints > 0).length,
      totalS1Review,
      totalS1ScreenSelect,
      totalClientScreenSelect,
      totalRound2Selection,
      totalOffered,
      totalJoined,
      totalRetention90,
      totalScreenedProfiles: totalS1Review,
      totalCompanySubmissions: totalS1ScreenSelect,
      totalInterviews: totalClientScreenSelect,
      totalSelections: totalRound2Selection,
      totalClosures: totalJoined,
      topPartner: topPartner ? {
        partnerName: topPartner.partnerName,
        firmName: topPartner.firmName,
        totalPoints: topPartner.totalPoints
      } : null
    },
    pagination: {
      total: filtered.length,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(filtered.length / limit) || 1
    },
    rankings: paginatedRankings
  };
}

/**
 * Get itemized point events for audit drawer (Real talent partners only)
 */
async function getPartnerAuditEvents(partnerId, tournamentId = null) {
  const partner = await StaffingPartner.findById(partnerId).lean();

  // Strict Policy: Do not return or expose audit events for manual/admin-created program partners
  if (partner?.isManualProgramPartner) {
    return {
      partner: partner ? {
        _id: partner._id,
        firstName: partner.firstName,
        lastName: partner.lastName,
        firmName: partner.firmName,
        city: partner.city,
        state: partner.state,
        isManualProgramPartner: true
      } : null,
      totalEvents: 0,
      events: [],
      isManualProgramPartner: true,
      message: 'Audit logs are not maintained for manual program partners.'
    };
  }

  const query = { partner: partnerId };
  if (tournamentId && tournamentId !== 'all' && mongoose.Types.ObjectId.isValid(tournamentId)) {
    query.tournament = tournamentId;
  }

  const events = await PartnerPointEvent.find(query)
    .sort({ awardedAt: -1 })
    .lean();

  return {
    partner: partner ? {
      _id: partner._id,
      firstName: partner.firstName,
      lastName: partner.lastName,
      firmName: partner.firmName,
      city: partner.city,
      state: partner.state,
      isManualProgramPartner: false
    } : null,
    totalEvents: events.length,
    events
  };
}

/**
 * Backfill and calibrate points strictly from tournament start date to end/current date
 */
async function backfillExistingPoints(targetTournamentId = null) {
  let tournament;
  if (targetTournamentId && mongoose.Types.ObjectId.isValid(targetTournamentId)) {
    tournament = await PartnerTournament.findById(targetTournamentId);
  } else {
    tournament = await PartnerTournament.findOne({ isActive: true }).sort({ createdAt: -1 });
  }

  if (!tournament) {
    return { success: false, message: 'No active tournament found' };
  }

  const start = new Date(tournament.startDate);
  const end = new Date(tournament.endDate);
  const tournamentId = tournament._id;

  console.log(`[PARTNER_PROGRAM] Calibrating points strictly within tournament "${tournament.title}" timeline (${start.toISOString()} to ${end.toISOString()})...`);

  // Find all enrolled real partners
  const enrolledPartnerIds = (tournament.participants || []).map(p => String(p.partner?._id || p.partner || p));
  const enrolledPartnerIdSet = new Set(enrolledPartnerIds);

  // Find all manual/fake partners so we preserve their simulated events
  const manualPartners = await StaffingPartner.find({ isManualProgramPartner: true }).select('_id').lean();
  const manualPartnerIds = manualPartners.map(p => p._id);
  const manualPartnerIdSet = new Set(manualPartnerIds.map(String));

  // Clear existing candidate milestone points recorded for real partners who are NOT enrolled
  await PartnerPointEvent.deleteMany({
    tournament: tournamentId,
    partner: { $nin: [...manualPartnerIds, ...enrolledPartnerIds] }
  });

  // For enrolled real partners, delete milestone events so we can re-calculate cleanly
  await PartnerPointEvent.deleteMany({
    tournament: tournamentId,
    partner: { $in: enrolledPartnerIds, $nin: manualPartnerIds },
    stage: { $ne: STAGES.MANUAL_ADJUSTMENT }
  });

  // Find all candidates submitted by staffing partners who are enrolled or manual
  const eligibleSubmitterIds = [...Array.from(enrolledPartnerIdSet), ...Array.from(manualPartnerIdSet)];
  const candidates = eligibleSubmitterIds.length > 0 ? await Candidate.find({
    submittedBy: { $in: eligibleSubmitterIds }
  })
    .populate('job', 'title company')
    .populate('company', 'companyName')
    .lean() : [];

  const isInWindow = (d) => Boolean(d && !isNaN(d.getTime()) && d >= start && d <= end);

  let processedCount = 0;
  let awardedCount = 0;

  for (const cand of candidates) {
    try {
      const candidateDoc = {
        ...cand,
        jobTitle: cand.job?.title || 'Position',
        companyName: cand.company?.companyName || 'Company'
      };

      const status = String(cand.status || '').toUpperCase();
      const mDates = getMilestoneEventDates(cand);
      const historyStatuses = new Set((cand.statusHistory || []).map(h => String(h.status || '').toUpperCase()));
      const hasReachedStatus = (stateSet) => stateSet.has(status) || Array.from(stateSet).some(s => historyStatuses.has(s));

      const isS1ReviewEligible = Boolean(cand.email && cand.firstName && hasReachedStatus(S1_REVIEW_STATES));
      const isS1ScreenSelectEligible = hasReachedStatus(S1_SCREEN_SELECT_STATES);
      const isClientScreenSelectEligible = hasReachedStatus(CLIENT_SCREEN_SELECT_STATES);
      const isRound2Eligible = isCandidateEligibleForRound2(cand);
      const isOfferedEligible = hasReachedStatus(OFFER_STATES);
      const isJoinedEligible = hasReachedStatus(JOINED_STATES);
      const isRetention90Eligible = isCandidateEligibleForRetention90(cand);

      const isNegative = ['CONSENT_DENIED', 'CLIENT_PORTAL_DUPLICATE', 'COMPANY_PORTAL_DUPLICATE', 'ADMIN_REJECTED', 'WITHDRAWN', 'CANDIDATE_DROP'].includes(status);

      // 1. Award S1 Review (10 Points) - strictly within tournament window
      if (isS1ReviewEligible && !isNegative && isInWindow(mDates.s1ReviewDate)) {
        const ev = await awardPoints(candidateDoc, STAGES.S1_REVIEW, tournamentId, mDates.s1ReviewDate, { silent: true });
        if (ev) awardedCount++;
      }

      // 2. Award S1 Screen Select (10 Points) - strictly within tournament window
      if (isS1ScreenSelectEligible && isInWindow(mDates.s1ScreenSelectDate)) {
        const ev = await awardPoints(candidateDoc, STAGES.S1_SCREEN_SELECT, tournamentId, mDates.s1ScreenSelectDate, { silent: true });
        if (ev) awardedCount++;
      }

      // 3. Award Client Screen Select (10 Points) - strictly within tournament window
      if (isClientScreenSelectEligible && isInWindow(mDates.clientScreenSelectDate)) {
        const ev = await awardPoints(candidateDoc, STAGES.CLIENT_SCREEN_SELECT, tournamentId, mDates.clientScreenSelectDate, { silent: true });
        if (ev) awardedCount++;
      }

      // 4. Award Round 2 Selection (10 Points) - strictly within tournament window
      if (isRound2Eligible && isInWindow(mDates.round2Date)) {
        const ev = await awardPoints(candidateDoc, STAGES.ROUND_2_SELECTION, tournamentId, mDates.round2Date, { silent: true });
        if (ev) awardedCount++;
      }

      // 5. Award Offered & Offered Accepted (20 Points) - strictly within tournament window
      if (isOfferedEligible && isInWindow(mDates.offeredDate)) {
        const ev = await awardPoints(candidateDoc, STAGES.OFFERED, tournamentId, mDates.offeredDate, { silent: true });
        if (ev) awardedCount++;
      }

      // 6. Award Joined (20 Points) - strictly within tournament window
      if (isJoinedEligible && isInWindow(mDates.joinedDate)) {
        const ev = await awardPoints(candidateDoc, STAGES.JOINED, tournamentId, mDates.joinedDate, { silent: true });
        if (ev) awardedCount++;
      }

      // 7. Award 90 days Candidate Retention (20 Points) - strictly within tournament window
      if (isRetention90Eligible && isInWindow(mDates.retentionDate)) {
        const ev = await awardPoints(candidateDoc, STAGES.RETENTION_90_DAYS, tournamentId, mDates.retentionDate, { silent: true });
        if (ev) awardedCount++;
      }

      processedCount++;
    } catch (err) {
      console.error(`[PARTNER_PROGRAM] Sync failed for candidate ${cand._id}:`, err.message);
    }
  }

  console.log(`[PARTNER_PROGRAM] Completed sync: evaluated ${processedCount} candidates, created ${awardedCount} point events.`);
  return {
    success: true,
    processedCandidates: processedCount,
    awardedPointsCount: awardedCount,
    startDate: start,
    endDate: end
  };
}

const SIMULATED_CANDIDATE_NAMES = [
  'Aarav Sharma', 'Sneha Iyer', 'Rohan Mehta', 'Pooja Hegde',
  'Vikram Patel', 'Ananya Deshmukh', 'Aditya Verma', 'Neha Nair',
  'Kunal Kulkarni', 'Priyanka Rao', 'Siddharth Joshi', 'Tanvi Singhal',
  'Arjun Malhotra', 'Divya Menon', 'Rahul Banerjee', 'Meera Kapoor',
  'Nikhil Saxena', 'Kavita Reddy', 'Amitabh Das', 'Rhea Sen',
  'Varun Bhatia', 'Shreya Mukherjee', 'Gaurav Chopra', 'Ishita Trivedi',
  'Manish Pandey', 'Ritika Aggarwal', 'Deepak Pillai', 'Swati Chauhan'
];

const SIMULATED_JOB_TITLES = [
  'Senior Full Stack Engineer',
  'Lead Backend Developer',
  'Frontend Architect (React)',
  'DevOps & Cloud Engineer',
  'Staff Software Engineer',
  'Senior Product Manager',
  'Data Platform Engineer',
  'Senior QA Automation Specialist',
  'Engineering Manager',
  'Senior Mobile Developer'
];

const SIMULATED_COMPANIES = [
  'FinTech Dynamics',
  'CloudScale Systems',
  'NexGen AI Labs',
  'Apex Global Enterprises',
  'Quantum Tech Solutions',
  'HyperGrowth Media',
  'OmniChannel Logistics',
  'CyberGuard Security',
  'Pulse HealthTech',
  'Synthetix Capital'
];

/**
 * Realistic funnel decomposition algorithm:
 * Given total points T, computes (k_join, k_sel, k_int, k_sub, k_scr)
 * such that cumulative candidate counts satisfy Screened >= Submitted >= Interviewed >= Selected >= Joined
 * and the sum of milestone points strictly equals T (with at most 0 or 1 manual point).
 */
function calculateFunnelForPoints(totalPoints) {
  let rem = Math.max(0, parseInt(totalPoints, 10) || 0);

  let k_join = 0;
  let k_sel = 0;
  let k_int = 0;
  let k_sub = 0;
  let k_scr = 0;

  if (rem >= 120) {
    const maxJoins = Math.floor(rem / 77);
    const targetJoins = Math.min(maxJoins, Math.max(1, Math.floor((rem * 0.35) / 77)));
    k_join = targetJoins;
    rem -= k_join * 77;
  } else if (rem >= 77 && rem % 2 !== 0) {
    k_join = 1;
    rem -= 77;
  } else if (rem >= 85) {
    k_join = 1;
    rem -= 77;
  }

  if (rem >= 60) {
    const maxSel = Math.floor(rem / 37);
    const targetSel = Math.min(maxSel, Math.max(1, Math.floor((rem * 0.30) / 37)));
    k_sel = targetSel;
    rem -= k_sel * 37;
  } else if (rem >= 37 && rem % 2 !== 0 && rem < 77) {
    k_sel = 1;
    rem -= 37;
  }

  if (rem >= 30) {
    const maxInt = Math.floor(rem / 17);
    const targetInt = Math.min(maxInt, Math.max(1, Math.floor((rem * 0.35) / 17)));
    k_int = targetInt;
    rem -= k_int * 17;
  } else if (rem >= 17 && rem % 2 !== 0) {
    k_int = 1;
    rem -= 17;
  }

  if (rem >= 14) {
    const maxSub = Math.floor(rem / 7);
    const targetSub = Math.min(maxSub, Math.max(1, Math.floor((rem * 0.30) / 7)));
    k_sub = targetSub;
    rem -= k_sub * 7;
  }

  if (rem % 2 !== 0) {
    if (rem >= 7) {
      k_sub += 1;
      rem -= 7;
    } else if (k_sub > 0 && rem + 7 >= 17) {
      k_sub -= 1;
      k_int += 1;
      rem -= 10;
    }
  }

  if (rem >= 2) {
    k_scr = Math.floor(rem / 2);
    rem -= k_scr * 2;
  }

  const manual = rem;
  const joined = k_join;
  const selected = k_join + k_sel;
  const interviewed = k_join + k_sel + k_int;
  const submitted = k_join + k_sel + k_int + k_sub;
  const screened = k_join + k_sel + k_int + k_sub + k_scr;

  return {
    k_join,
    k_sel,
    k_int,
    k_sub,
    k_scr,
    manual,
    counts: {
      screened,
      submitted,
      interviewed,
      selected,
      joined
    },
    points: {
      screened: screened * 2,
      submitted: submitted * 5,
      interviewed: interviewed * 10,
      selected: selected * 20,
      joined: joined * 40,
      manual
    },
    total: (screened * 2) + (submitted * 5) + (interviewed * 10) + (selected * 20) + (joined * 40) + manual
  };
}

/**
 * Generate simulated candidate point events for a fake partner in a tournament
 */
async function createSimulatedPointEvents(tournamentId, partnerDoc, desiredTotalPoints, adminUserId = null, notes = '', customBreakdown = null) {
  const partnerId = partnerDoc._id;
  const targetPts = Math.max(0, parseInt(desiredTotalPoints, 10) || 0);

  // Clear existing point events for this partner in this tournament
  await PartnerPointEvent.deleteMany({
    tournament: tournamentId,
    partner: partnerId
  });

  if (targetPts === 0) {
    return {
      partnerId,
      totalPoints: 0,
      counts: { screened: 0, submitted: 0, interviewed: 0, selected: 0, joined: 0 },
      eventsCount: 0
    };
  }

  let decomposition;
  if (customBreakdown && typeof customBreakdown === 'object') {
    const sc = Math.max(0, parseInt(customBreakdown.screened, 10) || 0);
    const sub = Math.max(0, parseInt(customBreakdown.submitted, 10) || 0);
    const intv = Math.max(0, parseInt(customBreakdown.interviewed, 10) || 0);
    const sel = Math.max(0, parseInt(customBreakdown.selected, 10) || 0);
    const jn = Math.max(0, parseInt(customBreakdown.joined, 10) || 0);

    const calculatedPts = (sc * 2) + (sub * 5) + (intv * 10) + (sel * 20) + (jn * 40);
    const manualRem = Math.max(0, targetPts - calculatedPts);

    decomposition = {
      k_join: jn,
      k_sel: Math.max(0, sel - jn),
      k_int: Math.max(0, intv - sel),
      k_sub: Math.max(0, sub - intv),
      k_scr: Math.max(0, sc - sub),
      manual: manualRem,
      counts: {
        screened: sc,
        submitted: sub,
        interviewed: intv,
        selected: sel,
        joined: jn
      }
    };
  } else {
    decomposition = calculateFunnelForPoints(targetPts);
  }

  const { k_join, k_sel, k_int, k_sub, k_scr, manual, counts } = decomposition;
  const totalCandidates = k_join + k_sel + k_int + k_sub + k_scr;

  // Resolve tournament time window for authentic event timestamps
  const tournament = await PartnerTournament.findById(tournamentId).lean();
  const now = new Date();
  const start = tournament?.startDate ? new Date(tournament.startDate) : new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const end = tournament?.endDate ? new Date(Math.min(now.getTime(), new Date(tournament.endDate).getTime())) : now;
  const windowMs = Math.max(end.getTime() - start.getTime(), 3600000);

  const eventsToInsert = [];

  for (let i = 0; i < totalCandidates; i++) {
    // Space registration across tournament window
    const candBaseTime = new Date(start.getTime() + (windowMs * (0.05 + 0.85 * (i / Math.max(totalCandidates, 1)))));

    // Determine journey depth
    let maxStage = 'SCREENED';
    if (i < k_join) {
      maxStage = 'JOINED';
    } else if (i < k_join + k_sel) {
      maxStage = 'SELECTED';
    } else if (i < k_join + k_sel + k_int) {
      maxStage = 'INTERVIEW_SCHEDULED';
    } else if (i < k_join + k_sel + k_int + k_sub) {
      maxStage = 'SUBMITTED_TO_COMPANY';
    } else {
      maxStage = 'SCREENED';
    }

    // 1. SCREENED milestone (2 points)
    eventsToInsert.push({
      tournament: tournamentId,
      partner: partnerId,
      stage: STAGES.SCREENED,
      points: STAGE_POINTS.SCREENED,
      metadata: { isManualProgramPartner: true },
      awardedAt: candBaseTime
    });

    // 2. SUBMITTED milestone (5 points)
    if (['SUBMITTED_TO_COMPANY', 'INTERVIEW_SCHEDULED', 'SELECTED', 'JOINED'].includes(maxStage)) {
      const subTime = new Date(Math.min(end.getTime(), candBaseTime.getTime() + 1 * 24 * 60 * 60 * 1000));
      eventsToInsert.push({
        tournament: tournamentId,
        partner: partnerId,
        stage: STAGES.SUBMITTED_TO_COMPANY,
        points: STAGE_POINTS.SUBMITTED_TO_COMPANY,
        metadata: { isManualProgramPartner: true },
        awardedAt: subTime
      });
    }

    // 3. INTERVIEW milestone (10 points)
    if (['INTERVIEW_SCHEDULED', 'SELECTED', 'JOINED'].includes(maxStage)) {
      const intTime = new Date(Math.min(end.getTime(), candBaseTime.getTime() + 3 * 24 * 60 * 60 * 1000));
      eventsToInsert.push({
        tournament: tournamentId,
        partner: partnerId,
        stage: STAGES.INTERVIEW_SCHEDULED,
        points: STAGE_POINTS.INTERVIEW_SCHEDULED,
        metadata: { isManualProgramPartner: true },
        awardedAt: intTime
      });
    }

    // 4. SELECTED milestone (20 points)
    if (['SELECTED', 'JOINED'].includes(maxStage)) {
      const selTime = new Date(Math.min(end.getTime(), candBaseTime.getTime() + 6 * 24 * 60 * 60 * 1000));
      eventsToInsert.push({
        tournament: tournamentId,
        partner: partnerId,
        stage: STAGES.SELECTED,
        points: STAGE_POINTS.SELECTED,
        metadata: { isManualProgramPartner: true },
        awardedAt: selTime
      });
    }

    // 5. JOINED milestone (40 points)
    if (maxStage === 'JOINED') {
      const joinTime = new Date(Math.min(end.getTime(), candBaseTime.getTime() + 10 * 24 * 60 * 60 * 1000));
      eventsToInsert.push({
        tournament: tournamentId,
        partner: partnerId,
        stage: STAGES.JOINED,
        points: STAGE_POINTS.JOINED,
        metadata: { isManualProgramPartner: true },
        awardedAt: joinTime
      });
    }
  }

  // If there's an odd parity remainder or manual difference
  if (manual > 0) {
    eventsToInsert.push({
      tournament: tournamentId,
      partner: partnerId,
      stage: STAGES.MANUAL_ADJUSTMENT,
      points: manual,
      metadata: { isManualProgramPartner: true },
      awardedAt: new Date()
    });
  }

  if (eventsToInsert.length > 0) {
    await PartnerPointEvent.insertMany(eventsToInsert);
  }

  return {
    partnerId,
    totalPoints: targetPts,
    counts,
    manualAdjustmentPoints: manual,
    eventsCount: eventsToInsert.length
  };
}

/**
 * Set total points for a partner in a tournament by generating realistic candidate milestone events.
 */
async function setPartnerTotalPoints(tournamentId, partnerId, desiredTotalPoints, adminUserId = null, notes = '', customBreakdown = null) {
  if (!tournamentId || !partnerId) {
    throw new Error('Tournament ID and Partner ID are required');
  }

  const targetPts = Math.max(0, parseInt(desiredTotalPoints, 10) || 0);

  const partnerDoc = await StaffingPartner.findById(partnerId);
  if (!partnerDoc) {
    throw new Error('Partner not found');
  }

  // Strict Protection: Only fake/manual partners created by Admin can have their points or rank updated manually!
  if (!partnerDoc.isManualProgramPartner) {
    throw new Error('Points and rank updates are only allowed for admin-created program partners. Real talent partners earn points exclusively through candidate recruitment milestones.');
  }

  return await createSimulatedPointEvents(tournamentId, partnerDoc, targetPts, adminUserId, notes, customBreakdown);
}

/**
 * Automatically calculate points needed to place a partner at targetRank.
 * If there is not enough gap between neighbors, automatically shifts the points of other partners
 * so that targetRank is achieved strictly and relative positions are preserved.
 */
async function calculatePointsForTargetRank(tournamentId, partnerId, targetRank) {
  const desiredRank = Math.max(1, parseInt(targetRank, 10) || 1);

  // Get current rankings in this tournament
  const { allRankings } = await getLeaderboard({ limit: 5000, tournamentId });

  // Filter out the partner being modified
  const partnerIdStr = partnerId ? String(partnerId) : null;
  const otherPartners = allRankings.filter(p => String(p.partnerId) !== partnerIdStr);

  const M = otherPartners.length;

  // Case 1: No other partners exist yet
  if (M === 0) {
    return { targetPoints: 100, shiftedPartners: [] };
  }

  // Case 2: Target rank is #1
  if (desiredRank === 1) {
    const topOtherPoints = otherPartners[0].totalPoints || 0;
    const targetPoints = Math.max(10, topOtherPoints + 10);
    return { targetPoints, shiftedPartners: [] };
  }

  // Case 3: Target rank is at the bottom / beyond list
  if (desiredRank > M) {
    const bottomOtherPoints = otherPartners[M - 1].totalPoints || 0;
    const targetPoints = Math.max(0, bottomOtherPoints - 5);
    return { targetPoints, shiftedPartners: [] };
  }

  // Case 4: 1 < desiredRank <= M
  // Partner will sit between otherPartners[desiredRank - 2] (above) and otherPartners[desiredRank - 1] (below)
  const partnerAbove = otherPartners[desiredRank - 2];
  const partnerBelow = otherPartners[desiredRank - 1];

  const pAbove = partnerAbove.totalPoints || 0;
  const pBelow = partnerBelow.totalPoints || 0;

  // Subcase 4A: There is an integer gap of at least 2 points
  if (pAbove > pBelow + 1) {
    const targetPoints = pBelow + Math.max(1, Math.floor((pAbove - pBelow) / 2));
    return { targetPoints, shiftedPartners: [] };
  }

  // Subcase 4B: No gap (e.g. pAbove == pBelow or pAbove == pBelow + 1)
  // Shift all partners above (index 0 to desiredRank - 2) by +10 points
  const shiftAmount = 10;
  const shiftedPartners = [];

  for (let i = 0; i <= desiredRank - 2; i++) {
    const pToShift = otherPartners[i];
    // ONLY shift admin-created fake partners. Real talent partners earn genuine points and must never be altered!
    if (pToShift.isManualProgramPartner) {
      const newPoints = (pToShift.totalPoints || 0) + shiftAmount;
      await setPartnerTotalPoints(
        tournamentId,
        pToShift.partnerId,
        newPoints,
        null,
        `Auto-shifted +${shiftAmount} pts to accommodate rank ${desiredRank}`
      );
      shiftedPartners.push({ partnerId: pToShift.partnerId, newPoints });
    }
  }

  const targetPoints = pBelow + Math.max(1, Math.floor(shiftAmount / 2)); // e.g. pBelow + 5, which sits cleanly between pBelow and (pAbove + shiftAmount)

  return { targetPoints, shiftedPartners };
}

/**
 * Admin update partner rank or points
 */
async function updatePartnerPointsAndRank({ tournamentId, partnerId, points, targetRank, customBreakdown = null, adminUserId = null }) {
  if (!tournamentId || !partnerId) {
    throw new Error('Tournament ID and Partner ID are required');
  }

  const partner = await StaffingPartner.findById(partnerId);
  if (!partner) {
    throw new Error('Partner not found');
  }

  // Strict check: Only fake/manual partners created by Admin can have their points or rank updated manually!
  if (!partner.isManualProgramPartner) {
    throw new Error('Points and rank updates are only allowed for admin-created program partners. Real talent partners earn points exclusively through candidate recruitment milestones.');
  }

  let finalPoints;
  let calculationMeta = null;

  if (targetRank !== undefined && targetRank !== null && targetRank !== '') {
    finalPoints = null; // Will calculate per tournament
  } else if (points !== undefined && points !== null && points !== '') {
    finalPoints = Math.max(0, parseInt(points, 10) || 0);
  } else if (customBreakdown && typeof customBreakdown === 'object') {
    const sc = Math.max(0, parseInt(customBreakdown.screened, 10) || 0);
    const sub = Math.max(0, parseInt(customBreakdown.submitted, 10) || 0);
    const intv = Math.max(0, parseInt(customBreakdown.interviewed, 10) || 0);
    const sel = Math.max(0, parseInt(customBreakdown.selected, 10) || 0);
    const jn = Math.max(0, parseInt(customBreakdown.joined, 10) || 0);
    finalPoints = (sc * 2) + (sub * 5) + (intv * 10) + (sel * 20) + (jn * 40);
  } else {
    throw new Error('Either points, targetRank, or customBreakdown must be provided');
  }

  let targetTournaments = [];
  if (tournamentId === 'all') {
    targetTournaments = await PartnerTournament.find({});
    if (targetTournaments.length === 0) {
      const current = await getCurrentTournament();
      if (current) targetTournaments = [current];
    }
  } else {
    if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
      throw new Error('Valid Tournament ID is required');
    }
    const t = await PartnerTournament.findById(tournamentId);
    if (!t) throw new Error('Tournament not found');
    targetTournaments = [t];
  }

  let lastResult = null;
  for (const tDoc of targetTournaments) {
    let tPoints = finalPoints;
    if (targetRank !== undefined && targetRank !== null && targetRank !== '') {
      calculationMeta = await calculatePointsForTargetRank(tDoc._id, partnerId, targetRank);
      tPoints = calculationMeta.targetPoints;
    }

    lastResult = await setPartnerTotalPoints(
      tDoc._id,
      partnerId,
      tPoints,
      adminUserId,
      targetRank ? `Set to target rank #${targetRank}` : `Set total points to ${tPoints}`,
      customBreakdown
    );
  }

  const effectiveTourneyId = targetTournaments[0]?._id;
  const stats = await getPartnerProgramStats(partnerId, { tournamentId: effectiveTourneyId });
  return {
    ...lastResult,
    currentRank: stats.rank,
    stats,
    calculationMeta,
    tournamentsCount: targetTournaments.length
  };
}

/**
 * Create N number of talent partners for the Partner Program
 */
async function createProgramPartners({ tournamentId, partners = [], adminUserId = null }) {
  if (!tournamentId) {
    throw new Error('Tournament ID is required (or "all" for all tournaments)');
  }

  let targetTournaments = [];
  if (tournamentId === 'all') {
    targetTournaments = await PartnerTournament.find({});
    if (targetTournaments.length === 0) {
      const current = await getCurrentTournament();
      if (current) targetTournaments = [current];
    }
  } else {
    if (!mongoose.Types.ObjectId.isValid(tournamentId)) {
      throw new Error('Valid Tournament ID is required');
    }
    const t = await PartnerTournament.findById(tournamentId);
    if (!t) throw new Error('Tournament not found');
    targetTournaments = [t];
  }

  if (!Array.isArray(partners) || partners.length === 0) {
    throw new Error('At least one partner must be provided');
  }

  const createdPartners = [];

  for (let i = 0; i < partners.length; i++) {
    const item = partners[i];
    const firmName = (item.firmName || '').trim() || `Partner Firm ${i + 1}`;
    const firstName = (item.firstName || '').trim() || 'Partner';
    const lastName = (item.lastName || '').trim() || `Rep ${i + 1}`;
    const city = (item.city || '').trim() || 'Mumbai';
    const state = (item.state || '').trim() || 'Maharashtra';
    const designation = (item.designation || '').trim() || 'Managing Partner';

    // 1. Create a companion User record to ensure complete platform compatibility
    const randomSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`;
    const email = (item.email || '').trim().toLowerCase() || `program_partner_${randomSuffix}@syncro1.internal`;
    const mobile = (item.mobile || '').trim() || `+91${Math.floor(6000000000 + Math.random() * 3999999999)}`;
    const hashedPassword = await bcrypt.hash(Math.random().toString(36), 10);

    const user = await User.create({
      firstName,
      lastName,
      email,
      mobile,
      password: hashedPassword,
      role: 'staffing_partner',
      status: 'ACTIVE'
    });

    // 2. Create StaffingPartner record
    const partner = await StaffingPartner.create({
      user: user._id,
      firstName,
      lastName,
      designation,
      city,
      state,
      firmName,
      verificationStatus: 'APPROVED',
      isManualProgramPartner: true
    });

    // 3. Set points or rank for each target tournament
    let finalTargetPoints = 0;
    for (const tDoc of targetTournaments) {
      let targetPoints = 0;
      if (item.targetRank !== undefined && item.targetRank !== null && item.targetRank !== '') {
        const calc = await calculatePointsForTargetRank(tDoc._id, partner._id, item.targetRank);
        targetPoints = calc.targetPoints;
      } else if (item.points !== undefined && item.points !== null && item.points !== '') {
        targetPoints = Math.max(0, parseInt(item.points, 10) || 0);
      } else if (item.customBreakdown && typeof item.customBreakdown === 'object') {
        const sc = Math.max(0, parseInt(item.customBreakdown.screened, 10) || 0);
        const sub = Math.max(0, parseInt(item.customBreakdown.submitted, 10) || 0);
        const intv = Math.max(0, parseInt(item.customBreakdown.interviewed, 10) || 0);
        const sel = Math.max(0, parseInt(item.customBreakdown.selected, 10) || 0);
        const jn = Math.max(0, parseInt(item.customBreakdown.joined, 10) || 0);
        targetPoints = (sc * 2) + (sub * 5) + (intv * 10) + (sel * 20) + (jn * 40);
      }

      finalTargetPoints = targetPoints;

      await setPartnerTotalPoints(
        tDoc._id,
        partner._id,
        targetPoints,
        adminUserId,
        item.targetRank ? `Initial rank #${item.targetRank}` : `Initial points: ${targetPoints}`,
        item.customBreakdown || null
      );

      // Ensure manual partner is also recorded in tournament participants
      const inParticipants = Array.isArray(tDoc.participants) &&
        tDoc.participants.some(p => String(p.partner?._id || p.partner || p) === String(partner._id));
      if (!inParticipants) {
        if (!tDoc.participants) tDoc.participants = [];
        tDoc.participants.push({ partner: partner._id, joinedAt: new Date() });
        await tDoc.save();
      }
    }

    createdPartners.push({
      partnerId: partner._id,
      userId: user._id,
      firmName,
      partnerName: `${firstName} ${lastName}`,
      city,
      state,
      totalPoints: finalTargetPoints,
      tournamentsCount: targetTournaments.length
    });
  }

  const scopeMsg = targetTournaments.length > 1
    ? `across all ${targetTournaments.length} tournament programs`
    : 'for the program';

  return {
    success: true,
    message: `Successfully created ${createdPartners.length} partner(s) ${scopeMsg}`,
    partners: createdPartners,
    tournamentsCount: targetTournaments.length
  };
}

/**
 * Delete a manually created program partner
 */
async function deleteProgramPartner({ tournamentId, partnerId }) {
  if (!partnerId || !mongoose.Types.ObjectId.isValid(partnerId)) {
    throw new Error('Valid Partner ID is required');
  }

  const partner = await StaffingPartner.findById(partnerId);
  if (!partner) {
    throw new Error('Partner not found');
  }

  // Strict Protection: Real talent partners cannot be deleted from this interface!
  if (!partner.isManualProgramPartner) {
    throw new Error('Real talent partners cannot be deleted from this program interface.');
  }

  if (tournamentId && tournamentId !== 'all' && mongoose.Types.ObjectId.isValid(tournamentId)) {
    // Delete only for this tournament
    await PartnerPointEvent.deleteMany({ partner: partnerId, tournament: tournamentId });
    await PartnerTournament.findByIdAndUpdate(tournamentId, {
      $pull: { participants: { partner: partnerId } }
    });
    // Check if partner has events in other tournaments
    const remainingEvents = await PartnerPointEvent.countDocuments({ partner: partnerId });
    if (remainingEvents === 0) {
      if (partner.user) {
        await User.findByIdAndDelete(partner.user);
      }
      await StaffingPartner.findByIdAndDelete(partnerId);
    }
  } else {
    // Delete point events for this partner across all tournaments
    await PartnerPointEvent.deleteMany({ partner: partnerId });
    await PartnerTournament.updateMany({}, {
      $pull: { participants: { partner: partnerId } }
    });
    if (partner.user) {
      await User.findByIdAndDelete(partner.user);
    }
    await StaffingPartner.findByIdAndDelete(partnerId);
  }

  return { success: true, message: 'Partner removed from program successfully' };
}

module.exports = {
  STAGE_POINTS,
  STAGES,
  formatTournament,
  getCurrentTournament,
  getAllTournaments,
  getTournamentById,
  createTournament,
  updateTournament,
  deleteTournament,
  saveTournament,
  awardPoints,
  processCandidateStageChange,
  getLeaderboard,
  getPartnerProgramStats,
  getAdminPartnerRankings,
  getPartnerAuditEvents,
  backfillExistingPoints,
  calculateFunnelForPoints,
  createSimulatedPointEvents,
  setPartnerTotalPoints,
  calculatePointsForTargetRank,
  updatePartnerPointsAndRank,
  createProgramPartners,
  deleteProgramPartner,
  enterTournament,
  syncPartnerCandidatesForTournament
};
