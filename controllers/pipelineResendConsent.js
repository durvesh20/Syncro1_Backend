/**
 * pipelineResendConsent.js
 * Controller for resending interview invitation (WhatsApp + Email) to a candidate
 * when the active round status is SLOT_DETAILS_SHARED.
 *
 * Accessible by: Company, Admin/Sub-admin, Staffing Partner (own submission)
 */

const Candidate = require('../models/Candidate');

// Inline the getActiveRoundInfo helper (same logic as pipelineController.js)
function getActiveRoundInfo(candidate) {
  const status = candidate.status;

  if (status === 'SHORTLISTED' || status === 'REJECTED') return null;

  const hrStates = ['HR_ROUND_PENDING', 'HR_SELECTED', 'HR_REJECTED', 'HR_ON_HOLD'];
  if (hrStates.includes(status)) {
    const idx = candidate.rounds.findIndex(r => {
      const rt = (r.roundType || '').trim().toUpperCase();
      return ['HR', 'HR ROUND', 'HR_ROUND', 'HUMAN RESOURCE', 'HUMAN RESOURCE ROUND'].includes(rt);
    });
    if (idx !== -1) return { index: idx, round: candidate.rounds[idx] };
  }

  const assessmentStates = ['ASSESSMENT_PENDING', 'ASSESSMENT_PASSED', 'ASSESSMENT_FAILED'];
  if (assessmentStates.includes(status)) {
    const idx = candidate.rounds.findIndex(r => {
      const rt = (r.roundType || '').toUpperCase();
      return rt === 'ASSESSMENT' || rt.startsWith('ASSESSMENT');
    });
    if (idx !== -1) return { index: idx, round: candidate.rounds[idx] };
  }

  const offerStates = ['OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'ONBOARDING'];
  if (offerStates.includes(status)) return null;

  const L_STATES = [
    'SLOTS_NOT_PUBLISHED', 'SLOTS_PUBLISHED', 'SLOT_ASSIGNED',
    'RESCHEDULE_REQUESTED', 'SLOT_DETAILS_SHARED', 'INTERVIEW_CONDUCTED', 'ROUND_ON_HOLD'
  ];
  for (let i = 0; i < candidate.rounds.length; i++) {
    if (L_STATES.includes(candidate.rounds[i].status)) {
      return { index: i, round: candidate.rounds[i] };
    }
  }

  return null;
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

// @route POST /api/companies/candidates/:id/pipeline/resend-interview-consent
//        POST /api/admin/candidates/:id/pipeline/resend-interview-consent
//        POST /api/staffing-partners/submissions/:id/pipeline/resend-interview-consent
exports.pipelineResendInterviewConsent = async (req, res) => {
  try {
    const role = req.user?.role;
    let candidate;

    if (role === 'staffing_partner' || role === 'staffing') {
      const StaffingPartner = require('../models/StaffingPartner');
      const partner = await StaffingPartner.findOne({ user: req.user._id });
      if (!partner) return res.status(403).json({ success: false, message: 'Partner profile not found' });
      candidate = await Candidate.findOne({ _id: req.params.id, submittedBy: partner._id }).populate('job', 'title company');
      if (!candidate) return res.status(404).json({ success: false, message: 'Submission not found or access denied' });
    } else if (role === 'admin' || role === 'sub_admin') {
      candidate = await Candidate.findById(req.params.id).populate('job', 'title company');
      if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found' });
    } else {
      // Company
      const { candidate: c } = await verifyCompanyCandidateOwnership(req.params.id, req.user._id);
      candidate = c;
      if (!candidate.job || !candidate.job.title) await candidate.populate('job', 'title company');
    }

    // Find the active round with SLOT_DETAILS_SHARED
    const activeInfo = getActiveRoundInfo(candidate);
    if (!activeInfo) {
      return res.status(400).json({ success: false, message: 'No active interview round found for this candidate' });
    }

    const { round } = activeInfo;
    if (round.status !== 'SLOT_DETAILS_SHARED') {
      return res.status(400).json({
        success: false,
        message: `Interview consent can only be resent when the round status is SLOT_DETAILS_SHARED. Current round status: ${round.status}`
      });
    }

    if (!round.slots || round.slots.length === 0) {
      return res.status(400).json({ success: false, message: 'No slot details found for this round' });
    }

    const slot = round.slots[0];
    const details = slot.details || {};

    const Company = require('../models/Company');
    const companyDoc = await Company.findById(candidate.company).select('companyName');
    const companyName = companyDoc?.companyName || 'Syncro1 Employer';

    const interviewDate = new Date(slot.date).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    const isFaceToFace = slot.mode === 'FACE_TO_FACE' || slot.interviewMode === 'Face-to-Face';
    const mode = isFaceToFace ? 'Offline' : 'Online';
    const detailsStr = isFaceToFace
      ? `Address: ${details.address || ''}`
      : `Meeting Link: ${details.meetingLink || ''}`;
    const interviewer = details.pointOfContact?.name || candidate.interviewConfig?.interviewer || 'Hiring Team';
    const token = candidate.interviewConfig?.confirmationToken || candidate._id.toString();

    // --- Resend WhatsApp ---
    let whatsappOk = false;
    try {
      const whatsappService = require('../services/whatsappService');
      const waResult = await whatsappService.sendInterviewInvitation(
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
      whatsappOk = waResult.success;
      console.log(`[PIPELINE] 🔄 Resent interview consent (WhatsApp) → ${candidate.mobile} | ok=${whatsappOk}`);
    } catch (waErr) {
      console.error('[PIPELINE] WhatsApp resend failed:', waErr.message);
    }

    // Audit trail entry (non-state-changing)
    candidate.statusHistory.push({
      status: candidate.status,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: `Interview consent resent by ${role} (WhatsApp: ${whatsappOk ? 'OK' : 'FAIL'})`
    });
    await candidate.save();

    res.json({
      success: true,
      message: `Interview consent resent to ${candidate.firstName} (${candidate.mobile})`,
      data: { whatsappSent: whatsappOk }
    });

  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
    console.error('[PIPELINE] resend interview consent error:', err);
    res.status(500).json({ success: false, message: 'Failed to resend interview consent' });
  }
};
