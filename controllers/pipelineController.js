/**
 * pipelineController.js
 * Phase 1 endpoints — application-level pipeline actions.
 * All DB writes go through the FSM; direct status mutation is forbidden.
 */

const Candidate = require('../models/Candidate');
const InterviewSlot = require('../models/InterviewSlot');
const Job = require('../models/Job');
const {
  transition,
  validatePipelineTemplate,
  getInitialRoundState,
  PIPELINE_STATES,
  ACTIONS,
  ROLES,
} = require('../services/pipelineStateMachine');
const auditService = require('../services/auditService');

// ─── helpers ─────────────────────────────────────────────────────────────────

function roleFromReq(req) {
  // Map Syncro1 DB role strings to FSM role constants
  const map = {
    company: ROLES.COMPANY,
    staffing_partner: ROLES.STAFFING_PARTNER,
    candidate: ROLES.CANDIDATE,
    admin: ROLES.ADMIN,
    sub_admin: ROLES.ADMIN,  // sub_admin is also read-only in pipeline
  };
  return map[req.user?.role] || req.user?.role;
}

async function verifyCompanyCandidateOwnership(candidateId, userId) {
  const User = require('../models/User');
  const user = await User.findById(userId);
  const isAdmin = user && (user.role === 'admin' || user.role === 'sub_admin');

  const candidate = await Candidate.findById(candidateId).populate('job');
  if (!candidate) throw Object.assign(new Error('Candidate not found'), { statusCode: 404 });

  if (isAdmin) {
    return { candidate, company: null };
  }

  const Company = require('../models/Company');
  const company = await Company.findOne({ user: userId });
  if (!company) throw Object.assign(new Error('Company profile not found'), { statusCode: 403 });

  if (candidate.company.toString() !== company._id.toString()) {
    throw Object.assign(new Error('Access denied: candidate does not belong to your company'), { statusCode: 403 });
  }
  return { candidate, company };
}

function writeAudit(candidate, { actorId, actorRole, action, fromState, toState, reason, roundIndex }) {
  candidate.auditTrail.push({ actorId, actorRole, action, fromState, toState, reason, roundIndex, timestamp: new Date() });
}

async function sendPipelineEmail(role, candidateId, subject, htmlContent) {
  try {
    const candidate = await Candidate.findById(candidateId)
      .populate({ path: 'company', populate: { path: 'user', select: 'email' } })
      .populate({ path: 'submittedBy', populate: { path: 'user', select: 'email' } });
      
    if (!candidate) return;
    
    let targetEmail = null;
    if (role === 'company' && candidate.company?.user?.email) {
      targetEmail = candidate.company.user.email;
    } else if (role === 'partner' && candidate.submittedBy?.user?.email) {
      targetEmail = candidate.submittedBy.user.email;
    }
    
    if (targetEmail) {
      const emailService = require('../services/emailService');
      await emailService.sendEmail({
        to: targetEmail,
        subject,
        html: htmlContent
      });
    }
  } catch (err) {
    console.error(`[PIPELINE] Failed to send email to ${role}:`, err.message);
  }
}

function handleFsmError(fsmResult, res) {
  const statusMap = { FORBIDDEN: 403, ADMIN_READONLY: 403, RESCHEDULE_CAP: 422, TERMINAL_STATE: 422 };
  const httpStatus = statusMap[fsmResult.code] || 400;
  return res.status(httpStatus).json({ success: false, message: fsmResult.error, code: fsmResult.code });
}

// ─── POST /api/companies/candidates/:id/shortlist ─────────────────────────────
// Extends the existing shortlistCandidate — re-uses same route but wires FSM.
// Called after SUBMITTED; moves candidate to SHORTLISTED in our pipeline context.
exports.pipelineShortlist = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    // The existing lifecycle service already handles SUBMITTED → SHORTLISTED.
    // We only need to handle the case where it arrives already at SHORTLISTED
    // (or re-shortlisting from REJECTED — see pipelineReShortlist below).
    // For forward compatibility, accept from SUBMITTED too.
    const allowedFrom = ['SUBMITTED', 'UNDER_REVIEW'];
    if (!allowedFrom.includes(fromState)) {
      return res.status(400).json({
        success: false,
        message: `Cannot shortlist from status "${fromState}". Allowed from: ${allowedFrom.join(', ')}`
      });
    }

    let toState = PIPELINE_STATES.SHORTLISTED;
    await candidate.populate('job');

    if (candidate.job && candidate.job.pipelineTemplate && candidate.job.pipelineTemplate.length > 0) {
      const normalized = candidate.job.pipelineTemplate.map((r, i) => ({
        roundType: r.roundType,
        order: r.order ?? i + 1
      }));
      candidate.pipelineTemplate = normalized;
      candidate.rounds = normalized.map(r => ({
        roundType: r.roundType,
        order: r.order,
        status: getInitialRoundState(r.roundType),
        slots: [],
        rescheduleCount: { candidateInitiated: 0, clientInitiated: 0, partnerInitiated: 0 }
      }));
      if (candidate.rounds.length > 0) {
        toState = candidate.rounds[0].status;
      }
    }

    candidate.status = toState;
    candidate.statusHistory.push({ status: toState, changedBy: req.user._id, changedAt: new Date(), notes: req.body.notes || 'Shortlisted' });
    writeAudit(candidate, { actorId: req.user._id, actorRole: role, action: ACTIONS.SHORTLIST, fromState, toState, reason: req.body.notes });
    await candidate.save();

    await auditService.log({ actor: req.user._id, actorRole: req.user.role, action: 'PIPELINE_SHORTLIST', entityType: 'Candidate', entityId: candidate._id, description: `Candidate shortlisted`, ipAddress: req.ip });

    await sendPipelineEmail('partner', candidate._id, `🎉 Candidate Shortlisted - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">🎉 Candidate Shortlisted</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Great news! Your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been shortlisted for the <strong>${candidate.job?.title}</strong> role.</p>
          <p>You can check the candidate's progress in your dashboard.</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Candidate shortlisted', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] shortlist error:', err);
    res.status(500).json({ success: false, message: 'Failed to shortlist candidate' });
  }
};

// ─── PUT /api/companies/candidates/:id/pipeline/reject ───────────────────────
exports.pipelineReject = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
      return res.status(400).json({ success: false, message: 'A reason is required (minimum 5 characters).', code: 'REASON_REQUIRED' });
    }

    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    let toState;
    const allowedFrom = ['SUBMITTED', 'UNDER_REVIEW'];
    if (allowedFrom.includes(fromState)) {
      toState = PIPELINE_STATES.REJECTED;
    } else {
      const fsm = transition({ currentState: fromState, action: ACTIONS.REJECT, role, payload: { reason } });
      if (!fsm.ok) return handleFsmError(fsm, res);
      toState = fsm.nextState;
    }

    candidate.status = toState;
    candidate.statusHistory.push({ status: toState, changedBy: req.user._id, changedAt: new Date(), notes: reason });
    writeAudit(candidate, { actorId: req.user._id, actorRole: role, action: ACTIONS.REJECT, fromState, toState, reason });
    await candidate.save();

    await auditService.log({ actor: req.user._id, actorRole: req.user.role, action: 'PIPELINE_REJECT', entityType: 'Candidate', entityId: candidate._id, description: `Candidate rejected. Reason: ${reason}`, ipAddress: req.ip });

    await sendPipelineEmail('partner', candidate._id, `❌ Candidate Status Update - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Unfortunately, your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been rejected for the <strong>${candidate.job?.title}</strong> role.</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Candidate rejected', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] reject error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject candidate' });
  }
};

