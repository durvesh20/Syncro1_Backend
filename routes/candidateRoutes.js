// backend/routes/candidateRoutes.js
const express = require('express');
const router = express.Router();
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const { protect, authorize } = require('../middleware/auth');

// @desc    Get candidate details (for authorized users)
// @route   GET /api/candidates/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
      .populate('submittedBy', 'firstName lastName firmName user')
      .populate('job', 'title commission company')
      .populate('company', 'companyName');

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Check authorization - only admin, the company, or the submitting partner can view
    const isAdmin = req.user.role === 'admin';
    const isCompany =
      req.user.role === 'company' &&
      candidate.company?.user?.toString() === req.user._id.toString();
    const isPartner =
      req.user.role === 'staffing_partner' &&
      candidate.submittedBy?.user?.toString() === req.user._id.toString();

    if (!isAdmin && !isCompany && !isPartner) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this candidate'
      });
    }

    res.json({
      success: true,
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch candidate',
      error: error.message
    });
  }
});

// @desc    Public consent page data
// @route   GET /api/candidates/consent/:token
router.get('/consent/:token', async (req, res) => {
  try {
    // NOTE: In production, this should be a JWT or other secure token,
    // not a raw candidate _id. Adjust lookup logic accordingly.
    const candidate = await Candidate.findById(req.params.token)
      .populate('job', 'title company description location')
      .populate('company', 'companyName');

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or expired consent link'
      });
    }

    if (candidate.consent?.given) {
      return res.json({
        success: true,
        message: 'Consent already provided',
        data: { alreadyConsented: true }
      });
    }

    res.json({
      success: true,
      data: {
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
        jobTitle: candidate.job?.title,
        companyName: candidate.company?.companyName,
        jobLocation: candidate.job?.location
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch consent data',
      error: error.message
    });
  }
});

// @desc    Submit consent (public route using token)
// @route   POST /api/candidates/consent/:token
router.post('/consent/:token', async (req, res) => {
  try {
    const { consent, signature } = req.body;

    // Again, token should ideally be a secure token / JWT
    const candidate = await Candidate.findById(req.params.token);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid consent link'
      });
    }

    candidate.consent = {
      given: consent === true,
      givenAt: new Date(),
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      signature: signature
    };

    await candidate.save();

    res.json({
      success: true,
      message: consent
        ? 'Thank you! Your consent has been recorded.'
        : 'You have declined to provide consent.'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to record consent',
      error: error.message
    });
  }
});

module.exports = router;