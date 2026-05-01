const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');

// ================================================================
// CANDIDATE CONSENT ROUTES
// Called from WhatsApp template buttons
// Agree:    GET /api/candidates/consent/agree/:token
// Disagree: GET /api/candidates/consent/disagree/:token
// ================================================================

// @desc    Candidate clicks "I Agree" on WhatsApp
// @route   GET /api/candidates/consent/agree/:token
router.get('/consent/agree/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consent link'
      });
    }

    const candidate = await Candidate.findOne({
      'whatsappConsent.token': token
    })
      .populate('job', 'title')
      .populate('submittedBy', 'firmName')
      .populate('company', 'companyName');

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired consent link'
      });
    }

    // Already actioned
    if (candidate.whatsappConsent.status === 'CONFIRMED') {
      return res.json({
        success: true,
        message: 'You have already confirmed consent. Your profile is being processed.',
        data: { status: 'ALREADY_CONFIRMED' }
      });
    }

    if (candidate.whatsappConsent.status === 'DENIED') {
      return res.json({
        success: true,
        message: 'You have already denied consent.',
        data: { status: 'ALREADY_DENIED' }
      });
    }

    // Check expiry
    if (new Date() > candidate.whatsappConsent.expiresAt) {
      await Candidate.findByIdAndUpdate(candidate._id, {
        'whatsappConsent.status': 'EXPIRED',
        status: 'WITHDRAWN',
        $push: {
          statusHistory: {
            status: 'WITHDRAWN',
            changedAt: new Date(),
            notes: 'Consent link expired — auto withdrawn'
          }
        }
      });

      return res.status(400).json({
        success: false,
        message: 'This consent link has expired. Please contact your recruiter.',
        data: { status: 'EXPIRED' }
      });
    }

    // ✅ Confirm consent
    candidate.whatsappConsent.status = 'CONFIRMED';
    candidate.whatsappConsent.confirmedAt = new Date();
    candidate.consent.given = true;
    candidate.consent.consentStatus = 'CONFIRMED';
    candidate.consent.consentConfirmedAt = new Date();
    candidate.status = 'CONSENT_CONFIRMED';

    candidate.statusHistory.push({
      status: 'CONSENT_CONFIRMED',
      changedAt: new Date(),
      notes: 'Candidate clicked I Agree on WhatsApp'
    });

    await candidate.save();

    console.log(
      `[CONSENT] ✅ AGREED: ${candidate.firstName} ${candidate.lastName}`
    );

    // ✅ Trigger AI parse + score + admin queue (fire and forget)
    const processCandidate = async () => {
      try {
        const candidateQueueService = require('../services/candidateQueueService');
        await candidateQueueService.processAfterConsent(candidate._id);
      } catch (err) {
        console.error('[QUEUE] Processing failed:', err.message);
      }
    };

    processCandidate();

    res.json({
      success: true,
      message: 'Thank you! Your consent has been confirmed. Your profile is now being reviewed and will be shared with the employer shortly.',
      data: {
        status: 'CONFIRMED',
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: candidate.job?.title,
        company: candidate.company?.companyName
      }
    });

  } catch (error) {
    console.error('[CONSENT] Agree error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm consent',
      error: error.message
    });
  }
});


// @desc    Candidate clicks "I Disagree" on WhatsApp
// @route   GET /api/candidates/consent/disagree/:token
router.get('/consent/disagree/:token', async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consent link'
      });
    }

    const candidate = await Candidate.findOne({
      'whatsappConsent.token': token
    })
      .populate('submittedBy', 'firmName')
      .populate('job', 'title');

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired consent link'
      });
    }

    if (candidate.whatsappConsent.status !== 'PENDING') {
      return res.json({
        success: true,
        message: 'Consent already recorded.',
        data: { status: candidate.whatsappConsent.status }
      });
    }

    // ✅ Deny consent
    candidate.whatsappConsent.status = 'DENIED';
    candidate.whatsappConsent.deniedAt = new Date();
    candidate.consent.consentStatus = 'DENIED';
    candidate.consent.consentDeniedAt = new Date();
    candidate.status = 'CONSENT_DENIED';

    candidate.statusHistory.push({
      status: 'CONSENT_DENIED',
      changedAt: new Date(),
      notes: 'Candidate clicked I Disagree on WhatsApp — auto withdrawn'
    });

    await candidate.save();

    console.log(
      `[CONSENT] ❌ DENIED: ${candidate.firstName} ${candidate.lastName}`
    );

    // ✅ Notify partner (fire and forget)
    const notifyPartner = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        const StaffingPartner = require('../models/StaffingPartner');

        const partner = await StaffingPartner
          .findById(candidate.submittedBy._id || candidate.submittedBy)
          .select('user');

        if (partner?.user) {
          await notificationEngine.send({
            recipientId: partner.user,
            type: 'CANDIDATE_CONSENT_DENIED',
            title: '❌ Candidate denied consent',
            message: `${candidate.firstName} ${candidate.lastName} has denied consent for "${candidate.job?.title}". The profile has been withdrawn.`,
            data: {
              entityType: 'Candidate',
              entityId: candidate._id,
              actionUrl: `/partner/submissions/${candidate._id}`
            },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
      } catch (err) {
        console.error('[CONSENT] Partner notify failed:', err.message);
      }
    };

    notifyPartner();

    res.json({
      success: true,
      message: 'Your denial has been recorded. Your profile will not be shared. You will not be contacted for this position.',
      data: { status: 'DENIED' }
    });

  } catch (error) {
    console.error('[CONSENT] Disagree error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to record denial',
      error: error.message
    });
  }
});

module.exports = router;