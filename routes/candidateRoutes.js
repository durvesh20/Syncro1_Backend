
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// @desc    Candidate confirms consent via token link
// @route   GET /api/candidates/consent/confirm
router.get('/consent/confirm', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consent link'
      });
    }

    const candidate = await Candidate.findOne({
      'consent.consentToken': token
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired consent link'
      });
    }

    if (candidate.consent.consentStatus !== 'PENDING_CONFIRMATION') {
      return res.json({
        success: true,
        message: 'Consent already recorded',
        data: {
          status: candidate.consent.consentStatus
        }
      });
    }

    candidate.consent.consentStatus = 'CONFIRMED';
    candidate.consent.consentConfirmedAt = new Date();
    candidate.consent.consentIp = req.ip;
    await candidate.save();

    // Notify partner
    const notificationEngine = require('../services/notificationEngine');
    const StaffingPartner = require('../models/StaffingPartner');
    const partner = await StaffingPartner.findById(candidate.submittedBy)
      .populate('user', '_id');

    if (partner?.user?._id) {
      await notificationEngine.send({
        recipientId: partner.user._id,
        type: 'CANDIDATE_CONSENT_CONFIRMED',
        title: '✅ Candidate consent confirmed',
        message: `${candidate.firstName} ${candidate.lastName} has confirmed consent for their profile submission.`,
        data: {
          entityType: 'Candidate',
          entityId: candidate._id,
          actionUrl: `/partner/submissions/${candidate._id}`
        },
        channels: { inApp: true },
        priority: 'low'
      });
    }

    res.json({
      success: true,
      message: 'Thank you! Your consent has been confirmed.',
      data: { status: 'CONFIRMED' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to confirm consent',
      error: error.message
    });
  }
});

// @desc    Candidate denies consent via token link
// @route   GET /api/candidates/consent/deny
router.get('/consent/deny', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consent link'
      });
    }

    const candidate = await Candidate.findOne({
      'consent.consentToken': token
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired consent link'
      });
    }

    if (candidate.consent.consentStatus !== 'PENDING_CONFIRMATION') {
      return res.json({
        success: true,
        message: 'Consent already recorded',
        data: { status: candidate.consent.consentStatus }
      });
    }

    candidate.consent.consentStatus = 'DENIED';
    candidate.consent.consentDeniedAt = new Date();
    candidate.consent.consentIp = req.ip;
    // Flag the submission
    candidate.status = 'WITHDRAWN';
    candidate.statusHistory.push({
      status: 'WITHDRAWN',
      changedAt: new Date(),
      notes: 'Candidate denied consent — auto-withdrawn'
    });
    await candidate.save();

    // Notify partner
    const notificationEngine = require('../services/notificationEngine');
    const StaffingPartner = require('../models/StaffingPartner');
    const partner = await StaffingPartner.findById(candidate.submittedBy)
      .populate('user', '_id');

    if (partner?.user?._id) {
      await notificationEngine.send({
        recipientId: partner.user._id,
        type: 'CANDIDATE_CONSENT_DENIED',
        title: '❌ Candidate denied consent',
        message: `${candidate.firstName} ${candidate.lastName} has denied consent. The submission has been automatically withdrawn.`,
        data: {
          entityType: 'Candidate',
          entityId: candidate._id,
          actionUrl: `/partner/submissions/${candidate._id}`
        },
        channels: { inApp: true, email: true },
        priority: 'high'
      });
    }

    res.json({
      success: true,
      message: 'Your consent denial has been recorded. The submission has been withdrawn.',
      data: { status: 'DENIED' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to record consent denial',
      error: error.message
    });
  }
});
module.exports = router;