// ─── PUT /api/companies/candidates/:id/pipeline/re-shortlist ─────────────────
exports.pipelineReShortlist = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.RE_SHORTLIST, role, payload: req.body });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: req.body.notes || 'Re-shortlisted' });
    writeAudit(candidate, { actorId: req.user._id, actorRole: role, action: ACTIONS.RE_SHORTLIST, fromState, toState: fsm.nextState, reason: req.body.notes });
    await candidate.save();

    await auditService.log({ actor: req.user._id, actorRole: req.user.role, action: 'PIPELINE_RE_SHORTLIST', entityType: 'Candidate', entityId: candidate._id, description: 'Candidate re-shortlisted after rejection', ipAddress: req.ip });

    res.json({ success: true, message: 'Candidate re-shortlisted', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] re-shortlist error:', err);
    res.status(500).json({ success: false, message: 'Failed to re-shortlist candidate' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/template ────────────────────
// Define/replace the round sequence for this candidate.
exports.definePipelineTemplate = async (req, res) => {
  try {
    const { rounds } = req.body; // [{ roundType, order }]
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);

    const ALLOWED_INITIAL_STATES = [
      PIPELINE_STATES.SHORTLISTED,
      PIPELINE_STATES.SLOTS_NOT_PUBLISHED,
      PIPELINE_STATES.ASSESSMENT_PENDING
    ];
    if (!ALLOWED_INITIAL_STATES.includes(candidate.status)) {
      return res.status(400).json({ success: false, message: `Pipeline can only be defined when candidate is in initial stages (SHORTLISTED, SLOTS_NOT_PUBLISHED, ASSESSMENT_PENDING). Current status: ${candidate.status}` });
    }

    const validation = validatePipelineTemplate(rounds);
    if (!validation.ok) return res.status(400).json({ success: false, message: validation.error });

    // Assign order if not provided
    const normalized = rounds.map((r, i) => ({ roundType: r.roundType, order: r.order ?? i + 1 }));

    candidate.pipelineTemplate = normalized;

    // Initialise rounds array (execution state) — each round starts in its initial state
    candidate.rounds = normalized.map(r => ({
      roundType: r.roundType,
      order: r.order,
      status: getInitialRoundState(r.roundType),
      slots: [],
      rescheduleCount: { candidateInitiated: 0, clientInitiated: 0, partnerInitiated: 0 },
    }));

    // Auto-advance top-level candidate status to the first round's initial state
    if (candidate.rounds.length > 0) {
      candidate.status = candidate.rounds[0].status;
      candidate.statusHistory.push({
        status: candidate.status,
        changedBy: req.user._id,
        changedAt: new Date(),
        notes: `Pipeline template defined: started first round (${candidate.rounds[0].roundType})`
      });
    }

    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: roleFromReq(req),
      action: ACTIONS.DEFINE_PIPELINE,
      fromState: PIPELINE_STATES.SHORTLISTED,
      toState: candidate.status,
      reason: `Pipeline defined: ${normalized.map(r => r.roundType).join(' → ')}`
    });

    await candidate.save();

    await auditService.log({ actor: req.user._id, actorRole: req.user.role, action: 'PIPELINE_TEMPLATE_DEFINED', entityType: 'Candidate', entityId: candidate._id, description: `Pipeline template defined: ${normalized.map(r => r.roundType).join(' → ')}`, ipAddress: req.ip });

    res.status(201).json({
      success: true,
      message: 'Pipeline template saved',
      data: {
        candidateId: candidate._id,
        pipelineTemplate: candidate.pipelineTemplate,
        rounds: candidate.rounds.map(r => ({ roundType: r.roundType, order: r.order, status: r.status }))
      }
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] definePipelineTemplate error:', err);
    res.status(500).json({ success: false, message: 'Failed to define pipeline template' });
  }
};

// Define/replace the round sequence for a Job position.
// POST /api/companies/jobs/:jobId/pipeline/template
exports.defineJobPipelineTemplate = async (req, res) => {
  try {
    const { rounds } = req.body; // [{ roundType, order }]
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'sub_admin';

    if (!isAdmin) {
      const Company = require('../models/Company');
      const company = await Company.findOne({ user: req.user._id });
      if (!company) {
        return res.status(403).json({ success: false, message: 'Company profile not found' });
      }

      if (job.company.toString() !== company._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied: Job does not belong to your company' });
      }
    }

    const validation = validatePipelineTemplate(rounds);
    if (!validation.ok) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    const normalized = rounds.map((r, i) => ({
      roundType: r.roundType,
      order: r.order ?? i + 1
    }));

    job.pipelineTemplate = normalized;
    await job.save();

    // Auto-initialize currently shortlisted candidates or update candidates in initial pipeline states who haven't progressed
    const candidatesToUpdate = await Candidate.find({
      job: job._id,
      status: { $in: ['SHORTLISTED', 'SLOTS_NOT_PUBLISHED', 'ASSESSMENT_PENDING'] }
    });

    for (const cand of candidatesToUpdate) {
      cand.pipelineTemplate = normalized;
      cand.rounds = normalized.map(r => ({
        roundType: r.roundType,
        order: r.order,
        status: getInitialRoundState(r.roundType),
        slots: [],
        rescheduleCount: { candidateInitiated: 0, clientInitiated: 0, partnerInitiated: 0 }
      }));
      if (cand.rounds.length > 0) {
        cand.status = cand.rounds[0].status;
        cand.statusHistory.push({
          status: cand.status,
          changedBy: req.user._id,
          changedAt: new Date(),
          notes: `Job pipeline template applied/updated: started first round (${cand.rounds[0].roundType})`
        });
      }
      await cand.save();
    }

    res.status(200).json({
      success: true,
      message: 'Job pipeline template saved and applied to shortlisted candidates.',
      data: {
        jobId: job._id,
        pipelineTemplate: job.pipelineTemplate
      }
    });

  } catch (err) {
    console.error('[PIPELINE] defineJobPipelineTemplate error:', err);
    res.status(500).json({ success: false, message: 'Failed to define job pipeline template' });
  }
};

// Retrieve the round sequence for a Job position.
// GET /api/companies/jobs/:jobId/pipeline/template
exports.getJobPipelineTemplate = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await Job.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'sub_admin') {
      const Company = require('../models/Company');
      const company = await Company.findOne({ user: req.user._id });
      if (!company) {
        return res.status(403).json({ success: false, message: 'Company profile not found' });
      }
      if (job.company.toString() !== company._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied: Job does not belong to your company' });
      }
    }

    res.json({
      success: true,
      data: {
        jobId: job._id,
        pipelineTemplate: job.pipelineTemplate || []
      }
    });

  } catch (err) {
    console.error('[PIPELINE] getJobPipelineTemplate error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch job pipeline template' });
  }
};

// Helper to populate candidate rounds with job-level slots dynamically
async function populateRoundsWithJobSlots(candidate) {
  if (!candidate || !candidate.rounds || candidate.rounds.length === 0) {
    return [];
  }

  // Map helper to structure slot data fully
  const mapSlotDetails = (slot) => {
    if (!slot) return null;
    return {
      _id: slot._id,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      mode: slot.interviewMode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL',
      interviewMode: slot.interviewMode,
      capacity: slot.availableSpots,
      maxCandidates: slot.maxCandidates,
      availableSpots: slot.availableSpots,
      averageTime: slot.averageTime,
      notes: slot.notes,
      status: slot.status,
      createdAt: slot.createdAt,
      createdBy: slot.createdBy ? {
        _id: slot.createdBy._id,
        email: slot.createdBy.email,
        role: slot.createdBy.role
      } : null,
      bookedCandidates: slot.bookedCandidates ? slot.bookedCandidates.map(b => ({
        candidate: b.candidate ? {
          _id: b.candidate._id,
          firstName: b.candidate.firstName,
          lastName: b.candidate.lastName,
          email: b.candidate.email,
          uniqueId: b.candidate.uniqueId
        } : null,
        partner: b.partner ? {
          _id: b.partner._id,
          firmName: b.partner.firmName,
          firstName: b.partner.firstName,
          lastName: b.partner.lastName,
          uniqueId: b.partner.uniqueId
        } : null,
        bookedAt: b.bookedAt,
        bookingStatus: b.bookingStatus,
        cancelledAt: b.cancelledAt,
        cancelReason: b.cancelReason
      })) : []
    };
  };

  // 1. Fetch booked slot if assigned
  let bookedSlot = null;
  if (candidate.assignedSlot) {
    try {
      bookedSlot = await InterviewSlot.findById(candidate.assignedSlot)
        .populate('createdBy', 'email role')
        .populate('bookedCandidates.candidate', 'firstName lastName email uniqueId interviewConfig')
        .populate('bookedCandidates.partner', 'firmName firstName lastName uniqueId');
    } catch (err) {
      console.error('[PIPELINE] Error fetching candidate booked slot:', err);
    }
  }

  const populatedRounds = [];

  for (let i = 0; i < candidate.rounds.length; i++) {
    const r = candidate.rounds[i];
    const roundObj = r.toObject ? r.toObject() : JSON.parse(JSON.stringify(r));

    // If candidate already has slot(s) assigned in this round, preserve them directly!
    if (r.slots && r.slots.length > 0) {
      roundObj.slots = r.slots.map(s => s.toObject ? s.toObject() : JSON.parse(JSON.stringify(s)));
      populatedRounds.push(roundObj);
      continue;
    }

    // Otherwise, fetch active slots for booking from database
    try {
      const jobId = candidate.job?._id || candidate.job;
      
      const rt = (roundObj.roundType || '').trim().toUpperCase();
      const hrNames = ['HR', 'HR ROUND', 'HR_ROUND', 'HUMAN RESOURCE', 'HUMAN RESOURCE ROUND'];
      const isHr = hrNames.includes(rt);
      
      const roundTypeQuery = isHr 
        ? { $in: [roundObj.roundType, ...hrNames.map(n => new RegExp(`^${n}$`, 'i')), /HR_ROUND/i, /HR Round/i] }
        : roundObj.roundType;

      const allSlots = await InterviewSlot.find({
        job: jobId,
        roundType: roundTypeQuery
      })
        .populate('createdBy', 'email role')
        .populate('bookedCandidates.candidate', 'firstName lastName email uniqueId interviewConfig')
        .populate('bookedCandidates.partner', 'firmName firstName lastName uniqueId')
        .sort({ date: -1, startTime: -1 });

      if (allSlots.length > 0) {
        // We only want to map slots if we didn't already set one from bookedSlot
        // But wait, bookedSlot is just ONE slot the candidate is currently assigned to.
        // If we want history, we should show ALL slots for this round.
        // Let's merge or just use allSlots!
        
        // Let's use allSlots, but highlight the bookedSlot if it exists
        // The mapping logic is the same:
        roundObj.slots = allSlots.map(slot => {
           const mapped = mapSlotDetails(slot);
           
           // If this specific slot is the booked slot, we inject the specific candidate coordinates
           if (bookedSlot && slot._id.toString() === bookedSlot._id.toString()) {
              const displayMode = candidate.interviewConfig?.mode || bookedSlot.interviewMode || 'Virtual';
              const isVirtual = displayMode.toLowerCase() === 'virtual';
              const detailsVal = candidate.interviewConfig?.details || bookedSlot.interviewDetails || bookedSlot.notes || '';
              mapped.details = {
                address: !isVirtual ? detailsVal : '',
                meetingLink: isVirtual ? detailsVal : '',
                pointOfContact: {
                  name: candidate.interviewConfig?.interviewer || bookedSlot.interviewerName || '',
                  email: '',
                  phone: ''
                }
              };
           }
           return mapped;
        }).filter(Boolean);

        // Dynamically elevate status to SLOTS_PUBLISHED so the frontend renders the booking UI
        // ONLY if the round is currently SLOTS_NOT_PUBLISHED and there are ACTIVE slots
        if (roundObj.status === 'SLOTS_NOT_PUBLISHED' && allSlots.some(s => s.status === 'ACTIVE')) {
          roundObj.status = 'SLOTS_PUBLISHED';
        }
      } else {
        // If we have a bookedSlot but no slots were found (edge case), keep the bookedSlot logic
        if (bookedSlot && roundObj.roundType === bookedSlot.roundType) {
          const displayMode = candidate.interviewConfig?.mode || bookedSlot.interviewMode || 'Virtual';
          const isVirtual = displayMode.toLowerCase() === 'virtual';
          const mapped = mapSlotDetails(bookedSlot);
          if (mapped) {
            const detailsVal = candidate.interviewConfig?.details || bookedSlot.interviewDetails || bookedSlot.notes || '';
            mapped.details = {
              address: !isVirtual ? detailsVal : '',
              meetingLink: isVirtual ? detailsVal : '',
              pointOfContact: {
                name: candidate.interviewConfig?.interviewer || bookedSlot.interviewerName || '',
                email: '',
                phone: ''
              }
            };
            roundObj.slots = [mapped];
          } else {
            roundObj.slots = [];
          }
        } else {
          roundObj.slots = [];
        }
      }
    } catch (err) {
      console.error('[PIPELINE] Error fetching all slots:', err);
      roundObj.slots = [];
    }

    populatedRounds.push(roundObj);
  }

  return populatedRounds;
}

// ─── GET /api/companies/candidates/:id/pipeline ───────────────────────────────
// Returns pipeline template + round statuses for flowchart rendering.
exports.getPipelinePreview = async (req, res) => {
  try {
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);

    let populatedRounds = await populateRoundsWithJobSlots(candidate);
    let pipelineTemplate = candidate.pipelineTemplate;

    if ((!pipelineTemplate || pipelineTemplate.length === 0) && candidate.job && candidate.job.pipelineTemplate && candidate.job.pipelineTemplate.length > 0) {
      pipelineTemplate = candidate.job.pipelineTemplate;
      populatedRounds = candidate.job.pipelineTemplate.map((r, idx) => ({
        roundType: r.roundType,
        order: r.order || idx + 1,
        status: 'NOT_STARTED',
        slots: []
      }));
    }

    res.json({
      success: true,
      data: {
        candidateId: candidate._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        currentStatus: candidate.status,
        pipelineTemplate: pipelineTemplate,
        rounds: populatedRounds,
        hrRound: candidate.hrRound,
        auditTrail: [],
        job: candidate.job,
        offer: candidate.offer,
      }
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] getPipelinePreview error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pipeline' });
  }
};

