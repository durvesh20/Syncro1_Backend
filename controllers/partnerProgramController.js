// backend/controllers/partnerProgramController.js
const partnerProgramService = require('../services/partnerProgramService');
const StaffingPartner = require('../models/StaffingPartner');

/**
 * GET /api/staffing-partners/partner-program/tournaments
 * or GET /api/admin/partner-program/tournaments
 * List all tournaments (active, upcoming, and past/archived)
 */
exports.getAllTournaments = async (req, res) => {
  try {
    const tournaments = await partnerProgramService.getAllTournaments();
    return res.status(200).json({
      success: true,
      data: tournaments
    });
  } catch (error) {
    console.error('Error fetching tournaments list:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch tournaments list',
      error: error.message
    });
  }
};

/**
 * GET /api/staffing-partners/partner-program/tournaments/:id
 * or GET /api/admin/partner-program/tournaments/:id
 */
exports.getTournamentById = async (req, res) => {
  try {
    const tournament = await partnerProgramService.getTournamentById(req.params.id);
    return res.status(200).json({
      success: true,
      data: tournament
    });
  } catch (error) {
    console.error('Error fetching tournament details:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch tournament details',
      error: error.message
    });
  }
};

/**
 * GET /api/staffing-partners/partner-program/tournament
 * or GET /api/admin/partner-program/tournament
 * Get current active tournament timeline
 */
exports.getCurrentTournament = async (req, res) => {
  try {
    const tournament = await partnerProgramService.getCurrentTournament();
    return res.status(200).json({
      success: true,
      data: tournament
    });
  } catch (error) {
    console.error('Error fetching tournament:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch tournament schedule',
      error: error.message
    });
  }
};

/**
 * POST /api/admin/partner-program/tournaments
 * Admin create a brand new tournament / challenge
 */
exports.createTournament = async (req, res) => {
  try {
    const tournament = await partnerProgramService.createTournament(req.body, req.user?._id);
    return res.status(201).json({
      success: true,
      message: 'New program created successfully',
      data: tournament
    });
  } catch (error) {
    console.error('Error creating program:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create program',
      error: error.message
    });
  }
};

/**
 * PUT /api/admin/partner-program/tournaments/:id
 * Admin update an existing tournament
 */
exports.updateTournament = async (req, res) => {
  try {
    const tournament = await partnerProgramService.updateTournament(req.params.id, req.body, req.user?._id);
    return res.status(200).json({
      success: true,
      message: 'Program schedule updated successfully',
      data: tournament
    });
  } catch (error) {
    console.error('Error updating program:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to update program schedule',
      error: error.message
    });
  }
};

/**
 * DELETE /api/admin/partner-program/tournaments/:id
 * Admin delete a tournament and its points
 */
exports.deleteTournament = async (req, res) => {
  try {
    const result = await partnerProgramService.deleteTournament(req.params.id);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error deleting program:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete program',
      error: error.message
    });
  }
};

/**
 * POST /api/admin/partner-program/tournament
 * (Backward compatibility) Admin create or update tournament
 */
exports.saveTournament = async (req, res) => {
  try {
    const tournament = await partnerProgramService.saveTournament(req.body, req.user?._id);
    return res.status(200).json({
      success: true,
      message: 'Tournament schedule updated successfully',
      data: tournament
    });
  } catch (error) {
    console.error('Error updating tournament schedule:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update tournament schedule',
      error: error.message
    });
  }
};

/**
 * GET /api/staffing-partners/partner-program/leaderboard
 * Get Top 15 Leaderboard and current partner's position (optionally scoped by tournamentId)
 */
exports.getLeaderboard = async (req, res) => {
  try {
    const tournamentId = req.query.tournamentId || null;
    let tournament;
    if (tournamentId && tournamentId !== 'all') {
      tournament = await partnerProgramService.getTournamentById(tournamentId);
    } else {
      tournament = await partnerProgramService.getCurrentTournament();
    }

    const leaderboardData = await partnerProgramService.getLeaderboard({
      limit: 15,
      tournamentId: tournament?._id || tournamentId
    });

    let currentPartnerStats = null;
    if (req.user) {
      const partner = await StaffingPartner.findOne({ user: req.user._id });
      if (partner) {
        currentPartnerStats = await partnerProgramService.getPartnerProgramStats(partner._id, {
          tournamentId: tournament?._id || tournamentId
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        tournament,
        currentPartner: currentPartnerStats,
        ...leaderboardData
      }
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch leaderboard data',
      error: error.message
    });
  }
};

/**
 * GET /api/staffing-partners/partner-program/stats
 * Detailed statistics and point activity history for current partner (optionally scoped by tournamentId)
 */
exports.getPartnerStats = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner profile not found'
      });
    }

    const tournamentId = req.query.tournamentId || null;
    let tournament;
    if (tournamentId && tournamentId !== 'all') {
      tournament = await partnerProgramService.getTournamentById(tournamentId);
    } else {
      tournament = await partnerProgramService.getCurrentTournament();
    }

    const stats = await partnerProgramService.getPartnerProgramStats(partner._id, {
      tournamentId: tournament?._id || tournamentId
    });

    return res.status(200).json({
      success: true,
      data: {
        tournament,
        ...stats
      }
    });
  } catch (error) {
    console.error('Error fetching partner stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch partner program statistics',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/partner-program/rankings
 * Full partner rankings for Admin analysis with stage breakdown (optionally scoped by tournamentId)
 */
exports.getAdminRankings = async (req, res) => {
  try {
    const { search = '', page = 1, limit = 50, tournamentId = null } = req.query;

    let tournament;
    if (tournamentId && tournamentId !== 'all') {
      tournament = await partnerProgramService.getTournamentById(tournamentId);
    } else {
      tournament = await partnerProgramService.getCurrentTournament();
    }

    const rankingsData = await partnerProgramService.getAdminPartnerRankings({
      search,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
      tournamentId: tournament?._id || tournamentId
    });

    return res.status(200).json({
      success: true,
      data: {
        tournament,
        ...rankingsData
      }
    });
  } catch (error) {
    console.error('Error fetching admin partner rankings:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch partner rankings',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/partner-program/:partnerId/audit
 * Itemized point events for a partner for deep analysis (optionally scoped by tournamentId)
 */
exports.getAdminPartnerAudit = async (req, res) => {
  try {
    const { partnerId } = req.params;
    const { tournamentId = null } = req.query;
    const auditData = await partnerProgramService.getPartnerAuditEvents(partnerId, tournamentId);

    return res.status(200).json({
      success: true,
      data: auditData
    });
  } catch (error) {
    console.error('Error fetching partner audit events:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch partner point audit',
      error: error.message
    });
  }
};

/**
 * POST /api/admin/partner-program/backfill
 * Idempotently recalculate and backfill points for a specific tournament
 */
exports.triggerBackfill = async (req, res) => {
  try {
    const targetTournamentId = req.query.tournamentId || req.body?.tournamentId || null;
    const result = await partnerProgramService.backfillExistingPoints(targetTournamentId);
    return res.status(200).json({
      success: true,
      message: 'Partner program points backfill completed successfully',
      data: result
    });
  } catch (error) {
    console.error('Error triggering backfill:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to backfill points',
      error: error.message
    });
  }
};
