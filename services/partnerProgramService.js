// backend/services/partnerProgramService.js
const mongoose = require('mongoose');
const { PartnerPointEvent, STAGES, STAGE_POINTS } = require('../models/PartnerPointEvent');
const PartnerTournament = require('../models/PartnerTournament');
const StaffingPartner = require('../models/StaffingPartner');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const Company = require('../models/Company');

// Status category definitions
const SUBMITTED_STATES = new Set([
  'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'SLOT_ASSIGNED',
  'INTERVIEW_CONFIRMED', 'SLOT_DETAILS_SHARED', 'ASSESSMENT_PENDING', 'ASSESSMENT_LINK_SENT',
  'ASSESSMENT_LINK_COMPLETE', 'ASSESSMENT_PASSED', 'INTERVIEW_CONDUCTED', 'INTERVIEWED',
  'ROUND_SELECTED_NEXT', 'ROUND_SELECTED_DIRECT_HR', 'HR_ROUND_PENDING', 'HR_SELECTED',
  'OFFERED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'ONBOARDING', 'JOINED'
]);

const INTERVIEW_STATES = new Set([
  'INTERVIEW_SCHEDULED', 'SLOT_ASSIGNED', 'INTERVIEW_CONFIRMED', 'SLOT_DETAILS_SHARED',
  'RESCHEDULE_REQUESTED', 'INTERVIEW_CONDUCTED', 'INTERVIEWED', 'ROUND_SELECTED_NEXT',
  'ROUND_SELECTED_DIRECT_HR', 'HR_ROUND_PENDING', 'HR_SELECTED', 'OFFERED', 'OFFER_SENT',
  'OFFER_ACCEPTED', 'ONBOARDING', 'JOINED'
]);

const SELECTED_STATES = new Set([
  'HR_SELECTED', 'ROUND_SELECTED_DIRECT_HR', 'OFFERED', 'OFFER_SENT', 'OFFER_ACCEPTED',
  'ONBOARDING', 'JOINED'
]);

const JOINED_STATES = new Set(['JOINED']);

/**
 * Helper to compute live metadata for a tournament
 */