// ─── GET /api/admin/candidates/:id/pipeline  (Admin read-only) ────────────────
exports.adminGetPipeline = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
      .populate('pipelineTemplate')
      .populate('job')
      .populate('auditTrail.actorId', 'email role');

    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found' });

    let populatedRounds = await populateRoundsWithJobSlots(candidate);
    let pipelineTemplate = candidate.pipelineTemplate;

    if ((!pipelineTemplate || pipelineTemplate.length === 0) && candidate.job && candidate.job.pipelineTemplate && candidate.job.pipelineTemplate.length > 0) {
      pipelineTemplate = candidate.job.pipelineTemplate;
      populatedRounds = candidate.job.pipelineTemplate.map((r, idx) => ({
        roundType: r.roundType,
        order: r.order || idx + 1,
        status: 'NOT_STARTED',
        slots: []
      }));
    }

    res.json({
      success: true,
      data: {
        candidateId: candidate._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        currentStatus: candidate.status,
        pipelineTemplate: pipelineTemplate,
        rounds: populatedRounds,
        hrRound: candidate.hrRound,
        auditTrail: candidate.auditTrail,
        job: candidate.job,
        offer: candidate.offer,
      }
    });
  } catch (err) {
    console.error('[PIPELINE][ADMIN] getPipeline error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pipeline' });
  }
};

// ─── GET /api/staffing-partners/submissions/:id/pipeline  (Partner read-only) ────────────────
exports.partnerGetPipeline = async (req, res) => {
  try {
    const StaffingPartner = require('../models/StaffingPartner');
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(403).json({ success: false, message: 'Staffing partner profile not found' });
    }

    const candidate = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    })
      .populate('pipelineTemplate')
      .populate('job')
      .populate('auditTrail.actorId', 'email role');

    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate/submission not found' });

    let populatedRounds = await populateRoundsWithJobSlots(candidate);
    let pipelineTemplate = candidate.pipelineTemplate;

    if ((!pipelineTemplate || pipelineTemplate.length === 0) && candidate.job && candidate.job.pipelineTemplate && candidate.job.pipelineTemplate.length > 0) {
      pipelineTemplate = candidate.job.pipelineTemplate;
      populatedRounds = candidate.job.pipelineTemplate.map((r, idx) => ({
        roundType: r.roundType,
        order: r.order || idx + 1,
        status: 'NOT_STARTED',
        slots: []
      }));
    }

    let currentStatus = candidate.status;
    if (currentStatus === 'ROUND_ON_HOLD') {
      currentStatus = 'INTERVIEW_CONDUCTED';
    } else if (currentStatus === 'HR_ON_HOLD') {
      currentStatus = 'HR_ROUND_PENDING';
    }

    const mappedRounds = populatedRounds.map(r => {
      let rStatus = r.status;
      if (rStatus === 'ROUND_ON_HOLD') {
        rStatus = 'INTERVIEW_CONDUCTED';
      } else if (rStatus === 'HR_ON_HOLD') {
        rStatus = 'HR_ROUND_PENDING';
      }
      return { ...r, status: rStatus };
    });

    res.json({
      success: true,
      data: {
        candidateId: candidate._id,
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        currentStatus,
        pipelineTemplate: pipelineTemplate,
        rounds: mappedRounds,
        hrRound: candidate.hrRound,
        auditTrail: [],
        job: candidate.job,
        offer: candidate.offer,
      }
    });
  } catch (err) {
    console.error('[PIPELINE][PARTNER] partnerGetPipeline error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch pipeline' });
  }
};

// Helper to identify the current active round info based on candidate status
function getActiveRoundInfo(candidate) {
  const status = candidate.status;

  if (status === PIPELINE_STATES.SHORTLISTED || status === PIPELINE_STATES.REJECTED) {
    return null;
  }

  // HR states
  const hrStates = [
    PIPELINE_STATES.HR_ROUND_PENDING,
    PIPELINE_STATES.HR_SELECTED,
    PIPELINE_STATES.HR_REJECTED,
    PIPELINE_STATES.HR_ON_HOLD
  ];
  if (hrStates.includes(status)) {
    const idx = candidate.rounds.findIndex(r => {
      const rt = (r.roundType || '').trim().toUpperCase();
      const hrNames = ['HR', 'HR ROUND', 'HR_ROUND', 'HUMAN RESOURCE', 'HUMAN RESOURCE ROUND'];
      return hrNames.includes(rt);
    });
    if (idx !== -1) return { index: idx, round: candidate.rounds[idx] };
  }

  // Assessment states
  const assessmentStates = [
    PIPELINE_STATES.ASSESSMENT_PENDING,
    PIPELINE_STATES.ASSESSMENT_PASSED,
    PIPELINE_STATES.ASSESSMENT_FAILED
  ];
  if (assessmentStates.includes(status)) {
    const idx = candidate.rounds.findIndex(r => {
      const rt = (r.roundType || '').toUpperCase();
      return rt === 'ASSESSMENT' || rt.startsWith('ASSESSMENT');
    });
    if (idx !== -1) return { index: idx, round: candidate.rounds[idx] };
  }

  // Offer / Onboarding states (top level, no active round in rounds array)
  const offerStates = [
    PIPELINE_STATES.OFFER_SENT,
    PIPELINE_STATES.OFFER_ACCEPTED,
    PIPELINE_STATES.OFFER_REJECTED,
    PIPELINE_STATES.ONBOARDING
  ];
  if (offerStates.includes(status)) {
    return null;
  }

  // L-round states
  for (let i = 0; i < candidate.rounds.length; i++) {
    const r = candidate.rounds[i];
    const L_STATES = [
      PIPELINE_STATES.SLOTS_NOT_PUBLISHED,
      PIPELINE_STATES.SLOTS_PUBLISHED,
      PIPELINE_STATES.SLOT_ASSIGNED,
      PIPELINE_STATES.RESCHEDULE_REQUESTED,
      PIPELINE_STATES.SLOT_DETAILS_SHARED,
      PIPELINE_STATES.INTERVIEW_CONDUCTED,
      PIPELINE_STATES.ROUND_ON_HOLD
    ];
    if (L_STATES.includes(r.status)) {
      return { index: i, round: r };
    }
  }

  return null;
}

