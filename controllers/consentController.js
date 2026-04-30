const Candidate = require('../models/Candidate');
const whatsappService = require('../services/whatsappService');

// @desc    Handle Consent Response (from WhatsApp Button URL)
// @route   GET /consent/confirm or GET /consent/deny
exports.handleConsent = async (req, res) => {
  try {
    const { action, token: paramToken } = req.params;
    const { token: queryToken } = req.query;
    
    const token = paramToken || queryToken;
    const path = req.path;
    const derivedAction = action || (path.includes('confirm') || path.includes('agree') ? 'confirm' : 'deny');
    
    console.log('═══════════════════════════════════════');
    console.log('🔐 Consent Request Received');
    console.log(`   Action: ${derivedAction}`);
    console.log(`   Token:  ${token}`);
    console.log('═══════════════════════════════════════');

    if (!token) {
      return res.redirect(`${process.env.FRONTEND_URL}/consent/error?msg=missing_token`);
    }

    const candidate = await Candidate.findOne({ 'consent.consentToken': token });

    if (!candidate) {
      return res.redirect(`${process.env.FRONTEND_URL}/consent/error?msg=invalid_token`);
    }

    // 1. Check Expiry
    if (candidate.consent.consentExpiry && new Date() > candidate.consent.consentExpiry) {
      console.log(`[CONSENT] ❌ Link expired: ${candidate.consent.consentExpiry}`);
      return res.redirect(`${process.env.FRONTEND_URL}/consent/error?msg=link_expired`);
    }

    // 2. Check if already responded
    if (['AGREED', 'DENIED'].includes(candidate.consent.consentStatus)) {
      console.log(`[CONSENT] ⚠️ Already responded: ${candidate.consent.consentStatus}`);
      return res.redirect(
        `${process.env.FRONTEND_URL}/consent/status?token=${token}&msg=already_responded`
      );
    }

    // 3. Determine decision
    const decision = derivedAction === 'confirm' ? 'AGREE' : 'DISAGREE';
    const newConsentStatus = decision === 'AGREE' ? 'AGREED' : 'DENIED';
    const newCandidateStatus = decision === 'AGREE' ? 'SUBMITTED' : 'REJECTED';

    // 4. Update candidate
    candidate.consent.consentStatus = newConsentStatus;
    candidate.consent.given = (decision === 'AGREE');
    candidate.consent.consentConfirmedAt = decision === 'AGREE' ? new Date() : undefined;
    candidate.consent.consentDeniedAt = decision === 'DISAGREE' ? new Date() : undefined;
    candidate.consent.consentIp = req.ip;
    candidate.status = newCandidateStatus;

    candidate.statusHistory.push({
      status: newCandidateStatus,
      changedBy: null, // Indicating candidate action
      notes: `Candidate ${decision.toLowerCase()}d consent via WhatsApp Dynamic Link`,
      timestamp: new Date()
    });

    await candidate.save();

    // 5. Send confirmation (Optional)
    if (decision === 'AGREE') {
      try {
        await whatsappService.sendMessage(
          candidate.mobile,
          `Thank you ${candidate.firstName}! Your consent has been recorded and your profile for the position has been submitted successfully.`
        );
      } catch (waError) {
        console.error('[CONSENT] Confirmation WhatsApp failed:', waError.message);
      }
    }

    return res.redirect(`${process.env.FRONTEND_URL}/consent/status?token=${token}&success=true`);

  } catch (error) {
    console.error('[CONSENT] ❌ Error:', error.message);
    return res.redirect(`${process.env.FRONTEND_URL}/consent/error?msg=server_error`);
  }
};

// @desc    Get Consent Status (The "Verify API" requested)
// @route   GET /api/candidates/consent/status/:token
exports.getConsentStatus = async (req, res) => {
  try {
    const { token } = req.params;

    const candidate = await Candidate.findOne({ 'consent.consentToken': token })
      .populate('job', 'title')
      .populate('submittedBy', 'firmName');

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired verification link'
      });
    }

    const isExpired = candidate.consent.consentExpiry && new Date() > candidate.consent.consentExpiry;

    res.json({
      success: true,
      data: {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: candidate.job?.title || 'Unknown Position',
        firmName: candidate.submittedBy?.firmName || 'Our Partner',
        consentStatus: candidate.consent.consentStatus,
        candidateStatus: candidate.status,
        isExpired,
        respondedAt: candidate.consent.consentConfirmedAt || candidate.consent.consentDeniedAt,
        expiresAt: candidate.consent.consentExpiry
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