function formatTournament(tournament) {
  if (!tournament) return null;
  const tObj = typeof tournament.toObject === 'function' ? tournament.toObject() : { ...tournament };
  const now = new Date();
  const start = new Date(tObj.startDate);
  const end = new Date(tObj.endDate);

  let status = 'ACTIVE';
  if (!tObj.isActive) {
    status = 'PAUSED';
  } else if (now < start) {
    status = 'UPCOMING';
  } else if (now > end) {
    status = 'COMPLETED';
  }

  const totalDurationMs = Math.max(end - start, 1);
  const elapsedMs = Math.max(0, Math.min(now - start, totalDurationMs));
  const progressPercent = status === 'COMPLETED' ? 100 : (status === 'UPCOMING' ? 0 : Math.round((elapsedMs / totalDurationMs) * 100));

  const timeRemainingMs = Math.max(0, end - now);
  const remainingDays = Math.floor(timeRemainingMs / (1000 * 60 * 60 * 24));
  const remainingHours = Math.floor((timeRemainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  return {
    ...tObj,
    liveStatus: status,
    progressPercent,
    remainingDays,
    remainingHours,
    timeRemainingFormatted: status === 'COMPLETED' ? 'Tournament Ended' : (status === 'UPCOMING' ? 'Starts Soon' : `${remainingDays}d ${remainingHours}h remaining`)
  };
}

/**
 * Get or initialize current active tournament (defaults to latest active or latest created)
 */
async function getCurrentTournament() {
  const now = new Date();
  // Try finding currently running active tournament
  let tournament = await PartnerTournament.findOne({
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
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

  return formatTournament(tournament);
}

/**
 * Get all tournaments (active, upcoming, and past/completed)
 */
async function getAllTournaments() {
  let tournaments = await PartnerTournament.find().sort({ startDate: -1, createdAt: -1 });

  if (!tournaments || tournaments.length === 0) {
    await getCurrentTournament();
    tournaments = await PartnerTournament.find().sort({ startDate: -1, createdAt: -1 });
  }

  return tournaments.map(t => formatTournament(t));
}

/**
 * Get a specific tournament by ID with formatted live status
 */
async function getTournamentById(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return getCurrentTournament();
  }
  const tournament = await PartnerTournament.findById(id);
  if (!tournament) {
    return getCurrentTournament();
  }
  return formatTournament(tournament);
}

/**
 * Create a new tournament / program
 */
async function createTournament(data, userId) {
  const { title, description, startDate, endDate, isActive, rules } = data;
  const now = new Date();
  const start = startDate ? new Date(startDate) : now;
  const end = endDate ? new Date(endDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  let status = 'ACTIVE';
  const activeFlag = isActive !== undefined ? Boolean(isActive) : true;
  if (!activeFlag) status = 'PAUSED';
  else if (now < start) status = 'UPCOMING';
  else if (now > end) status = 'COMPLETED';

  const tournament = await PartnerTournament.create({
    title: title || 'Syncro1 Vendor Performance Challenge 🏆',
    description: description || 'Quality + Speed + Consistency = Higher Score & Recognition 🏆',
    startDate: start,
    endDate: end,
    isActive: activeFlag,
    status,
    rules: rules || {},
    createdBy: userId
  });

  // Recalculate existing points for this new tournament window
  setImmediate(async () => {
    try {
      await backfillExistingPoints(tournament._id);
    } catch (err) {
      console.error('[PARTNER_PROGRAM] Backfill for new tournament failed:', err.message);
    }
  });

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

  const { title, description, startDate, endDate, isActive, rules } = data;
  const now = new Date();
  const start = startDate ? new Date(startDate) : tournament.startDate;
  const end = endDate ? new Date(endDate) : tournament.endDate;

  let status = 'ACTIVE';
  const activeFlag = isActive !== undefined ? Boolean(isActive) : tournament.isActive;
  if (!activeFlag) status = 'PAUSED';
  else if (now < start) status = 'UPCOMING';
  else if (now > end) status = 'COMPLETED';

  if (title) tournament.title = title;
  if (description !== undefined) tournament.description = description;
  tournament.startDate = start;
  tournament.endDate = end;
  tournament.isActive = activeFlag;
  tournament.status = status;
  if (rules) tournament.rules = { ...tournament.rules, ...rules };
  tournament.createdBy = userId || tournament.createdBy;

  await tournament.save();

  // Recalibrate points for updated date range
  setImmediate(async () => {
    try {
      await backfillExistingPoints(tournament._id);
    } catch (err) {
      console.error('[PARTNER_PROGRAM] Auto-recalculate on update failed:', err.message);
    }
  });

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
 * Idempotently award points for a specific milestone stage
 */
async function awardPoints(candidateDoc, stage, tournamentId = null, awardedDate = new Date()) {
  if (!candidateDoc || !candidateDoc.submittedBy) return null;

  const points = STAGE_POINTS[stage];
  if (!points) return null;

  const partnerId = candidateDoc.submittedBy;
  const candidateId = candidateDoc._id;
  const jobId = candidateDoc.job;
  const companyId = candidateDoc.company;

  const metadata = {
    candidateName: `${candidateDoc.firstName || ''} ${candidateDoc.lastName || ''}`.trim(),
    candidateEmail: candidateDoc.email || '',
    jobTitle: candidateDoc.jobTitle || '',
    companyName: candidateDoc.companyName || ''
  };

  try {
    const event = await PartnerPointEvent.create({
      partner: partnerId,
      candidate: candidateId,
      job: jobId,
      company: companyId,
      tournament: tournamentId || null,
      stage,
      points,
      metadata,
      awardedAt: awardedDate || new Date()
    });

    console.log(`[PARTNER_PROGRAM_POINTS] Awarded ${points} pts to partner ${partnerId} for candidate ${candidateId} stage ${stage} (Tournament: ${tournamentId})`);
    return event;
  } catch (err) {
    // Duplicate key error (code 11000) indicates points already awarded for this milestone in this tournament
    if (err.code === 11000) {
      return null;
    }
    console.error(`[PARTNER_PROGRAM_POINTS] Error awarding points:`, err);
    throw err;
  }
}

/**
 * Process candidate state transitions in real time and award eligible stages across ALL active tournaments
 */
async function processCandidateStageChange(candidateDoc) {
  if (!candidateDoc || !candidateDoc.submittedBy) return;

  const status = candidateDoc.status || 'DRAFT';

  // Do not award points for withdrawn, denied or draft states that haven't been submitted
  if (['CONSENT_DENIED', 'CLIENT_PORTAL_DUPLICATE', 'ADMIN_REJECTED'].includes(status)) {
    return;
  }

  const now = new Date();

  // Find all active tournaments running currently whose date window covers 'now'
  let activeTournaments = [];
  try {
    activeTournaments = await PartnerTournament.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });
  } catch (err) {
    console.error('[PARTNER_PROGRAM] Error querying active tournaments:', err.message);
  }

  if (!activeTournaments || activeTournaments.length === 0) {
    return;
  }

  const candCreated = new Date(candidateDoc.createdAt || now);

  const hasInterviews = (candidateDoc.interviews && candidateDoc.interviews.length > 0) ||
    Boolean(candidateDoc.assignedSlot?.isTagged || candidateDoc.assignedSlot?.slotId);

  // Award points independently for each active tournament
  for (const activeTournament of activeTournaments) {
    const tournamentId = activeTournament._id;
    const start = new Date(activeTournament.startDate);
    const end = new Date(activeTournament.endDate);

    // 1. SCREENED / Valid Profile (2 Points)
    if (candidateDoc.email && candidateDoc.firstName && status !== 'DRAFT') {
      if (candCreated >= start && candCreated <= end) {
        await awardPoints(candidateDoc, STAGES.SCREENED, tournamentId, candCreated);
      }
    }

    // 2. SUBMITTED to Company (5 Points)
    if (SUBMITTED_STATES.has(status)) {
      await awardPoints(candidateDoc, STAGES.SUBMITTED_TO_COMPANY, tournamentId, now);
    }

    // 3. INTERVIEW SCHEDULED (10 Points)
    if (INTERVIEW_STATES.has(status) || hasInterviews) {
      await awardPoints(candidateDoc, STAGES.INTERVIEW_SCHEDULED, tournamentId, now);
    }

    // 4. SELECTED (20 Points)
    if (SELECTED_STATES.has(status)) {
      await awardPoints(candidateDoc, STAGES.SELECTED, tournamentId, now);
    }

    // 5. JOINED (40 Points)
    if (JOINED_STATES.has(status)) {
      await awardPoints(candidateDoc, STAGES.JOINED, tournamentId, now);
    }
  }
}

/**
 * Calculate Leaderboard with rankings, point breakdown and recognition badges
 * Scoped strictly to the selected tournament (or current active tournament if none specified)
 */
async function getLeaderboard({ limit = 15, tournamentId = null } = {}) {
  let effectiveTournamentId = tournamentId;
  if (!effectiveTournamentId || effectiveTournamentId === 'current') {
    const currentT = await getCurrentTournament();
    if (currentT) {
      effectiveTournamentId = currentT._id;
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
        screenedCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.SCREENED] }, 1, 0] }
        },
        submittedCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.SUBMITTED_TO_COMPANY] }, 1, 0] }
        },
        interviewCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.INTERVIEW_SCHEDULED] }, 1, 0] }
        },
        selectedCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.SELECTED] }, 1, 0] }
        },
        joinedCount: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.JOINED] }, 1, 0] }
        },
        screenedPoints: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.SCREENED] }, '$points', 0] }
        },
        submittedPoints: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.SUBMITTED_TO_COMPANY] }, '$points', 0] }
        },
        interviewPoints: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.INTERVIEW_SCHEDULED] }, '$points', 0] }
        },
        selectedPoints: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.SELECTED] }, '$points', 0] }
        },
        joinedPoints: {
          $sum: { $cond: [{ $eq: ['$stage', STAGES.JOINED] }, '$points', 0] }
        },
        lastAwardedAt: { $max: '$awardedAt' }
      }
    },
    { $sort: { totalPoints: -1, joinedCount: -1, selectedCount: -1, _id: 1 } },
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

  const rankedPartners = results.map((item, index) => {
    const rank = index + 1;

    const badges = [];
    if (rank >= 1 && rank <= 5) {
      badges.push({ type: 'GOLD_MEDAL', title: 'Top Performing Partner (Gold Medal • Rank 1–5)', icon: '🥇' });
    } else if (rank >= 6 && rank <= 10) {
      badges.push({ type: 'SILVER_MEDAL', title: 'Runner-Up Partner (Silver Medal • Rank 6–10)', icon: '🥈' });
    } else if (rank >= 11 && rank <= 15) {
      badges.push({ type: 'BRONZE_MEDAL', title: 'Bronze Medal Partner (Bronze Medal • Rank 11–15)', icon: '🥉' });
    }

    const partnerName = item.partnerDetails ?
      `${item.partnerDetails.firstName || ''} ${item.partnerDetails.lastName || ''}`.trim() || 'Partner'
      : 'Partner';

    return {
      rank,
      partnerId: item._id,
      partnerName,
      firmName: item.partnerDetails?.firmName || 'Partner Firm',
      city: item.partnerDetails?.city || '',
      state: item.partnerDetails?.state || '',
      totalPoints: item.totalPoints || 0,
      breakdown: {
        screened: { count: item.screenedCount, points: item.screenedPoints },
        submitted: { count: item.submittedCount, points: item.submittedPoints },
        interviewed: { count: item.interviewCount, points: item.interviewPoints },
        selected: { count: item.selectedCount, points: item.selectedPoints },
        joined: { count: item.joinedCount, points: item.joinedPoints }
      },
      badges,
      lastAwardedAt: item.lastAwardedAt
    };
  });

  const top15 = rankedPartners.slice(0, limit);

  return {
    totalParticipants: rankedPartners.length,
    leaderboard: top15,
    allRankings: rankedPartners
  };
}