// ─── POST /api/companies/candidates/:id/pipeline/assessment/pass ────────────────
exports.pipelineAssessmentPass = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.ASSESSMENT_PASS, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.status = fsm.nextState;
      activeInfo.round.outcome = {
        decision: 'SELECTED_NEXT_ROUND',
        decidedBy: req.user._id,
        decidedAt: new Date()
      };
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: 'Assessment Passed' });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.ASSESSMENT_PASS,
      fromState,
      toState: fsm.nextState,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    // Automatically transition to next round if available
    if (activeInfo) {
      const nextRound = candidate.rounds.find(r => r.order === activeInfo.round.order + 1);
      if (nextRound) {
        nextRound.status = getInitialRoundState(nextRound.roundType);
        candidate.status = nextRound.status;
        candidate.statusHistory.push({
          status: candidate.status,
          changedBy: req.user._id,
          changedAt: new Date(),
          notes: `Auto-advancing to next round: ${nextRound.roundType}`
        });
      } else {
        // No next round; move to HR_SELECTED (ready for offer)
        candidate.status = PIPELINE_STATES.HR_SELECTED;
      }
    }

    await candidate.save();
    res.json({ success: true, message: 'Assessment passed', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] assessment pass error:', err);
    res.status(500).json({ success: false, message: 'Failed to pass assessment' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/assessment/fail ────────────────
exports.pipelineAssessmentFail = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.ASSESSMENT_FAIL, role, payload: { reason } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.status = fsm.nextState;
      activeInfo.round.outcome = {
        decision: 'REJECTED',
        reason,
        decidedBy: req.user._id,
        decidedAt: new Date()
      };
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: reason });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.ASSESSMENT_FAIL,
      fromState,
      toState: fsm.nextState,
      reason,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    await candidate.save();
    res.json({ success: true, message: 'Assessment failed', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] assessment fail error:', err);
    res.status(500).json({ success: false, message: 'Failed to fail assessment' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/publish-slots ──────────────────
exports.pipelinePublishSlots = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { slots } = req.body; // Array of slots: { date, startTime, endTime, interviewMode, notes, interviewerName, timezone }
    const { candidate, company } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.PUBLISH_SLOTS, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active round found for candidate' });
    }

    // Create slot documents in InterviewSlot collection scoped to this round and candidate
    const createdSlots = [];
    for (const s of slots) {
      const slotDoc = await InterviewSlot.create({
        job: candidate.job,
        company: company._id,
        date: new Date(s.date),
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone || 'Asia/Kolkata',
        interviewMode: (s.interviewMode && (s.interviewMode.toUpperCase() === 'FACE_TO_FACE' || s.interviewMode.toUpperCase() === 'FACE-TO-FACE' || s.interviewMode === 'Face-to-Face')) ? 'Face-to-Face' : 'Virtual',
        notes: s.notes || null,
        maxCandidates: 1,
        availableSpots: 1,
        status: 'ACTIVE',
        roundType: activeInfo.round.roundType,
        candidateId: candidate._id,
        createdBy: req.user._id,
      });
      createdSlots.push(slotDoc);
    }

    // Sync candidate round slots representation
    activeInfo.round.slots = createdSlots.map(s => ({
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      timezone: s.timezone,
      mode: s.interviewMode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL',
      interviewerName: s.notes,
      capacity: 1,
      publishedBy: req.user._id,
    }));
    activeInfo.round.status = fsm.nextState;

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: `Published ${slots.length} slots for round ${activeInfo.round.roundType}`
    });

    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.PUBLISH_SLOTS,
      fromState,
      toState: fsm.nextState,
      roundIndex: activeInfo.index
    });

    await candidate.save();
    res.json({ success: true, message: 'Slots published successfully', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] publish slots error:', err);
    res.status(500).json({ success: false, message: 'Failed to publish slots' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/share-details ──────────────────
exports.pipelineShareDetails = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { meetingLink, address, pocName, pocPhone, pocEmail, pointOfContact } = req.body;
    const finalPocName = pocName || pointOfContact?.name || '';
    const finalPocPhone = pocPhone || pointOfContact?.phone || '';
    const finalPocEmail = pocEmail || pointOfContact?.email || '';

    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.SHARE_DETAILS, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active round found for candidate' });
    }

    if (!activeInfo.round.slots || activeInfo.round.slots.length === 0) {
      return res.status(400).json({ success: false, message: 'No booked slot found for candidate round' });
    }

    // Update details on the active round slot representation
    activeInfo.round.slots[0].details = {
      meetingLink: meetingLink || '',
      address: address || '',
      pointOfContact: {
        name: finalPocName,
        phone: finalPocPhone,
        email: finalPocEmail
      }
    };
    activeInfo.round.status = fsm.nextState;

    // Synchronize with candidate.interviewConfig for compatibility across dashboards
    const activeSlot = activeInfo.round.slots[0];
    const modeStr = (activeSlot.mode || activeSlot.interviewMode || '').toUpperCase();
    const isFaceToFace = modeStr === 'FACE_TO_FACE' || modeStr === 'FACE-TO-FACE';
    candidate.interviewConfig = {
      mode: isFaceToFace ? 'Face-to-Face' : 'Virtual',
      details: isFaceToFace ? (address || '') : (meetingLink || ''),
      interviewer: finalPocName,
      isConfirmedByCompany: true,
      confirmedAt: new Date(),
      candidateResponse: "PENDING"
    };

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: 'Interview details shared with candidate/partner'
    });

    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.SHARE_DETAILS,
      fromState,
      toState: fsm.nextState,
      roundIndex: activeInfo.index
    });

    await candidate.save();

    // Trigger WhatsApp notification to candidate asynchronously
    const notifyCandidate = async () => {
      try {
        const Company = require('../models/Company');
        const companyDoc = await Company.findById(candidate.company);
        const companyName = companyDoc ? companyDoc.companyName : 'Syncro1 Employer';

        const slot = activeInfo.round.slots[0];
        const interviewDate = new Date(slot.date).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

        const mode = slot.mode === "VIRTUAL" ? "Online" : "Offline";
        const detailsStr = slot.mode === "VIRTUAL"
          ? `Meeting Link: ${meetingLink || ''}`
          : `Address: ${address || ''}`;

        const interviewer = pocName || 'Hiring Team';

        // 1. WhatsApp notification
        try {
          const whatsappService = require('../services/whatsappService');
          const token = candidate.interviewConfig?.confirmationToken || candidate._id.toString();
          await whatsappService.sendInterviewInvitation(
            candidate.mobile,
            candidate.firstName,
            companyName,
            interviewDate,
            slot.startTime,
            candidate.job?.title || 'Job Interview',
            mode,
            detailsStr,
            interviewer,
            token
          );
        } catch (waError) {
          console.error('[PIPELINE] WhatsApp notification failed:', waError.message);
        }



      } catch (err) {
        console.error('[PIPELINE] Notification wrapper error:', err.message);
      }
    };

    notifyCandidate();

    await sendPipelineEmail('company', candidate._id, `📅 Interview Slot Assigned - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Interview Slot Assigned</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>The candidate <strong>${candidate.firstName} ${candidate.lastName}</strong> has been assigned to an interview slot for the <strong>${candidate.job?.title}</strong> role.</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Details shared successfully', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] share details error:', err);
    res.status(500).json({ success: false, message: 'Failed to share details' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/reschedule ─────────────────────
exports.pipelineRequestReschedule = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason, suggestedSlots } = req.body;

    let candidateObj;
    if (role === ROLES.COMPANY) {
      const result = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
      candidateObj = result.candidate;
    } else {
      candidateObj = await Candidate.findById(req.params.id);
    }

    if (!candidateObj) {
      return res.status(404).json({ success: false, message: 'Candidate not found' });
    }

    const fromState = candidateObj.status;
    const activeInfo = getActiveRoundInfo(candidateObj);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active round found for candidate' });
    }

    const candidateRescheduleCount = activeInfo.round.rescheduleCount?.candidateInitiated || 0;
    const fsm = transition({
      currentState: fromState,
      action: ACTIONS.REQUEST_RESCHEDULE,
      role,
      payload: { reason },
      context: { candidateRescheduleCount }
    });

    if (!fsm.ok) return handleFsmError(fsm, res);

    if (role === ROLES.CANDIDATE) {
      activeInfo.round.rescheduleCount.candidateInitiated += 1;
    } else if (role === ROLES.COMPANY) {
      activeInfo.round.rescheduleCount.clientInitiated += 1;
    }

    const activeSlotId = candidateObj.assignedSlot;
    if (activeSlotId) {
      const slot = await InterviewSlot.findById(activeSlotId);
      if (slot) {
        slot.bookedCandidates = slot.bookedCandidates.filter(
          b => b.candidate.toString() !== candidateObj._id.toString()
        );
        slot.availableSpots += 1;
        if (slot.status === 'FULL') {
          slot.status = 'ACTIVE';
        }
        await slot.save();
      }
    }

    candidateObj.assignedSlot = null;
    activeInfo.round.slots = [];

    // Save reschedule request info
    activeInfo.round.rescheduleRequest = {
      status: 'PENDING',
      requestedBy: role === ROLES.COMPANY ? 'COMPANY' : 'CANDIDATE',
      reason,
      requestedAt: new Date(),
      suggestedSlots: (suggestedSlots || []).map(s => ({
        slotId: s.slotId,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone || 'Asia/Kolkata',
        mode: s.mode || 'VIRTUAL',
        interviewerName: s.interviewerName || ''
      }))
    };

    activeInfo.round.status = fsm.nextState;
    candidateObj.status = fsm.nextState;
    candidateObj.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: `Reschedule requested. Reason: ${reason}`
    });

    writeAudit(candidateObj, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.REQUEST_RESCHEDULE,
      fromState,
      toState: fsm.nextState,
      reason,
      roundIndex: activeInfo.index
    });

    await candidateObj.save();
    await sendPipelineEmail('partner', candidateObj._id, `🔄 Reschedule Requested - ${candidateObj.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Reschedule Requested</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>The company has requested a reschedule for the interview with <strong>${candidateObj.firstName} ${candidateObj.lastName}</strong> for the <strong>${candidateObj.job?.title}</strong> role.</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Reschedule request processed', data: { candidateId: candidateObj._id, status: candidateObj.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] reschedule error:', err);
    res.status(500).json({ success: false, message: 'Failed to request reschedule' });
  }
};

