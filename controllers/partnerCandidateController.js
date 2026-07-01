// Partner's personal candidate pool / CRM
// Completely decoupled from job submissions (Candidate model)
// When applied to a job, data is DEEP-COPIED — pool edits never affect submissions.

const PartnerCandidate = require('../models/PartnerCandidate');
const StaffingPartner = require('../models/StaffingPartner');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const jobAccessService = require('../services/jobAccessService');

// ─── helpers ──────────────────────────────────────────────────────────────────

const normalizeMobile = (mobile) =>
  (mobile || '').replace(/\D/g, '').slice(-10);

// ──────────────────────────────────────────────────────────────────────────────
// @desc   List all pool candidates for the logged-in partner
// @route  GET /api/staffing-partners/my-candidates
// ──────────────────────────────────────────────────────────────────────────────
exports.listPoolCandidates = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });

    const { search = '', page = 1, limit = 20, noticePeriod } = req.query;
    const filter = { partner: partner._id };

    if (search.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      filter.$or = [
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { mobile: rx },
        { location: rx },
        { tags: rx },
        { uniqueId: rx }
      ];
    }

    if (noticePeriod) filter.noticePeriod = noticePeriod;

    const skip = (Number(page) - 1) * Number(limit);
    const [candidates, total] = await Promise.all([
      PartnerCandidate.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      PartnerCandidate.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: candidates,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch candidates', error: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// @desc   Create a new pool candidate
// @route  POST /api/staffing-partners/my-candidates
// ──────────────────────────────────────────────────────────────────────────────
exports.createPoolCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });

    const {
      firstName, middleName, lastName,
      email, mobile,
      location, willingToRelocate, totalExperience, relevantExperience,
      noticePeriod, currentSalary, expectedSalary,
      writeup, tags, lastWorkingDay
    } = req.body;

    // ── Required fields ──
    const missing = [];
    if (!firstName?.trim()) missing.push('firstName');
    if (!lastName?.trim()) missing.push('lastName');
    if (!email?.trim()) missing.push('email');
    if (!mobile?.trim()) missing.push('mobile');
    if (!location?.trim()) missing.push('location');
    if (willingToRelocate === undefined || willingToRelocate === '') missing.push('willingToRelocate');
    if (totalExperience === undefined || totalExperience === '') missing.push('totalExperience');
    if (relevantExperience === undefined || relevantExperience === '') missing.push('relevantExperience');
    if (!noticePeriod?.trim()) missing.push('noticePeriod');
    if (currentSalary === undefined || currentSalary === '') missing.push('currentSalary');
    if (expectedSalary === undefined || expectedSalary === '') missing.push('expectedSalary');

    if (missing.length) {
      return res.status(400).json({ success: false, message: 'Missing required fields', missingFields: missing });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = normalizeMobile(mobile);

    // ── Uniqueness per partner ──
    const existing = await PartnerCandidate.findOne({
      partner: partner._id,
      $or: [
        { email: normalizedEmail },
        { mobile: new RegExp(normalizedMobile + '$') }
      ]
    });

    if (existing) {
      const conflict = existing.email === normalizedEmail ? 'email' : 'mobile';
      return res.status(409).json({
        success: false,
        message: `A candidate with this ${conflict} already exists in your pool`,
        existingId: existing._id,
        conflict
      });
    }

    // ── Resume (optional at creation time) ──
    const resumeFile = req.file;
    const resume = resumeFile
      ? { url: resumeFile.path, fileName: resumeFile.originalname, uploadedAt: new Date() }
      : undefined;

    const candidate = await PartnerCandidate.create({
      partner: partner._id,
      firstName: firstName.trim(),
      middleName: middleName?.trim() || '',
      lastName: lastName.trim(),
      email: normalizedEmail,
      mobile: mobile.trim(),
      location: location?.trim(),
      willingToRelocate: willingToRelocate !== '' && willingToRelocate !== undefined ? (willingToRelocate === 'true' || willingToRelocate === true) : undefined,
      totalExperience: totalExperience !== '' && totalExperience !== undefined ? Number(totalExperience) : undefined,
      relevantExperience: relevantExperience !== '' && relevantExperience !== undefined ? Number(relevantExperience) : undefined,
      noticePeriod,
      lastWorkingDay: lastWorkingDay ? new Date(lastWorkingDay) : null,
      currentSalary: currentSalary !== '' && currentSalary !== undefined ? Number(currentSalary) : undefined,
      expectedSalary: expectedSalary !== '' && expectedSalary !== undefined ? Number(expectedSalary) : undefined,
      writeup: writeup?.trim(),
      tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
      ...(resume && { resume })
    });

    res.status(201).json({
      success: true,
      message: 'Candidate added to your pool',
      data: candidate
    });
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      return res.status(409).json({
        success: false,
        message: `A candidate with this ${field} already exists in your pool`
      });
    }
    res.status(500).json({ success: false, message: 'Failed to create candidate', error: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// @desc   Get single pool candidate
// @route  GET /api/staffing-partners/my-candidates/:id
// ──────────────────────────────────────────────────────────────────────────────
exports.getPoolCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });

    const candidate = await PartnerCandidate.findOne({
      _id: req.params.id,
      partner: partner._id
    }).lean();

    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found in your pool' });

    // Fetch this candidate's submissions (jobs applied to)
    const submissions = await Candidate.find({ poolCandidateRef: candidate._id })
      .populate('job', 'title uniqueId status')
      .populate('company', 'companyName logo')
      .select('status createdAt job company')
      .lean();

    res.json({
      success: true,
      data: {
        ...candidate,
        submissions: submissions.map(sub => ({
          submissionId: sub._id,
          status: sub.status,
          appliedAt: sub.createdAt,
          job: sub.job,
          company: sub.company
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch candidate', error: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// @desc   Update pool candidate
// @route  PUT /api/staffing-partners/my-candidates/:id
// NOTE:   Updates ONLY the PartnerCandidate record. Existing Candidate
//         (job submission) records are NEVER touched — they hold snapshots.
// ──────────────────────────────────────────────────────────────────────────────
exports.updatePoolCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });

    const candidate = await PartnerCandidate.findOne({
      _id: req.params.id,
      partner: partner._id
    });

    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found in your pool' });

    const {
      firstName, middleName, lastName,
      email, mobile,
      location, willingToRelocate, totalExperience, relevantExperience,
      noticePeriod, currentSalary, expectedSalary,
      writeup, tags, lastWorkingDay
    } = req.body;

    // ── Check uniqueness if email/mobile is being changed ──
    if (email || mobile) {
      const normalizedEmail = email ? email.toLowerCase().trim() : null;
      const normalizedMobile = mobile ? normalizeMobile(mobile) : null;

      const orConditions = [];
      if (normalizedEmail) orConditions.push({ email: normalizedEmail });
      if (normalizedMobile) orConditions.push({ mobile: new RegExp(normalizedMobile + '$') });

      if (orConditions.length) {
        const conflict = await PartnerCandidate.findOne({
          partner: partner._id,
          _id: { $ne: candidate._id },
          $or: orConditions
        });

        if (conflict) {
          const field = conflict.email === normalizedEmail ? 'email' : 'mobile';
          return res.status(409).json({
            success: false,
            message: `Another candidate with this ${field} already exists in your pool`
          });
        }
      }
    }

    // ── Apply updates (only provided fields) ──
    if (firstName) candidate.firstName = firstName.trim();
    if (middleName !== undefined) candidate.middleName = middleName.trim();
    if (lastName) candidate.lastName = lastName.trim();
    if (email) candidate.email = email.toLowerCase().trim();
    if (mobile) candidate.mobile = mobile.trim();
    if (location !== undefined) candidate.location = location.trim();
    if (willingToRelocate !== undefined && willingToRelocate !== '') candidate.willingToRelocate = (willingToRelocate === 'true' || willingToRelocate === true);
    if (totalExperience !== undefined && totalExperience !== '')
      candidate.totalExperience = Number(totalExperience);
    if (relevantExperience !== undefined && relevantExperience !== '')
      candidate.relevantExperience = Number(relevantExperience);
    if (noticePeriod) candidate.noticePeriod = noticePeriod;
    if (lastWorkingDay !== undefined) {
      candidate.lastWorkingDay = lastWorkingDay ? new Date(lastWorkingDay) : null;
    }
    if (currentSalary !== undefined && currentSalary !== '')
      candidate.currentSalary = Number(currentSalary);
    if (expectedSalary !== undefined && expectedSalary !== '')
      candidate.expectedSalary = Number(expectedSalary);
    if (writeup !== undefined) candidate.writeup = writeup.trim();
    if (tags) candidate.tags = Array.isArray(tags) ? tags : [tags];

    // ── New resume (optional) ──
    if (req.file) {
      candidate.resume = {
        url: req.file.path,
        fileName: req.file.originalname,
        uploadedAt: new Date()
      };
    }

    await candidate.save();

    res.json({
      success: true,
      message: 'Candidate updated in your pool',
      data: candidate
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate email or mobile in your pool'
      });
    }
    res.status(500).json({ success: false, message: 'Failed to update candidate', error: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// @desc   Delete pool candidate
// @route  DELETE /api/staffing-partners/my-candidates/:id
// ──────────────────────────────────────────────────────────────────────────────
exports.deletePoolCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });

    const candidate = await PartnerCandidate.findOne({
      _id: req.params.id,
      partner: partner._id
    });

    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found in your pool' });

    // ── Warn if the candidate has active submissions ──
    const activeSubmissions = await Candidate.countDocuments({
      poolCandidateRef: candidate._id,
      status: { $nin: ['REJECTED', 'WITHDRAWN', 'OFFER_DECLINED'] }
    });

    if (activeSubmissions > 0 && !req.query.force) {
      return res.status(409).json({
        success: false,
        message: `This candidate has ${activeSubmissions} active job submission(s). Delete anyway?`,
        activeSubmissions,
        requiresForce: true
      });
    }

    await candidate.deleteOne();

    res.json({
      success: true,
      message: 'Candidate removed from your pool'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete candidate', error: err.message });
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// @desc   Apply pool candidate to a job (snapshot at submission time)
// @route  POST /api/staffing-partners/jobs/:jobId/candidates/from-pool
// ──────────────────────────────────────────────────────────────────────────────
exports.applyFromPool = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) return res.status(404).json({ success: false, message: 'Partner profile not found' });

    const { poolCandidateId, writeup: submissionWriteup } = req.body;

    if (!poolCandidateId) {
      return res.status(400).json({ success: false, message: 'poolCandidateId is required' });
    }

    // ── 1. Load pool candidate (must belong to this partner) ──
    const poolCandidate = await PartnerCandidate.findOne({
      _id: poolCandidateId,
      partner: partner._id
    });

    if (!poolCandidate) {
      return res.status(404).json({ success: false, message: 'Candidate not found in your pool' });
    }

    // ── 2. Load job ──
    const job = await Job.findById(req.params.jobId).populate('company', 'companyName');
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    if (job.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: 'This job is no longer accepting applications' });
    }

    // Check plan eligibility
    const partnerPlan = partner.subscription?.plan || 'FREE';
    const isEligible = await jobAccessService.isPlanEligibleForJob(partnerPlan, job);
    if (!isEligible) {
      return res.status(403).json({
        success: false,
        message: `This job is not accessible on your ${partnerPlan} plan. Please upgrade your subscription.`,
        requiredPlans: job.eligiblePlans,
        currentPlan: partnerPlan
      });
    }

    // ── 3. Ensure partner has JobInterest — auto-create if missing ──
    const JobInterest = require('../models/JobInterest');
    let interest = await JobInterest.findOne({
      partner: partner._id,
      job: job._id
    });

    if (!interest) {
      // Auto-create interest so pool candidates can be applied to any job seamlessly
      const submissionLimit = (job.vacancies || 1) * 5;
      interest = await JobInterest.create({
        partner: partner._id,
        job: job._id,
        user: req.user._id,
        status: 'ACTIVE',
        submissionCount: 0,
        submissionLimit: submissionLimit
      });
    } else if (interest.status === 'WITHDRAWN') {
      // Re-activate if previously withdrawn
      interest.status = 'ACTIVE';
      await interest.save();
    }

    // ── 4. Submission limit ──
    if (interest.submissionCount >= interest.submissionLimit) {
      return res.status(403).json({
        success: false,
        message: `You have reached your submission limit of ${interest.submissionLimit} for this job`,
        data: {
          submissionCount: interest.submissionCount,
          submissionLimit: interest.submissionLimit
        }
      });
    }

    // ── 5. Duplicate check (same candidate already submitted to THIS specific job) ──
    const normalizedEmail = poolCandidate.email.toLowerCase().trim();
    const normalizedMobile = normalizeMobile(poolCandidate.mobile);

    const existing = await Candidate.findOne({
      job: job._id,   // ✅ Scoped to this job only — same candidate CAN apply to different jobs
      $or: [
        { email: normalizedEmail },
        { mobile: new RegExp(normalizedMobile + '$') }
      ]
    });

    if (existing) {
      const isSelf = existing.submittedBy?.toString() === partner._id.toString();
      return res.status(409).json({
        success: false,
        message: isSelf
          ? 'You have already submitted this candidate for this job'
          : 'This candidate has already been submitted for this job by another partner',
        candidateId: existing._id,
        currentStatus: existing.status
      });
    }

    // ── 6. Check that this job isn't already in the pool's submitted list ──
    if (poolCandidate.submittedToJobs.map(String).includes(String(job._id))) {
      return res.status(409).json({
        success: false,
        message: 'This candidate has already been applied to this job from your pool'
      });
    }

    // ── 7. Verify resume is present ──
    if (!poolCandidate.resume?.url) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a resume for this candidate before applying to a job'
      });
    }

    // ── 8. SNAPSHOT — deep-copy all fields by value into Candidate ──
    //    Future pool edits will NOT affect this record.
    const company = job.company;

    const crypto = require('crypto');
    const consentToken = crypto.randomBytes(32).toString('hex');
    const consentExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const snapshot = await Candidate.create({
      submittedBy: partner._id,
      job: job._id,
      company,

      // Identity — copied by value
      firstName: poolCandidate.firstName,
      middleName: poolCandidate.middleName,
      lastName: poolCandidate.lastName,
      email: poolCandidate.email,
      mobile: poolCandidate.mobile,

      // Resume — URL copied; pool edits later won't change this URL
      resume: {
        url: poolCandidate.resume.url,
        fileName: poolCandidate.resume.fileName,
        uploadedAt: poolCandidate.resume.uploadedAt
      },

      // Professional — copied by value
      profile: {
        location: poolCandidate.location,
        willingToRelocate: poolCandidate.willingToRelocate,
        totalExperience: poolCandidate.totalExperience,
        relevantExperience: poolCandidate.relevantExperience,
        noticePeriod: poolCandidate.noticePeriod,
        currentSalary: poolCandidate.currentSalary,
        expectedSalary: poolCandidate.expectedSalary,
        lastWorkingDay: poolCandidate.lastWorkingDay,
        // Partner may override writeup for this specific job
        writeup: submissionWriteup || poolCandidate.writeup
      },

      // Consent
      consent: {
        given: false,
        consentStatus: 'PENDING_CONFIRMATION'
      },

      whatsappConsent: {
        sentAt: new Date(),
        sentTo: poolCandidate.mobile,
        token: consentToken,
        expiresAt: consentExpiry,
        status: 'PENDING'
      },

      // Submission metadata
      submissionMetadata: {
        submittedFromPlan: partner.subscription?.plan || 'FREE'
      },

      // ✅ Trace back to pool (for display only — never synced)
      poolCandidateRef: poolCandidate._id,

      status: 'CONSENT_PENDING',
      statusHistory: [{
        status: 'CONSENT_PENDING',
        changedBy: req.user._id,
        changedAt: new Date(),
        notes: 'Submitted via candidate pool'
      }]
    });

    // ── 9. Update submission count ──
    interest.submissionCount += 1;
    await interest.save();

    // ── 10. Mark job as submitted in pool record (to block duplicate apply) ──
    poolCandidate.submittedToJobs.push(job._id);
    await poolCandidate.save();

    // ── 11. Update partner metrics ──
    await StaffingPartner.findByIdAndUpdate(partner._id, {
      $inc: { 'metrics.totalSubmissions': 1 }
    });

    // ── 12. Send WhatsApp consent (fire-and-forget) ──
    try {
      const whatsappService = require('../services/whatsappService');
      if (typeof whatsappService.sendCandidateConsent === 'function') {
        whatsappService.sendCandidateConsent(
          snapshot.mobile,
          snapshot.firstName,
          job.title,
          job.company.companyName,
          consentToken
        ).catch(e =>
          console.error('[POOL_APPLY] WhatsApp consent failed:', e.message)
        );
      }
    } catch (e) {
      console.warn('[POOL_APPLY] WhatsApp service unavailable:', e.message);
    }

    res.status(201).json({
      success: true,
      message: `${poolCandidate.firstName} ${poolCandidate.lastName} has been submitted for this job`,
      data: {
        candidateId: snapshot._id,
        status: snapshot.status,
        poolCandidateRef: snapshot.poolCandidateRef
      }
    });
  } catch (err) {
    console.error('[POOL_APPLY] Error:', err);
    res.status(500).json({ success: false, message: 'Failed to apply candidate', error: err.message });
  }
};