/**
 * Get detailed stats and recent transactions for a single partner in a tournament
 */
async function getPartnerProgramStats(partnerId, { tournamentId = null } = {}) {
  let effectiveTournamentId = tournamentId;
  if (!effectiveTournamentId || effectiveTournamentId === 'current') {
    const currentT = await getCurrentTournament();
    if (currentT) {
      effectiveTournamentId = currentT._id;
    }
  }

  const { allRankings } = await getLeaderboard({ limit: 1000, tournamentId: effectiveTournamentId });

  const partnerIdStr = String(partnerId);
  const partnerRankInfo = allRankings.find(p => String(p.partnerId) === partnerIdStr);

  const filter = { partner: partnerId };
  if (effectiveTournamentId && effectiveTournamentId !== 'all' && mongoose.Types.ObjectId.isValid(effectiveTournamentId)) {
    filter.tournament = effectiveTournamentId;
  }

  // Fetch recent point events for this tournament
  const recentEvents = await PartnerPointEvent.find(filter)
    .sort({ awardedAt: -1 })
    .limit(20)
    .lean();

  const partnerDoc = await StaffingPartner.findById(partnerId).lean();

  const rank = partnerRankInfo ? partnerRankInfo.rank : (allRankings.length + 1);
  const totalPoints = partnerRankInfo ? partnerRankInfo.totalPoints : 0;
  const breakdown = partnerRankInfo ? partnerRankInfo.breakdown : {
    screened: { count: 0, points: 0 },
    submitted: { count: 0, points: 0 },
    interviewed: { count: 0, points: 0 },
    selected: { count: 0, points: 0 },
    joined: { count: 0, points: 0 }
  };
  const badges = partnerRankInfo ? partnerRankInfo.badges : [];

  return {
    partnerId,
    firmName: partnerDoc?.firmName || 'Your Firm',
    partnerName: partnerDoc ? `${partnerDoc.firstName || ''} ${partnerDoc.lastName || ''}`.trim() : 'You',
    rank,
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

  // Filter by search query if provided
  let filtered = allRankings;
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = allRankings.filter(p =>
      p.partnerName.toLowerCase().includes(q) ||
      p.firmName.toLowerCase().includes(q) ||
      (p.city && p.city.toLowerCase().includes(q))
    );
  }

  // Calculate platform KPIs for this tournament
  const totalPointsAwarded = allRankings.reduce((sum, p) => sum + p.totalPoints, 0);
  const totalScreenedProfiles = allRankings.reduce((sum, p) => sum + p.breakdown.screened.count, 0);
  const totalCompanySubmissions = allRankings.reduce((sum, p) => sum + p.breakdown.submitted.count, 0);
  const totalInterviews = allRankings.reduce((sum, p) => sum + p.breakdown.interviewed.count, 0);
  const totalSelections = allRankings.reduce((sum, p) => sum + p.breakdown.selected.count, 0);
  const totalClosures = allRankings.reduce((sum, p) => sum + p.breakdown.joined.count, 0);
  const topPartner = allRankings[0] || null;

  // Pagination
  const startIndex = (page - 1) * limit;
  const paginatedRankings = filtered.slice(startIndex, startIndex + limit);

  return {
    kpis: {
      totalPointsAwarded,
      totalPartnersParticipating: allRankings.length,
      totalScreenedProfiles,
      totalCompanySubmissions,
      totalInterviews,
      totalSelections,
      totalClosures,
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
 * Get itemized point events for audit drawer
 */
async function getPartnerAuditEvents(partnerId, tournamentId = null) {
  const query = { partner: partnerId };
  if (tournamentId && tournamentId !== 'all' && mongoose.Types.ObjectId.isValid(tournamentId)) {
    query.tournament = tournamentId;
  }

  const events = await PartnerPointEvent.find(query)
    .sort({ awardedAt: -1 })
    .lean();

  const partner = await StaffingPartner.findById(partnerId).lean();

  return {
    partner: partner ? {
      _id: partner._id,
      firstName: partner.firstName,
      lastName: partner.lastName,
      firmName: partner.firmName,
      city: partner.city,
      state: partner.state
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

  // Clear existing points recorded for this tournament so recalculation is 100% clean and scoped
  await PartnerPointEvent.deleteMany({ tournament: tournamentId });

  // Find all candidates submitted by partners that have activity on or after tournament.startDate
  const candidates = await Candidate.find({
    submittedBy: { $ne: null },
    $or: [
      { createdAt: { $gte: start, $lte: end } },
      { 'statusHistory.changedAt': { $gte: start, $lte: end } },
      { updatedAt: { $gte: start } }
    ]
  })
    .populate('job', 'title')
    .populate('company', 'companyName')
    .lean();

  let processedCount = 0;
  for (const cand of candidates) {
    try {
      const candidateDoc = {
        ...cand,
        jobTitle: cand.job?.title || 'Position',
        companyName: cand.company?.companyName || 'Company'
      };

      const candCreated = new Date(cand.createdAt);

      // 1. SCREENED: candidate created within [start, end]
      if (cand.email && cand.firstName && cand.status !== 'DRAFT') {
        if (candCreated >= start && candCreated <= end) {
          await awardPoints(candidateDoc, STAGES.SCREENED, tournamentId, candCreated);
        }
      }

      // 2. SUBMITTED to Company: status transition occurred within [start, end]
      const submittedEntry = cand.statusHistory?.find(h => SUBMITTED_STATES.has(h.status));
      const submittedDate = submittedEntry?.changedAt ? new Date(submittedEntry.changedAt) : (SUBMITTED_STATES.has(cand.status) ? candCreated : null);
      if (submittedDate && submittedDate >= start && submittedDate <= end) {
        await awardPoints(candidateDoc, STAGES.SUBMITTED_TO_COMPANY, tournamentId, submittedDate);
      }

      // 3. INTERVIEW SCHEDULED: scheduled within [start, end]
      const interviewEntry = cand.statusHistory?.find(h => INTERVIEW_STATES.has(h.status));
      const interviewDate = cand.interviews?.[0]?.scheduledAt ? new Date(cand.interviews[0].scheduledAt) : (interviewEntry?.changedAt ? new Date(interviewEntry.changedAt) : null);
      if (interviewDate && interviewDate >= start && interviewDate <= end) {
        await awardPoints(candidateDoc, STAGES.INTERVIEW_SCHEDULED, tournamentId, interviewDate);
      }

      // 4. SELECTED: selected within [start, end]
      const selectedEntry = cand.statusHistory?.find(h => SELECTED_STATES.has(h.status));
      const selectedDate = selectedEntry?.changedAt ? new Date(selectedEntry.changedAt) : null;
      if (selectedDate && selectedDate >= start && selectedDate <= end) {
        await awardPoints(candidateDoc, STAGES.SELECTED, tournamentId, selectedDate);
      }

      // 5. JOINED: joined within [start, end]
      const joinedEntry = cand.statusHistory?.find(h => h.status === 'JOINED');
      const joinedDate = joinedEntry?.changedAt ? new Date(joinedEntry.changedAt) : null;
      if (joinedDate && joinedDate >= start && joinedDate <= end) {
        await awardPoints(candidateDoc, STAGES.JOINED, tournamentId, joinedDate);
      }

      processedCount++;
    } catch (err) {
      console.error(`[PARTNER_PROGRAM] Sync failed for candidate ${cand._id}:`, err.message);
    }
  }

  console.log(`[PARTNER_PROGRAM] Completed sync: evaluated ${processedCount} candidates strictly within tournament window.`);
  return {
    success: true,
    processedCandidates: processedCount,
    startDate: start,
    endDate: end
  };
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
  backfillExistingPoints
};