// ─── POST /api/staffing-partners/submissions/:id/pipeline/reschedule ─────────────
exports.partnerRequestReschedule = async (req, res) => {
  try {
    const { reason, suggestedSlots } = req.body;

    if (!suggestedSlots || !Array.isArray(suggestedSlots) || suggestedSlots.length === 0 || suggestedSlots.length > 2) {
      return res.status(400).json({ success: false, message: 'Please select up to 2 slots for rescheduling.' });
    }

    const StaffingPartner = require('../models/StaffingPartner');
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(403).json({ success: false, message: 'Staffing partner profile not found' });
    }

    const candidateObj = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    });

    if (!candidateObj) {
      return res.status(404).json({ success: false, message: 'Candidate/submission not found' });
    }

    const fromState = candidateObj.status;
    const activeInfo = getActiveRoundInfo(candidateObj);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active round found for candidate' });
    }

    const partnerRescheduleCount = activeInfo.round.rescheduleCount?.partnerInitiated || 0;
    const fsm = transition({
      currentState: fromState,
      action: ACTIONS.REQUEST_RESCHEDULE,
      role: ROLES.STAFFING_PARTNER,
      payload: { reason },
      context: { partnerRescheduleCount }
    });

    if (!fsm.ok) return handleFsmError(fsm, res);

    activeInfo.round.rescheduleCount.partnerInitiated = (activeInfo.round.rescheduleCount.partnerInitiated || 0) + 1;

    const activeSlotId = candidateObj.assignedSlot;
    if (activeSlotId) {
      const slot = await InterviewSlot.findById(activeSlotId);
      if (slot) {
        slot.bookedCandidates = slot.bookedCandidates.filter(
          b => b.candidate.toString() !== candidateObj._id.toString()
        );
        slot.availableSpots += 1;
        if (slot.status === 'FULL') {
          slot.status = 'ACTIVE';
        }
        await slot.save();
      }
    }

    candidateObj.assignedSlot = null;
    activeInfo.round.slots = [];

    // Save reschedule request info
    activeInfo.round.rescheduleRequest = {
      status: 'PENDING',
      requestedBy: 'PARTNER',
      reason,
      requestedAt: new Date(),
      suggestedSlots: suggestedSlots.map(s => ({
        slotId: s.slotId,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone || 'Asia/Kolkata',
        mode: s.mode || 'VIRTUAL',
        interviewerName: s.interviewerName || ''
      }))
    };

    activeInfo.round.status = fsm.nextState;
    candidateObj.status = fsm.nextState;
    candidateObj.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: `Reschedule requested by Talent Partner. Reason: ${reason}`
    });

    writeAudit(candidateObj, {
      actorId: req.user._id,
      actorRole: ROLES.STAFFING_PARTNER,
      action: ACTIONS.REQUEST_RESCHEDULE,
      fromState,
      toState: fsm.nextState,
      reason,
      roundIndex: activeInfo.index
    });

    await candidateObj.save();
    await sendPipelineEmail('company', candidateObj._id, `🔄 Reschedule Requested - ${candidateObj.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Reschedule Requested</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>The talent partner has requested a reschedule for the interview with <strong>${candidateObj.firstName} ${candidateObj.lastName}</strong> for the <strong>${candidateObj.job?.title}</strong> role.</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Reschedule request processed', data: { candidateId: candidateObj._id, status: candidateObj.status } });
  } catch (err) {
    console.error('[PIPELINE] partner reschedule error:', err);
    res.status(500).json({ success: false, message: 'Failed to request reschedule' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/reschedule/confirm ──────────────────
exports.pipelineConfirmReschedule = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { selectedSlotId, meetingLink, address, pocName, pocPhone, pocEmail, pointOfContact } = req.body;
    const finalPocName = pocName || pointOfContact?.name || '';
    const finalPocPhone = pocPhone || pointOfContact?.phone || '';
    const finalPocEmail = pocEmail || pointOfContact?.email || '';

    const { candidate, company } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({
      currentState: fromState,
      action: ACTIONS.CONFIRM_RESCHEDULE,
      role
    });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active round found for candidate' });
    }

    const reqInfo = activeInfo.round.rescheduleRequest;
    if (!reqInfo || reqInfo.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'No pending reschedule request found' });
    }

    // Find the chosen slot from suggested slots
    const chosenSlot = reqInfo.suggestedSlots.find(s => s.slotId.toString() === selectedSlotId.toString() || s._id.toString() === selectedSlotId.toString());
    if (!chosenSlot) {
      return res.status(400).json({ success: false, message: 'Invalid slot selection. Must choose one of the suggested slots.' });
    }

    // Book the slot in the InterviewSlot collection
    const slotDoc = await InterviewSlot.findById(chosenSlot.slotId);
    if (!slotDoc) {
      return res.status(404).json({ success: false, message: 'Selected interview slot not found in database' });
    }

    if (slotDoc.availableSpots <= 0) {
      return res.status(400).json({ success: false, message: 'Selected slot is no longer available. Please reject reschedule and request new slots.' });
    }

    // Book the candidate
    slotDoc.bookedCandidates.push({
      candidate: candidate._id,
      partner: candidate.submittedBy,
      bookedAt: new Date(),
      bookingStatus: 'BOOKED'
    });
    slotDoc.availableSpots -= 1;
    if (slotDoc.availableSpots === 0) {
      slotDoc.status = 'FULL';
    }
    await slotDoc.save();

    const existingPocPhone = activeInfo.round.slots?.[0]?.details?.pointOfContact?.phone || '';
    const existingPocEmail = activeInfo.round.slots?.[0]?.details?.pointOfContact?.email || '';

    // Update candidate slot and details representation
    candidate.assignedSlot = slotDoc._id;
    activeInfo.round.slots = [{
      date: slotDoc.date,
      startTime: slotDoc.startTime,
      endTime: slotDoc.endTime,
      timezone: slotDoc.timezone || 'Asia/Kolkata',
      mode: slotDoc.interviewMode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL',
      interviewerName: slotDoc.interviewerName || '',
      capacity: 1,
      bookedBy: candidate.submittedBy,
      bookedAt: new Date(),
      details: {
        meetingLink: slotDoc.interviewMode === 'Virtual' ? (slotDoc.interviewDetails || '') : '',
        address: slotDoc.interviewMode === 'Face-to-Face' ? (slotDoc.interviewDetails || '') : '',
        pointOfContact: {
          name: slotDoc.interviewerName || finalPocName || '',
          phone: finalPocPhone || existingPocPhone || '',
          email: finalPocEmail || existingPocEmail || ''
        }
      }
    }];

    // Record in interviews array for history
    candidate.interviews.push({
      round: candidate.interviews.length + 1,
      slot: slotDoc._id,
      scheduledAt: slotDoc.date,
      type: slotDoc.interviewMode === 'Face-to-Face' ? 'Face-to-Face' : 'Video',
      result: 'PENDING'
    });

    // Update reschedule request status
    reqInfo.status = 'ACCEPTED';
    reqInfo.selectedSlotId = slotDoc._id;
    reqInfo.actionedAt = new Date();
    reqInfo.actionedBy = req.user._id;

    const crypto = require('crypto');
    const confirmationToken = crypto.randomBytes(32).toString('hex');

    // Synchronize with candidate.interviewConfig for compatibility across dashboards
    candidate.interviewConfig = {
      mode: slotDoc.interviewMode === 'Face-to-Face' ? 'Face-to-Face' : 'Virtual',
      details: slotDoc.interviewDetails || '',
      interviewer: slotDoc.interviewerName || '',
      isConfirmedByCompany: true,
      confirmedAt: new Date(),
      candidateResponse: "PENDING",
      confirmationToken: confirmationToken
    };

    activeInfo.round.status = fsm.nextState;
    candidate.status = fsm.nextState;

    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: `Reschedule confirmed by client. Slot chosen: ${new Date(slotDoc.date).toDateString()} ${slotDoc.startTime}`
    });

    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.CONFIRM_RESCHEDULE,
      fromState,
      toState: fsm.nextState,
      roundIndex: activeInfo.index
    });

    await candidate.save();

    // Trigger WhatsApp notification to candidate asynchronously
    const notifyCandidate = async () => {
      try {
        const companyName = company ? company.companyName : 'Syncro1 Employer';
        const slot = activeInfo.round.slots[0];
        const interviewDate = new Date(slot.date).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

        const mode = slot.mode === "VIRTUAL" ? "Online" : "Offline";
        const detailsStr = slotDoc.interviewDetails || '';
        const interviewer = slotDoc.interviewerName || 'Hiring Team';

        // 1. WhatsApp notification
        try {
          const whatsappService = require('../services/whatsappService');
          const token = confirmationToken;
          await whatsappService.sendInterviewInvitation(
            candidate.mobile,
            candidate.firstName,
            companyName,
            interviewDate,
            slot.startTime,
            candidate.job?.title || 'Job Interview',
            mode,
            detailsStr,
            interviewer,
            token
          );
        } catch (waError) {
          console.error('[PIPELINE] WhatsApp notification failed:', waError.message);
        }


      } catch (err) {
        console.error('[PIPELINE] Reschedule notification failed:', err.message);
      }
    };
    notifyCandidate();

    await sendPipelineEmail('partner', candidate._id, `✅ Reschedule Confirmed - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Reschedule Confirmed</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>The rescheduled interview slot for <strong>${candidate.firstName} ${candidate.lastName}</strong> has been confirmed by the company for the <strong>${candidate.job?.title}</strong> role.</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Reschedule confirmed successfully', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] confirm reschedule error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm reschedule' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/reschedule/reject ──────────────────
exports.pipelineRejectReschedule = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;

    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({
      currentState: fromState,
      action: ACTIONS.REJECT_RESCHEDULE,
      role
    });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active round found for candidate' });
    }

    const reqInfo = activeInfo.round.rescheduleRequest;
    if (!reqInfo || reqInfo.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: 'No pending reschedule request found' });
    }

    // Update reschedule request status
    reqInfo.status = 'REJECTED';
    reqInfo.actionedAt = new Date();
    reqInfo.actionedBy = req.user._id;
    reqInfo.rejectionReason = reason || 'Declined by employer';

    activeInfo.round.status = fsm.nextState;
    candidate.status = fsm.nextState;

    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: `Reschedule request rejected by client. Reason: ${reason || 'Declined by employer'}`
    });

    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.REJECT_RESCHEDULE,
      fromState,
      toState: fsm.nextState,
      reason,
      roundIndex: activeInfo.index
    });

    await candidate.save();
    res.json({ success: true, message: 'Reschedule request rejected. Reverted state to SLOTS_PUBLISHED.', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] reject reschedule error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject reschedule' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/mark-conducted ─────────────────
exports.pipelineMarkConducted = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.MARK_CONDUCTED, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.status = fsm.nextState;
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: 'Interview Conducted' });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.MARK_CONDUCTED,
      fromState,
      toState: fsm.nextState,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    await candidate.save();
    res.json({ success: true, message: 'Interview marked conducted', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] mark conducted error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark interview conducted' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/select-next-round ──────────────
exports.pipelineSelectNextRound = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.SELECT_NEXT_ROUND, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.status = fsm.nextState;
      activeInfo.round.outcome = {
        decision: 'SELECTED_NEXT_ROUND',
        decidedBy: req.user._id,
        decidedAt: new Date()
      };
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: 'Moved to Next Round' });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.SELECT_NEXT_ROUND,
      fromState,
      toState: fsm.nextState,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    if (activeInfo) {
      const nextRound = candidate.rounds.find(r => r.order === activeInfo.round.order + 1);
      if (nextRound) {
        nextRound.status = getInitialRoundState(nextRound.roundType);
        candidate.status = nextRound.status;
        candidate.assignedSlot = null;
        candidate.interviewConfig = null;
        candidate.statusHistory.push({
          status: candidate.status,
          changedBy: req.user._id,
          changedAt: new Date(),
          notes: `Started round ${nextRound.order}: ${nextRound.roundType}`
        });
      } else {
        candidate.status = PIPELINE_STATES.HR_SELECTED;
        candidate.assignedSlot = null;
        candidate.interviewConfig = null;
      }
    }

    await candidate.save();
    await sendPipelineEmail('partner', candidate._id, `🎉 Candidate Advanced - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Great news! Your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been selected for the next round of interviews for the <strong>${candidate.job?.title}</strong> role.</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Candidate selected for next round', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] select next round error:', err);
    res.status(500).json({ success: false, message: 'Failed to select next round' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/reject-round ───────────────────
exports.pipelineRejectRound = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.REJECT_ROUND, role, payload: { reason } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.status = fsm.nextState;
      activeInfo.round.outcome = {
        decision: 'REJECTED',
        reason,
        decidedBy: req.user._id,
        decidedAt: new Date()
      };
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: `Rejected: ${reason}` });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.REJECT_ROUND,
      fromState,
      toState: fsm.nextState,
      reason,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    await candidate.save();
    await sendPipelineEmail('partner', candidate._id, `❌ Candidate Status Update - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Unfortunately, your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been rejected at this interview round for the <strong>${candidate.job?.title}</strong> role.</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Candidate rejected at this round', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] reject round error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject round' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/select-direct-hr ───────────────
exports.pipelineSelectDirectHR = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.SELECT_DIRECT_HR, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    // ── Find the current active round ─────────────────────────────────────
    const activeInfo = getActiveRoundInfo(candidate);

    // ── Find existing HR round from the pipeline template (never auto-create) ─
    let hrRoundIndex = candidate.rounds.findIndex(r => {
      const rt = (r.roundType || '').trim().toUpperCase();
      const hrNames = ['HR', 'HR ROUND', 'HR_ROUND', 'HUMAN RESOURCE', 'HUMAN RESOURCE ROUND'];
      return hrNames.includes(rt);
    });

    let hrRound;

    if (hrRoundIndex === -1) {
      // Auto-create HR round if it doesn't exist (fallback for legacy candidates)
      const hrOrder = candidate.rounds.length > 0 ? Math.max(...candidate.rounds.map(r => r.order || 0)) + 1 : 1;
      
      hrRound = {
        roundType: 'HR_ROUND',
        order: hrOrder,
        status: getInitialRoundState('HR_ROUND'),
        slots: [],
        rescheduleCount: { candidateInitiated: 0, clientInitiated: 0, partnerInitiated: 0 }
      };
      candidate.rounds.push(hrRound);
      
      if (!candidate.pipelineTemplate) candidate.pipelineTemplate = [];
      candidate.pipelineTemplate.push({
        roundType: 'HR_ROUND',
        order: hrOrder
      });
      
      hrRoundIndex = candidate.rounds.length - 1;
    } else {
      hrRound = candidate.rounds[hrRoundIndex];
    }

    // ── Mark the current active round as skipped ──────────────────────────
    if (activeInfo) {
      activeInfo.round.status = PIPELINE_STATES.ROUND_SELECTED_DIRECT_HR;
      activeInfo.round.outcome = {
        decision: 'SELECTED_DIRECT_HR',
        decidedBy: req.user._id,
        decidedAt: new Date()
      };
    }

    // ── Mark ALL intermediate rounds between current and HR as skipped ────
    // Any round that is between the active round's order and the HR round's order
    // and still in an initial/unstarted state should be marked as skipped.
    const currentOrder = activeInfo ? (activeInfo.round.order || activeInfo.index + 1) : 0;
    const hrOrder = hrRound.order || hrRoundIndex + 1;

    const INACTIVE_ROUND_STATES = [
      PIPELINE_STATES.SLOTS_NOT_PUBLISHED,
      PIPELINE_STATES.ASSESSMENT_PENDING,
    ];

    candidate.rounds.forEach((r, idx) => {
      const rOrder = r.order || idx + 1;
      // Skip rounds that are between current and HR round (exclusive)
      if (rOrder > currentOrder && rOrder < hrOrder && INACTIVE_ROUND_STATES.includes(r.status)) {
        r.status = PIPELINE_STATES.ROUND_SELECTED_DIRECT_HR;
        r.outcome = {
          decision: 'SKIPPED_TO_HR',
          decidedBy: req.user._id,
          decidedAt: new Date()
        };
      }
    });

    // ── Activate the HR round ─────────────────────────────────────────────
    hrRound.status = getInitialRoundState(hrRound.roundType);
    candidate.status = hrRound.status;
    candidate.assignedSlot = null;
    candidate.interviewConfig = null;

    candidate.statusHistory.push({ status: candidate.status, changedBy: req.user._id, changedAt: new Date(), notes: 'Skipped directly to HR Round' });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.SELECT_DIRECT_HR,
      fromState,
      toState: candidate.status,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    await candidate.save();
    await sendPipelineEmail('partner', candidate._id, `🎉 Candidate Advanced - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Great news! Your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been advanced to the HR round for the <strong>${candidate.job?.title}</strong> role.</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'Candidate skipped to HR round', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] select direct hr error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to skip to HR round' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/hold-round ─────────────────────
exports.pipelineHoldRound = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.HOLD_ROUND, role, payload: { reason } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.status = fsm.nextState;
      activeInfo.round.outcome = {
        decision: 'ON_HOLD',
        reason,
        decidedBy: req.user._id,
        decidedAt: new Date()
      };
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: `On Hold: ${reason}` });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.HOLD_ROUND,
      fromState,
      toState: fsm.nextState,
      reason,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    await candidate.save();
    res.json({ success: true, message: 'Candidate placed on hold', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] hold round error:', err);
    res.status(500).json({ success: false, message: 'Failed to place round on hold' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/resolve-hold ───────────────────
exports.pipelineResolveHold = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { resolution } = req.body;
    if (resolution !== 'NEXT_ROUND' && resolution !== 'REJECT') {
      return res.status(400).json({ success: false, message: 'Invalid hold resolution. Only NEXT_ROUND and REJECT are allowed.' });
    }
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.RESOLVE_HOLD, role, payload: { resolution } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      activeInfo.round.holdResolution = {
        resolvedTo: resolution,
        resolvedBy: req.user._id,
        resolvedAt: new Date()
      };
      activeInfo.round.status = fsm.nextState;
    }

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: `Resolved hold to ${resolution}` });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.RESOLVE_HOLD,
      fromState,
      toState: fsm.nextState,
      reason: `Hold resolved to: ${resolution}`,
      roundIndex: activeInfo ? activeInfo.index : null
    });

    if (activeInfo) {
      if (resolution === 'NEXT_ROUND') {
        const nextRound = candidate.rounds.find(r => r.order === activeInfo.round.order + 1);
        if (nextRound) {
          nextRound.status = getInitialRoundState(nextRound.roundType);
          candidate.status = nextRound.status;
          candidate.assignedSlot = null;
          candidate.interviewConfig = null;
        } else {
          candidate.status = PIPELINE_STATES.HR_SELECTED;
          candidate.assignedSlot = null;
          candidate.interviewConfig = null;
        }
      } else if (resolution === 'SELECTED_DIRECT_HR') {
        const hrRound = candidate.rounds.find(r => {
          const rt = (r.roundType || '').trim().toUpperCase();
          const hrNames = ['HR', 'HR ROUND', 'HR_ROUND', 'HUMAN RESOURCE', 'HUMAN RESOURCE ROUND'];
          return hrNames.includes(rt);
        });
        if (hrRound) {
          hrRound.status = getInitialRoundState(hrRound.roundType);
          candidate.status = getInitialRoundState(hrRound.roundType);
          candidate.assignedSlot = null;
          candidate.interviewConfig = null;
        } else {
          candidate.status = PIPELINE_STATES.HR_SELECTED;
          candidate.assignedSlot = null;
          candidate.interviewConfig = null;
        }
      }
    }

    await candidate.save();
    res.json({ success: true, message: 'Hold resolved successfully', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] resolve hold error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve hold' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/hr/select ──────────────────────
exports.pipelineHRSelect = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.HR_SELECT, role });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.hrRound = candidate.hrRound || {};
    candidate.hrRound.status = fsm.nextState;
    candidate.hrRound.decidedBy = req.user._id;
    candidate.hrRound.decidedAt = new Date();

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: 'HR round selected' });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.HR_SELECT,
      fromState,
      toState: fsm.nextState
    });

    await candidate.save();
    await sendPipelineEmail('partner', candidate._id, `🎉 Candidate Passed HR Round - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Great news! Your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has passed the HR round for the <strong>${candidate.job?.title}</strong> role.</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'HR round passed', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] HR select error:', err);
    res.status(500).json({ success: false, message: 'Failed to pass HR round' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/hr/reject ──────────────────────
exports.pipelineHRReject = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.HR_REJECT, role, payload: { reason } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.hrRound = candidate.hrRound || {};
    candidate.hrRound.status = fsm.nextState;
    candidate.hrRound.reason = reason;
    candidate.hrRound.decidedBy = req.user._id;
    candidate.hrRound.decidedAt = new Date();

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: `HR round rejected: ${reason}` });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.HR_REJECT,
      fromState,
      toState: fsm.nextState,
      reason
    });

    await candidate.save();
    await sendPipelineEmail('partner', candidate._id, `❌ Candidate Status Update - ${candidate.job?.title}`, 
      `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <div style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p>Hello Team,</p>
          <p>Unfortunately, your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been rejected at the HR round for the <strong>${candidate.job?.title}</strong> role.</p>
          <p><strong>Reason:</strong> ${reason}</p>
        </div>
      </div>`
    );

    res.json({ success: true, message: 'HR round rejected', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] HR reject error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject HR round' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/hr/hold ────────────────────────
exports.pipelineHRHold = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { reason } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.HR_HOLD, role, payload: { reason } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.hrRound = candidate.hrRound || {};
    candidate.hrRound.status = fsm.nextState;
    candidate.hrRound.reason = reason;
    candidate.hrRound.decidedBy = req.user._id;
    candidate.hrRound.decidedAt = new Date();

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: `HR round placed on hold: ${reason}` });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.HR_HOLD,
      fromState,
      toState: fsm.nextState,
      reason
    });

    await candidate.save();
    res.json({ success: true, message: 'HR round placed on hold', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] HR hold error:', err);
    res.status(500).json({ success: false, message: 'Failed to place HR round on hold' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/hr/resolve-hold ────────────────
exports.pipelineHRResolveHold = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { resolution } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.HR_RESOLVE_HOLD, role, payload: { resolution } });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.hrRound = candidate.hrRound || {};
    candidate.hrRound.holdResolution = {
      resolvedTo: resolution,
      resolvedBy: req.user._id,
      resolvedAt: new Date()
    };
    candidate.hrRound.status = fsm.nextState;

    candidate.status = fsm.nextState;
    candidate.statusHistory.push({ status: fsm.nextState, changedBy: req.user._id, changedAt: new Date(), notes: `HR hold resolved to ${resolution}` });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.HR_RESOLVE_HOLD,
      fromState,
      toState: fsm.nextState,
      reason: `HR hold resolved to: ${resolution}`
    });

    await candidate.save();
    res.json({ success: true, message: 'HR hold resolved', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] HR resolve hold error:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve HR hold' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// PHASE 4 — Offer Management & Onboarding
// ══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/companies/candidates/:id/pipeline/offer/start ─────────────────
exports.pipelineStartOfferNegotiation = async (req, res) => {
  try {
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);

    if (candidate.status !== 'HR_SELECTED') {
      return res.status(400).json({ success: false, message: 'Candidate must be in HR_SELECTED state.' });
    }

    if (!candidate.offer) candidate.offer = {};
    candidate.offer.negotiationStartedAt = new Date();

    await candidate.save();

    res.json({ success: true, data: { candidate } });
  } catch (error) {
    console.error('[PIPELINE] start offer negotiation error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/offer/send ─────────────────
// Company sends offer letter to HR-Selected candidate.
// Body: { salary, offerLetterUrl, notes }
exports.pipelineSendOffer = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { 
      salary, 
      inhandCtc,
      variableCtc,
      expectedJoiningDate,
      joiningDate,
      workMode,
      workLocation,
      notes 
    } = req.body;
    
    const offerLetterUrl = req.file ? req.file.path : req.body.offerLetterUrl;

    if (!salary || isNaN(Number(salary)) || Number(salary) <= 0) {
      return res.status(400).json({ success: false, message: 'A valid annual CTC (salary) is required to log an offer.' });
    }

    if (!offerLetterUrl) {
      return res.status(400).json({ success: false, message: 'Either an Offer Letter URL or a file upload is required.' });
    }

    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.SEND_OFFER, role, payload: {} });
    if (!fsm.ok) return handleFsmError(fsm, res);

    const crypto = require('crypto');
    const offerToken = crypto.randomBytes(32).toString('hex');
    const offerExpiresAt = new Date();
    offerExpiresAt.setDate(offerExpiresAt.getDate() + 7); // Valid for 7 days

    const isOfferSentBool = req.body.isOfferSent === 'true' || req.body.isOfferSent === true;

    // Populate offer sub-document
    candidate.offer = {
      ...(candidate.offer || {}),
      salary: Number(salary),
      inhandCtc: inhandCtc && inhandCtc !== 'undefined' ? Number(inhandCtc) : undefined,
      variableCtc: variableCtc && variableCtc !== 'undefined' ? Number(variableCtc) : undefined,
      expectedJoiningDate: expectedJoiningDate && expectedJoiningDate !== 'undefined' ? new Date(expectedJoiningDate) : undefined,
      joiningDate: joiningDate && joiningDate !== 'undefined' ? new Date(joiningDate) : undefined,
      workMode: workMode && workMode !== 'undefined' ? workMode : undefined,
      workLocation: workLocation && workLocation !== 'undefined' ? workLocation : undefined,
      offerLetterUrl: offerLetterUrl || '',
      offeredAt: new Date(),
      response: 'PENDING',
      offerToken,
      offerWhatsappSentAt: isOfferSentBool ? new Date() : undefined,
      isOfferSent: isOfferSentBool,
      offerSentAt: isOfferSentBool ? new Date() : undefined,
      offerExpiresAt
    };

    if (isOfferSentBool) {
      candidate.status = fsm.nextState;
      candidate.statusHistory.push({
        status: fsm.nextState,
        changedBy: req.user._id,
        changedAt: new Date(),
        notes: notes || `Offer sent. CTC: ₹${Number(salary).toLocaleString('en-IN')}`
      });
      writeAudit(candidate, {
        actorId: req.user._id,
        actorRole: role,
        action: ACTIONS.SEND_OFFER,
        fromState,
        toState: fsm.nextState,
        reason: notes || `Offer sent. CTC: ₹${Number(salary).toLocaleString('en-IN')}`
      });
    } else {
      // Just save the offer, don't transition state
      writeAudit(candidate, {
        actorId: req.user._id,
        actorRole: role,
        action: ACTIONS.SEND_OFFER,
        fromState,
        toState: fromState,
        reason: notes || `Offer drafted and saved. CTC: ₹${Number(salary).toLocaleString('en-IN')}`
      });
    }

    await candidate.save();

    if (isOfferSentBool) {
      // Trigger WhatsApp notification to candidate (fire-and-forget)
      const sendWhatsAppOffer = async () => {
        try {
          const whatsappService = require('../services/whatsappService');
          await candidate.populate('job company');
        const companyName = candidate.company?.companyName || 'the Employer';

        await whatsappService.sendCandidateOffer(
          candidate.mobile,
          candidate.firstName,
          candidate.job?.title || 'Job Role',
          companyName,
          `₹${Number(salary).toLocaleString('en-IN')}`,
          offerToken
        );
      } catch (err) {
        console.error('[WHATSAPP] Offer notification failed:', err.message);
      }
    };
    sendWhatsAppOffer();

    // Notify staffing partner (fire-and-forget)
    const notifyPartner = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        const StaffingPartner = require('../models/StaffingPartner');
        const partner = await StaffingPartner.findById(candidate.submittedBy).select('user');
        if (partner?.user) {
          await notificationEngine.send({
            recipientId: partner.user,
            type: 'OFFER_SENT',
            title: '🎉 Offer Letter Sent!',
            message: `An offer has been sent to ${candidate.firstName} ${candidate.lastName} with CTC ₹${Number(salary).toLocaleString('en-IN')}/year. Awaiting candidate response.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
      } catch (e) {
        console.error('[PIPELINE] Offer notify partner error:', e.message);
      }
    };
    notifyPartner();
    } // End if (isOfferSentBool)

    res.json({ 
      success: true, 
      message: isOfferSentBool ? 'Offer sent successfully.' : 'Offer details saved successfully.', 
      data: { candidateId: candidate._id, status: candidate.status, offer: candidate.offer } 
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] send offer error:', err);
    res.status(500).json({ success: false, message: 'Failed to send offer' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/offer/mark-sent ─────────────
exports.pipelineMarkOfferSent = async (req, res) => {
  try {
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);

    // If candidate status is HR_SELECTED, transition it to OFFER_SENT
    if (candidate.status === 'HR_SELECTED') {
       candidate.status = 'OFFER_SENT';
       candidate.statusHistory.push({
         status: 'OFFER_SENT',
         changedBy: req.user._id,
         changedAt: new Date(),
         notes: 'Offer marked as sent.'
       });
       writeAudit(candidate, {
         actorId: req.user._id,
         actorRole: roleFromReq(req),
         action: ACTIONS.SEND_OFFER,
         fromState: 'HR_SELECTED',
         toState: 'OFFER_SENT',
         reason: 'Offer marked as sent.'
       });
    }

    if (!candidate.offer) {
       candidate.offer = {};
    }

    candidate.offer.isOfferSent = true;
    candidate.offer.offerSentAt = new Date();
    await candidate.save();

    // Trigger WhatsApp notification to candidate (fire-and-forget)
    const sendWhatsAppOffer = async () => {
      try {
        const whatsappService = require('../services/whatsappService');
        await candidate.populate('job company');
        const companyName = candidate.company?.companyName || 'the Employer';
        if (candidate.offer.salary && candidate.offer.offerToken) {
          await whatsappService.sendCandidateOffer(
            candidate.mobile,
            candidate.firstName,
            candidate.job?.title || 'Job Role',
            companyName,
            `₹${Number(candidate.offer.salary).toLocaleString('en-IN')}`,
            candidate.offer.offerToken
          );
        }
      } catch (err) {
        console.error('[WHATSAPP] Offer notification failed:', err.message);
      }
    };
    sendWhatsAppOffer();

    // Notify staffing partner (fire-and-forget)
    const notifyPartner = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        const StaffingPartner = require('../models/StaffingPartner');
        const partner = await StaffingPartner.findById(candidate.submittedBy).select('user');
        if (partner?.user) {
          await notificationEngine.send({
            recipientId: partner.user,
            type: 'OFFER_SENT',
            title: '🎉 Offer Letter Sent!',
            message: `An offer has been sent to ${candidate.firstName} ${candidate.lastName}. Awaiting candidate response.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
      } catch (e) {
        console.error('[PIPELINE] Offer notify partner error:', e.message);
      }
    };
    notifyPartner();

    res.json({ success: true, data: { candidateId: candidate._id, status: candidate.status, offer: candidate.offer } });
  } catch (error) {
    console.error('[PIPELINE] mark offer sent error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

// ─── GET /api/candidates/offer/review/:token (candidate-initiated, public) ───
// Fetch candidate, job, company, and offer details for review.
exports.pipelineGetOfferDetails = async (req, res) => {
  try {
    const { token } = req.params;

    const candidate = await Candidate.findOne({ 'offer.offerToken': token })
      .populate('job')
      .populate('company', 'companyName logo user')
      .populate({
        path: 'submittedBy',
        select: 'firmName firstName lastName user',
        populate: {
          path: 'user',
          select: 'email'
        }
      });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired offer link.'
      });
    }

    // Check expiry
    if (candidate.offer.offerExpiresAt && new Date() > candidate.offer.offerExpiresAt) {
      return res.status(400).json({
        success: false,
        message: 'This offer link has expired. Please contact your hiring company or recruiter.',
        data: { status: 'EXPIRED' }
      });
    }

    res.json({
      success: true,
      data: {
        candidate: {
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          email: candidate.email,
          mobile: candidate.mobile,
          profile: candidate.profile,
          resume: candidate.resume,
          status: candidate.status
        },
        job: candidate.job,
        company: {
          companyName: candidate.company?.companyName,
          logo: candidate.company?.logo
        },
        offer: {
          salary: candidate.offer.salary,
          offerLetterUrl: candidate.offer.offerLetterUrl,
          offeredAt: candidate.offer.offeredAt,
          joiningDate: candidate.offer.joiningDate,
          response: candidate.offer.response,
          expiresAt: candidate.offer.offerExpiresAt
        },
        partner: {
          firmName: candidate.submittedBy?.firmName,
          firstName: candidate.submittedBy?.firstName,
          lastName: candidate.submittedBy?.lastName,
          email: candidate.submittedBy?.user?.email,
          partnerName: `${candidate.submittedBy?.firstName} ${candidate.submittedBy?.lastName}`
        }
      }
    });

  } catch (err) {
    console.error('[PIPELINE] Get offer details error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch offer details.' });
  }
};

