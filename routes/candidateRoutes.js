const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');

// ================================================================
// CANDIDATE CONSENT ROUTES
// Called from WhatsApp template buttons
// Agree:    GET /api/candidates/consent/agree/:token
// Disagree: GET /api/candidates/consent/disagree/:token
// Review:   GET /api/candidates/consent/review/:token
// ================================================================

// @desc    Fetch candidate, job, and partner details for consent review
// @route   GET /api/candidates/consent/review/:token
router.get('/consent/review/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const candidate = await Candidate.findOne({
      'whatsappConsent.token': token
    })
      .populate('job')
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
        message: 'Invalid or expired consent link'
      });
    }

    // Already actioned
    if (candidate.whatsappConsent.status === 'CONFIRMED') {
      return res.json({
        success: true,
        message: 'Consent already confirmed',
        data: { status: 'ALREADY_CONFIRMED' }
      });
    }

    if (candidate.whatsappConsent.status === 'DENIED') {
      return res.json({
        success: true,
        message: 'Consent already denied',
        data: { status: 'ALREADY_DENIED' }
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
          resume: candidate.resume
        },
        job: candidate.job,
        partner: {
          firmName: candidate.submittedBy?.firmName,
          firstName: candidate.submittedBy?.firstName,
          lastName: candidate.submittedBy?.lastName,
          email: candidate.submittedBy?.user?.email,
          partnerName: `${candidate.submittedBy?.firstName} ${candidate.submittedBy?.lastName}`
        },
        expiresAt: candidate.whatsappConsent.expiresAt
      }
    });

  } catch (error) {
    console.error('[CONSENT] Review details error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch details',
      error: error.message
    });
  }
});

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
    const alreadyActionedStatuses = [
      'CONSENT_CONFIRMED',
      'ADMIN_REVIEW',
      'ADMIN_REJECTED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'SHORTLISTED',
      'REJECTED',
      'CONSENT_DENIED',
      'WITHDRAWN'
    ];
    
    if (alreadyActionedStatuses.includes(candidate.status)) {
      const statusMap = {
        'CONSENT_CONFIRMED': 'ALREADY_CONFIRMED',
        'ADMIN_REVIEW': 'ALREADY_CONFIRMED',
        'ADMIN_REJECTED': 'ALREADY_CONFIRMED',
        'SUBMITTED': 'ALREADY_CONFIRMED',
        'UNDER_REVIEW': 'ALREADY_CONFIRMED',
        'SHORTLISTED': 'ALREADY_CONFIRMED',
        'REJECTED': 'ALREADY_CONFIRMED',
        'CONSENT_DENIED': 'ALREADY_DENIED',
        'WITHDRAWN': 'ALREADY_WITHDRAWN'
      };
      
      const currentActionedStatus = statusMap[candidate.status] || 'ALREADY_CONFIRMED';
      const message = currentActionedStatus === 'ALREADY_DENIED'
        ? 'You have already denied consent.'
        : currentActionedStatus === 'ALREADY_WITHDRAWN'
          ? 'This consent request has been withdrawn or expired.'
          : 'You have already confirmed consent. Your profile is being processed.';
          
      return res.json({
        success: true,
        message,
        data: { status: currentActionedStatus }
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

    // Already actioned
    const alreadyActionedStatuses = [
      'CONSENT_CONFIRMED',
      'ADMIN_REVIEW',
      'ADMIN_REJECTED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'SHORTLISTED',
      'REJECTED',
      'CONSENT_DENIED',
      'WITHDRAWN'
    ];
    
    if (alreadyActionedStatuses.includes(candidate.status)) {
      const statusMap = {
        'CONSENT_CONFIRMED': 'ALREADY_CONFIRMED',
        'ADMIN_REVIEW': 'ALREADY_CONFIRMED',
        'ADMIN_REJECTED': 'ALREADY_CONFIRMED',
        'SUBMITTED': 'ALREADY_CONFIRMED',
        'UNDER_REVIEW': 'ALREADY_CONFIRMED',
        'SHORTLISTED': 'ALREADY_CONFIRMED',
        'REJECTED': 'ALREADY_CONFIRMED',
        'CONSENT_DENIED': 'ALREADY_DENIED',
        'WITHDRAWN': 'ALREADY_WITHDRAWN'
      };
      
      const currentActionedStatus = statusMap[candidate.status] || 'ALREADY_CONFIRMED';
      const message = currentActionedStatus === 'ALREADY_DENIED'
        ? 'You have already denied consent.'
        : currentActionedStatus === 'ALREADY_WITHDRAWN'
          ? 'This consent request has been withdrawn or expired.'
          : 'You have already confirmed consent. Your profile is being processed.';
          
      return res.json({
        success: true,
        message,
        data: { status: currentActionedStatus }
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

// ================================================================
// INTERVIEW CONFIRMATION ROUTES
// Called from WhatsApp template buttons
// Agree:    GET /api/candidates/interview/agree/:token
// Disagree: GET /api/candidates/interview/disagree/:token
// ================================================================

// @desc    Candidate clicks "I Agree" to interview on WhatsApp
// @route   GET /api/candidates/interview/agree/:token
router.get("/interview/agree/:token", async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ success: false, message: "Invalid link" });
    }

    const candidate = await Candidate.findOne({
      "interviewConfig.confirmationToken": token,
    })
      .populate("job", "title")
      .populate("company", "companyName user")
      .populate("submittedBy", "firmName user");

    if (!candidate) {
      return res.status(404).json({ success: false, message: "Invalid or expired link" });
    }

    if (candidate.interviewConfig.candidateResponse !== "PENDING") {
      return res.json({
        success: true,
        message: `You have already responded to this invitation (Status: ${candidate.interviewConfig.candidateResponse}).`,
        data: { status: "ALREADY_RESPONDED", currentResponse: candidate.interviewConfig.candidateResponse },
      });
    }

    // Update response
    candidate.interviewConfig.candidateResponse = "ACCEPTED";
    candidate.interviewConfig.respondedAt = new Date();
    candidate.status = "INTERVIEW_CONFIRMED";

    candidate.statusHistory.push({
      status: "INTERVIEW_CONFIRMED",
      changedAt: new Date(),
      notes: "Candidate confirmed interview availability via WhatsApp",
    });

    await candidate.save();

    // Notify Company & Partner
    const notifyStakeholders = async () => {
      try {
        const notificationEngine = require("../services/notificationEngine");
        
        // Notify Company
        if (candidate.company?.user) {
          await notificationEngine.send({
            recipientId: candidate.company.user,
            type: "INTERVIEW_CONFIRMED",
            title: "✅ Interview Confirmed",
            message: `${candidate.firstName} ${candidate.lastName} has confirmed availability for the interview for "${candidate.job?.title}".`,
            data: { candidateId: candidate._id, jobId: candidate.job?._id },
            channels: { inApp: true, email: true },
          });
        }

        // Notify Partner
        if (candidate.submittedBy?.user) {
          await notificationEngine.send({
            recipientId: candidate.submittedBy.user,
            type: "INTERVIEW_CONFIRMED",
            title: "✅ Candidate Confirmed Interview",
            message: `Your candidate ${candidate.firstName} has confirmed the interview with ${candidate.company?.companyName}.`,
            data: { candidateId: candidate._id },
            channels: { inApp: true, email: true },
          });
        }
      } catch (err) {
        console.error("[INTERVIEW] Notification failed:", err.message);
      }
    };

    notifyStakeholders();

    res.json({
      success: true,
      message: "Great! Your availability has been shared with the employer. We wish you all the best for your interview!",
      data: {
        status: "ACCEPTED",
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: candidate.job?.title,
        company: candidate.company?.companyName,
      },
    });
  } catch (error) {
    console.error("[INTERVIEW] Agree error:", error.message);
    res.status(500).json({ success: false, message: "Failed to confirm" });
  }
});

// @desc    Candidate clicks "I Disagree" to interview on WhatsApp
// @route   GET /api/candidates/interview/disagree/:token
router.get("/interview/disagree/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const candidate = await Candidate.findOne({
      "interviewConfig.confirmationToken": token,
    })
      .populate("job", "title")
      .populate("company", "companyName user")
      .populate("submittedBy", "firmName user");

    if (!candidate) {
      return res.status(404).json({ success: false, message: "Invalid or expired link" });
    }

    if (candidate.interviewConfig.candidateResponse !== "PENDING") {
      return res.json({
        success: true,
        message: `You have already responded to this invitation (Status: ${candidate.interviewConfig.candidateResponse}).`,
        data: { status: "ALREADY_RESPONDED", currentResponse: candidate.interviewConfig.candidateResponse },
      });
    }

    // Update response
    candidate.interviewConfig.candidateResponse = "DECLINED";
    candidate.interviewConfig.respondedAt = new Date();
    candidate.status = "ON_HOLD"; // Put on hold if they decline interview

    candidate.statusHistory.push({
      status: "ON_HOLD",
      changedAt: new Date(),
      notes: "Candidate declined interview availability via WhatsApp",
    });

    await candidate.save();

    // Notify Company & Partner
    const notifyStakeholders = async () => {
      try {
        const notificationEngine = require("../services/notificationEngine");
        
        // Notify Company
        if (candidate.company?.user) {
          await notificationEngine.send({
            recipientId: candidate.company.user,
            type: "INTERVIEW_DECLINED",
            title: "❌ Interview Declined",
            message: `${candidate.firstName} ${candidate.lastName} has declined the interview for "${candidate.job?.title}".`,
            data: { candidateId: candidate._id },
            channels: { inApp: true, email: true },
          });
        }
      } catch (err) {
        console.error("[INTERVIEW] Notification failed:", err.message);
      }
    };

    notifyStakeholders();

    res.json({
      success: true,
      message: "Your response has been recorded. The employer has been notified.",
      data: { status: "DECLINED" },
    });
  } catch (error) {
    console.error("[INTERVIEW] Disagree error:", error.message);
    res.status(500).json({ success: false, message: "Failed to record response" });
  }
});

// ================================================================
// CANDIDATE OFFER LIFE-CYCLE ROUTES
// ================================================================
const {
  pipelineGetOfferDetails,
  pipelineCandidateAcceptOffer,
  pipelineCandidateRejectOffer,
} = require('../controllers/pipelineController');

// @desc    Fetch offer review details
// @route   GET /api/candidates/offer/review/:token
router.get('/offer/review/:token', pipelineGetOfferDetails);

// @desc    Candidate accepts offer via token
// @route   POST /api/candidates/offer/accept/:token
router.post('/offer/accept/:token', pipelineCandidateAcceptOffer);

// @desc    Candidate rejects offer via token
// @route   POST /api/candidates/offer/reject/:token
router.post('/offer/reject/:token', pipelineCandidateRejectOffer);

module.exports = router;