// ─── POST /api/candidates/offer/accept/:token  (candidate-initiated, public) ─
// Candidate accepts offer and provides joining date.
// Body: { joiningDate }
exports.pipelineCandidateAcceptOffer = async (req, res) => {
  try {
    const { token } = req.params;
    const { joiningDate } = req.body;

    const candidate = await Candidate.findOne({ 'offer.offerToken': token })
      .populate('job', 'title')
      .populate('company', 'companyName user')
      .populate('submittedBy', 'firmName user');

    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Invalid or expired offer link.' });
    }

    if (candidate.status !== PIPELINE_STATES.OFFER_SENT) {
      return res.json({
        success: true,
        message: `Offer already responded to (Status: ${candidate.status}).`,
        data: { status: candidate.status }
      });
    }

    const fsm = transition({
      currentState: candidate.status,
      action: ACTIONS.ACCEPT_OFFER,
      role: ROLES.CANDIDATE,
      payload: { joiningDate }
    });
    if (!fsm.ok) return res.status(400).json({ success: false, message: fsm.error });

    candidate.offer.joiningDate = new Date(joiningDate);
    candidate.offer.response = 'ACCEPTED';
    candidate.offer.respondedAt = new Date();
    candidate.status = fsm.nextState;
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedAt: new Date(),
      notes: `Candidate accepted offer. Joining date: ${new Date(joiningDate).toDateString()}`
    });
    writeAudit(candidate, {
      actorRole: ROLES.CANDIDATE,
      action: ACTIONS.ACCEPT_OFFER,
      fromState: PIPELINE_STATES.OFFER_SENT,
      toState: fsm.nextState,
      reason: `Joining date: ${new Date(joiningDate).toDateString()}`
    });

    await candidate.save();

    // Notify company and partner
    const notifyStakeholders = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        if (candidate.company?.user) {
          await notificationEngine.send({
            recipientId: candidate.company.user,
            type: 'OFFER_ACCEPTED',
            title: '✅ Offer Accepted!',
            message: `${candidate.firstName} ${candidate.lastName} has accepted the offer for "${candidate.job?.title}". Joining on ${new Date(joiningDate).toDateString()}.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'urgent'
          });
        }
        if (candidate.submittedBy?.user) {
          await notificationEngine.send({
            recipientId: candidate.submittedBy.user,
            type: 'OFFER_ACCEPTED',
            title: '✅ Candidate Accepted Offer!',
            message: `${candidate.firstName} ${candidate.lastName} accepted the offer at ${candidate.company?.companyName}. Joining: ${new Date(joiningDate).toDateString()}.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'urgent'
          });
        }
      } catch (e) { console.error('[PIPELINE] Offer accept notify error:', e.message); }
    };
    notifyStakeholders();

    res.json({
      success: true,
      message: `🎉 Congratulations! You have accepted the offer. Your joining date is confirmed as ${new Date(joiningDate).toDateString()}.`,
      data: { status: candidate.status, joiningDate: candidate.offer.joiningDate }
    });
  } catch (err) {
    console.error('[PIPELINE] candidate accept offer error:', err);
    res.status(500).json({ success: false, message: 'Failed to accept offer.' });
  }
};

// ─── POST /api/candidates/offer/reject/:token  (candidate-initiated, public) ─
// Candidate rejects offer.
// Body: { reason }
exports.pipelineCandidateRejectOffer = async (req, res) => {
  try {
    const { token } = req.params;
    const { reason } = req.body;

    const candidate = await Candidate.findOne({ 'offer.offerToken': token })
      .populate('job', 'title')
      .populate('company', 'companyName user')
      .populate('submittedBy', 'firmName user');

    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Invalid or expired offer link.' });
    }

    if (candidate.status !== PIPELINE_STATES.OFFER_SENT) {
      return res.json({
        success: true,
        message: `Offer already responded to (Status: ${candidate.status}).`,
        data: { status: candidate.status }
      });
    }

    const fsm = transition({
      currentState: candidate.status,
      action: ACTIONS.REJECT_OFFER,
      role: ROLES.CANDIDATE,
      payload: { reason: reason || 'No reason provided' }
    });
    if (!fsm.ok) return res.status(400).json({ success: false, message: fsm.error });

    candidate.offer.response = 'DECLINED';
    candidate.offer.respondedAt = new Date();
    candidate.offer.negotiationNotes = reason || '';
    candidate.status = fsm.nextState;
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedAt: new Date(),
      notes: `Candidate rejected offer. Reason: ${reason || 'Not specified'}`
    });
    writeAudit(candidate, {
      actorRole: ROLES.CANDIDATE,
      action: ACTIONS.REJECT_OFFER,
      fromState: PIPELINE_STATES.OFFER_SENT,
      toState: fsm.nextState,
      reason: reason || 'Not specified'
    });

    await candidate.save();

    // Notify company and partner
    const notifyStakeholders = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        if (candidate.company?.user) {
          await notificationEngine.send({
            recipientId: candidate.company.user,
            type: 'OFFER_REJECTED',
            title: '❌ Offer Declined',
            message: `${candidate.firstName} ${candidate.lastName} has declined the offer for "${candidate.job?.title}". ${reason ? `Reason: ${reason}` : ''}`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
        if (candidate.submittedBy?.user) {
          await notificationEngine.send({
            recipientId: candidate.submittedBy.user,
            type: 'OFFER_REJECTED',
            title: '❌ Candidate Declined Offer',
            message: `${candidate.firstName} ${candidate.lastName} declined the offer at ${candidate.company?.companyName}.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
      } catch (e) { console.error('[PIPELINE] Offer reject notify error:', e.message); }
    };
    notifyStakeholders();

    res.json({
      success: true,
      message: 'Your response has been recorded. Thank you for letting us know.',
      data: { status: candidate.status }
    });
  } catch (err) {
    console.error('[PIPELINE] candidate reject offer error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject offer.' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/onboarding/confirm ──────────
// Company confirms OFFER_ACCEPTED → ONBOARDING (candidate starts onboarding).
exports.pipelineConfirmOnboarding = async (req, res) => {
  try {
    const role = roleFromReq(req);
    const { notes } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    // FSM: OFFER_ACCEPTED + SELECT_NEXT_ROUND (reused as "confirm onboarding") → ONBOARDING
    const fsm = transition({ currentState: fromState, action: ACTIONS.SELECT_NEXT_ROUND, role, payload: {} });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.status = fsm.nextState; // ONBOARDING
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: notes || 'Onboarding initiated'
    });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: 'CONFIRM_ONBOARDING',
      fromState,
      toState: fsm.nextState,
      reason: notes || 'Onboarding initiated'
    });

    await candidate.save();

    // Notify partner
    const notifyPartner = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        const StaffingPartner = require('../models/StaffingPartner');
        const partner = await StaffingPartner.findById(candidate.submittedBy).select('user');
        if (partner?.user) {
          await notificationEngine.send({
            recipientId: partner.user,
            type: 'ONBOARDING_STARTED',
            title: '🚀 Onboarding Started!',
            message: `${candidate.firstName} ${candidate.lastName} has moved to the Onboarding phase. Please coordinate document verification.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
      } catch (e) { console.error('[PIPELINE] Onboarding notify error:', e.message); }
    };
    notifyPartner();

    res.json({ success: true, message: 'Onboarding confirmed.', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] confirm onboarding error:', err);
    res.status(500).json({ success: false, message: 'Failed to confirm onboarding' });
  }
};

// ─── POST /api/companies/candidates/:id/pipeline/mark-joined ─────────────────
// Company marks candidate as Joined (ONBOARDING → JOINED).
// Triggers commission processing via candidateLifecycleService.
exports.pipelineMarkJoined = async (req, res) => {
  try {
    const { actualJoiningDate, notes } = req.body;

    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);

    if (candidate.status !== PIPELINE_STATES.ONBOARDING && candidate.status !== PIPELINE_STATES.OFFER_ACCEPTED) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark as Joined from status "${candidate.status}". Candidate must be in OFFER_ACCEPTED or ONBOARDING status.`
      });
    }

    const joiningDate = actualJoiningDate ? new Date(actualJoiningDate) : new Date();

    candidate.joining = {
      actualJoiningDate: joiningDate,
      confirmed: true,
      confirmedAt: new Date(),
      documentsSubmitted: true
    };
    candidate.status = 'JOINED';
    candidate.statusHistory.push({
      status: 'JOINED',
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: notes || `Candidate joined on ${joiningDate.toDateString()}`
    });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: 'company',
      action: 'MARK_JOINED',
      fromState: PIPELINE_STATES.ONBOARDING,
      toState: 'JOINED',
      reason: notes || `Joined on ${joiningDate.toDateString()}`
    });

    await candidate.save();

    // Trigger commission processing via lifecycle service (fire-and-forget)
    const processJoining = async () => {
      try {
        const candidateLifecycleService = require('../services/candidateLifecycleService');
        await candidateLifecycleService._handleJoining(candidate);
      } catch (e) {
        console.error('[PIPELINE] Commission processing error:', e.message);
      }
    };
    processJoining();

    await auditService.log({
      actor: req.user._id,
      actorRole: 'company',
      action: 'PIPELINE_MARK_JOINED',
      entityType: 'Candidate',
      entityId: candidate._id,
      description: `Candidate marked as Joined on ${joiningDate.toDateString()}`,
      ipAddress: req.ip
    });

    res.json({ success: true, message: 'Candidate marked as Joined. Commission processing initiated.', data: { candidateId: candidate._id, status: 'JOINED', joiningDate } });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] mark joined error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark candidate as joined' });
  }
};

// ─── POST /api/companies/pipeline/:id/offer/accept (Company-initiated) ─────
exports.pipelineCompanyAcceptOffer = async (req, res) => {
  try {
    const role = 'company';
    const { joiningDate, notes, respondedAt } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.ACCEPT_OFFER, role, payload: {} });
    if (!fsm.ok) return handleFsmError(fsm, res);

    if (joiningDate) candidate.offer.joiningDate = new Date(joiningDate);
    candidate.offer.response = 'ACCEPTED';
    candidate.offer.respondedAt = respondedAt ? new Date(respondedAt) : new Date();
    candidate.status = fsm.nextState;
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: notes || `Company marked offer as ACCEPTED.`
    });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.ACCEPT_OFFER,
      fromState,
      toState: fsm.nextState,
      reason: notes || `Company marked offer as ACCEPTED.`
    });

    await candidate.save();
    res.json({ success: true, message: 'Offer marked as accepted successfully.', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    console.error('[PIPELINE] Company accept offer error:', err);
    res.status(500).json({ success: false, message: 'Failed to accept offer.' });
  }
};

// ─── POST /api/companies/pipeline/:id/offer/reject (Company-initiated) ─────
exports.pipelineCompanyRejectOffer = async (req, res) => {
  try {
    const role = 'company';
    const { reason, respondedAt } = req.body;
    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.REJECT_OFFER, role, payload: {} });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.offer.response = 'DECLINED';
    candidate.offer.respondedAt = respondedAt ? new Date(respondedAt) : new Date();
    candidate.status = fsm.nextState;
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: reason || `Company marked offer as REJECTED.`
    });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.REJECT_OFFER,
      fromState,
      toState: fsm.nextState,
      reason: reason || `Company marked offer as REJECTED.`
    });

    await candidate.save();
    res.json({ success: true, message: 'Offer marked as rejected successfully.', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    console.error('[PIPELINE] Company reject offer error:', err);
    res.status(500).json({ success: false, message: 'Failed to reject offer.' });
  }
};

// ─── POST /api/companies/pipeline/:id/mark-not-joined (Company-initiated) ──
exports.pipelineCompanyMarkNotJoined = async (req, res) => {
  try {
    const role = 'company';
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required for marking as not joined.' });

    const { candidate } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
    const fromState = candidate.status;

    const fsm = transition({ currentState: fromState, action: ACTIONS.MARK_NOT_JOINED, role, payload: {} });
    if (!fsm.ok) return handleFsmError(fsm, res);

    candidate.status = fsm.nextState;
    candidate.joining = {
      ...(candidate.joining || {}),
      confirmed: false
    };
    candidate.statusHistory.push({
      status: fsm.nextState,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: reason
    });
    writeAudit(candidate, {
      actorId: req.user._id,
      actorRole: role,
      action: ACTIONS.MARK_NOT_JOINED,
      fromState,
      toState: fsm.nextState,
      reason: reason
    });

    await candidate.save();
    res.json({ success: true, message: 'Candidate marked as not joined.', data: { candidateId: candidate._id, status: candidate.status } });
  } catch (err) {
    console.error('[PIPELINE] Company mark not joined error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark as not joined.' });
  }
};

// ─── GET /api/admin/pipeline/audit-log ───────────────────────────────────────
// Admin: fetch pipeline audit trail across all candidates with filtering & pagination.
exports.adminGetPipelineAuditLog = async (req, res) => {
  try {
    const { page = 1, limit = 30, search = '', action = '', status = '', jobId = '' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build match for candidates that have an auditTrail
    const candidateMatch = { 'auditTrail.0': { $exists: true } };
    if (jobId) candidateMatch.job = require('mongoose').Types.ObjectId.createFromHexString(jobId);
    if (status) candidateMatch.status = status;

    const candidates = await Candidate.find(candidateMatch)
      .select('firstName lastName status auditTrail job company submittedBy')
      .populate('job', 'title')
      .populate('company', 'companyName')
      .populate('submittedBy', 'firmName firstName lastName')
      .sort({ updatedAt: -1 });

    // Flatten all audit entries across candidates
    let allEntries = [];
    for (const c of candidates) {
      for (const entry of c.auditTrail || []) {
        if (action && entry.action !== action) continue;
        if (search) {
          const name = `${c.firstName} ${c.lastName}`.toLowerCase();
          if (!name.includes(search.toLowerCase())) continue;
        }
        allEntries.push({
          candidateId: c._id,
          candidateName: `${c.firstName} ${c.lastName}`,
          candidateStatus: c.status,
          jobTitle: c.job?.title || 'N/A',
          companyName: c.company?.companyName || 'N/A',
          partnerName: c.submittedBy?.firmName || `${c.submittedBy?.firstName || ''} ${c.submittedBy?.lastName || ''}`.trim() || 'N/A',
          ...entry.toObject()
        });
      }
    }

    // Sort by timestamp descending
    allEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = allEntries.length;
    const paginated = allEntries.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: {
        entries: paginated,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          total
        }
      }
    });
  } catch (err) {
    console.error('[PIPELINE] audit log fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch audit log' });
  }
};
