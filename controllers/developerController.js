// backend/controllers/developerController.js
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const InterviewSlot = require('../models/InterviewSlot');
const Integration = require('../models/Integration');
const ApiClient = require('../models/ApiClient');
const WebhookEndpoint = require('../models/WebhookEndpoint');
const WebhookDelivery = require('../models/WebhookDelivery');
const ApiLog = require('../models/ApiLog');
const integrationService = require('../services/integrationService');
const webhookService = require('../services/webhookService');

/* =========================================================================
   1. JOBS API
========================================================================= */

/**
 * @desc    Create a new job position from ATS
 * @route   POST /api/v1/jobs
 * @scope   jobs:write
 */
exports.createJob = async (req, res) => {
  const companyId = req.developer.company_id;
  const integrationId = req.developer.integration_id;
  const { title, external_job_id } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'Job title is required', field: 'title' },
      request_id: req.requestId
    });
  }

  try {
    // Check external_job_id uniqueness for this company
    if (external_job_id) {
      const existing = await Job.findOne({ company: companyId, external_job_id });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_RESOURCE',
            message: `A job with external_job_id '${external_job_id}' already exists`,
            field: 'external_job_id'
          },
          request_id: req.requestId
        });
      }
    }

    // Get integration to check user_id and settings
    const integration = await Integration.findById(integrationId);
    const postedByUserId = integration?.user_id;

    if (!postedByUserId) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Integration user association missing' },
        request_id: req.requestId
      });
    }

    // Map payload to job schema
    const jobData = integrationService.mapExternalJobToInternal(
      req.body,
      companyId,
      postedByUserId,
      integrationId
    );

    // Auto-publish if configured
    if (integration?.settings?.auto_publish_jobs) {
      jobData.status = 'ACTIVE';
      jobData.approvalStatus = 'APPROVED';
      jobData.approvedAt = new Date();
    } else {
      jobData.status = 'PENDING_APPROVAL';
      jobData.approvalStatus = 'PENDING_APPROVAL';
    }

    const job = await Job.create(jobData);

    // Update integration last_sync_at
    await Integration.findByIdAndUpdate(integrationId, { last_sync_at: new Date() });

    // Emit webhook
    webhookService.emitEvent(companyId, 'job.created', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      title: job.title,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    if (job.status === 'ACTIVE') {
      webhookService.emitEvent(companyId, 'job.published', {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        title: job.title,
        status: job.status
      }, { entity_type: 'JOB', entity_id: job._id });
    }

    return res.status(201).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API createJob Error]:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    List all jobs for employer
 * @route   GET /api/v1/jobs
 * @scope   jobs:read
 */
exports.listJobs = async (req, res) => {
  const companyId = req.developer.company_id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const query = { company: companyId };

  if (req.query.status) {
    query.status = req.query.status.toUpperCase();
  }

  if (req.query.search) {
    const s = req.query.search.trim();
    query.$or = [
      { title: new RegExp(s, 'i') },
      { uniqueId: new RegExp(s, 'i') },
      { external_job_id: new RegExp(s, 'i') },
      { 'location.city': new RegExp(s, 'i') }
    ];
  }

  try {
    const [jobs, total] = await Promise.all([
      Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Job.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: jobs.map(integrationService.mapInternalJobToApi),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API listJobs Error]:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * Helper to find job by uniqueId, external_job_id, or _id
 */
const findJobByFlexibleId = async (companyId, idStr) => {
  return await Job.findOne({
    company: companyId,
    $or: [
      { uniqueId: idStr },
      { external_job_id: idStr },
      ...(idStr.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: idStr }] : [])
    ]
  });
};

/**
 * @desc    Get job detail
 * @route   GET /api/v1/jobs/:id
 * @scope   jobs:read
 */
exports.getJob = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Update a job
 * @route   PATCH /api/v1/jobs/:id
 * @scope   jobs:write
 */
exports.updateJob = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    const { title, description, skills, openings, compensation, location } = req.body;
    if (title) job.title = title;
    if (description) job.description = description;
    if (Array.isArray(skills)) job.requirements = skills;
    if (openings) job.openings = Number(openings);

    if (compensation) {
      if (compensation.min != null) job.salary.min = compensation.min;
      if (compensation.max != null) job.salary.max = compensation.max;
      if (compensation.currency) job.salary.currency = compensation.currency;
    }

    if (location) {
      if (Array.isArray(location.city)) job.location.city = location.city;
      else if (typeof location.city === 'string') job.location.city = [location.city];
      if (location.state) job.location.state = location.state;
      if (location.country) job.location.country = location.country;
      if (location.is_remote != null) job.location.isRemote = Boolean(location.is_remote);
      if (location.is_hybrid != null) job.location.isHybrid = Boolean(location.is_hybrid);
      if (location.is_onsite != null) job.location.isOnSite = Boolean(location.is_onsite);
    }

    await job.save({ validateModifiedOnly: true });

    webhookService.emitEvent(companyId, 'job.updated', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      title: job.title,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Publish a job
 * @route   POST /api/v1/jobs/:id/publish
 * @scope   jobs:write
 */
exports.publishJob = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    job.status = 'ACTIVE';
    job.approvalStatus = 'APPROVED';
    await job.save({ validateModifiedOnly: true });

    webhookService.emitEvent(companyId, 'job.published', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Pause a job
 * @route   POST /api/v1/jobs/:id/pause
 * @scope   jobs:write
 */
exports.pauseJob = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    job.status = 'PAUSED';
    await job.save({ validateModifiedOnly: true });

    webhookService.emitEvent(companyId, 'job.paused', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Reopen a paused job
 * @route   POST /api/v1/jobs/:id/reopen
 * @scope   jobs:write
 */
exports.reopenJob = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    job.status = 'ACTIVE';
    await job.save({ validateModifiedOnly: true });

    webhookService.emitEvent(companyId, 'job.reopened', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Close a job
 * @route   POST /api/v1/jobs/:id/close
 * @scope   jobs:write
 */
exports.closeJob = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    job.status = 'CLOSED';
    await job.save({ validateModifiedOnly: true });

    webhookService.emitEvent(companyId, 'job.closed', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Get job status & timeline
 * @route   GET /api/v1/jobs/:id/status
 * @scope   jobs:read
 */
exports.getJobStatus = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        current_status: job.status,
        approval_status: job.approvalStatus,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
        history: job.changeHistory || []
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Get candidates for a specific job
 * @route   GET /api/v1/jobs/:id/candidates
 * @scope   candidates:read
 */
exports.getJobCandidates = async (req, res) => {
  const companyId = req.developer.company_id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    const query = { company: companyId, job: job._id };
    if (req.query.status) {
      query.candidateStatus = req.query.status.toUpperCase();
    }

    const [candidates, total] = await Promise.all([
      Candidate.find(query).populate('job', 'title uniqueId external_job_id').sort({ createdAt: -1 }).skip(skip).limit(limit),
      Candidate.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: candidates.map(integrationService.mapInternalCandidateToApi),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/* =========================================================================
   2. CANDIDATES API
========================================================================= */

/**
 * @desc    List all candidates across employer's jobs
 * @route   GET /api/v1/candidates
 * @scope   candidates:read
 */
exports.listCandidates = async (req, res) => {
  const companyId = req.developer.company_id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const query = { company: companyId };

  if (req.query.status) {
    query.candidateStatus = req.query.status.toUpperCase();
  }

  if (req.query.job_id) {
    const job = await findJobByFlexibleId(companyId, req.query.job_id);
    if (job) query.job = job._id;
  }

  try {
    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('job', 'title uniqueId external_job_id')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Candidate.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: candidates.map(integrationService.mapInternalCandidateToApi),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API listCandidates Error]:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * Helper to find candidate by uniqueId, external_candidate_id, or _id
 */
const findCandidateByFlexibleId = async (companyId, idStr) => {
  return await Candidate.findOne({
    company: companyId,
    $or: [
      { uniqueId: idStr },
      { external_candidate_id: idStr },
      ...(idStr.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: idStr }] : [])
    ]
  }).populate('job', 'title uniqueId external_job_id');
};

/**
 * @desc    Get candidate details
 * @route   GET /api/v1/candidates/:id
 * @scope   candidates:read
 */
exports.getCandidate = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalCandidateToApi(candidate),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Get candidate status & history
 * @route   GET /api/v1/candidates/:id/status
 * @scope   statuses:read
 */
exports.getCandidateStatus = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        candidate_id: candidate.uniqueId,
        external_candidate_id: candidate.external_candidate_id,
        current_status: candidate.candidateStatus,
        updated_at: candidate.updatedAt,
        history: candidate.statusHistory || []
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Update candidate status from ATS
 * @route   POST /api/v1/candidates/:id/status
 * @scope   statuses:write
 */
exports.updateCandidateStatus = async (req, res) => {
  const companyId = req.developer.company_id;
  const { status, external_candidate_id, notes } = req.body;

  const validStatuses = [
    'SHORTLISTED',
    'REJECTED',
    'INTERVIEW_SCHEDULED',
    'INTERVIEW_COMPLETED',
    'SELECTED',
    'OFFER_RELEASED',
    'OFFER_ACCEPTED',
    'JOINED',
    'ON_HOLD'
  ];

  if (!status || !validStatuses.includes(status.toUpperCase())) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'INVALID_STATUS_TRANSITION',
        message: `status must be one of: ${validStatuses.join(', ')}`
      },
      request_id: req.requestId
    });
  }

  try {
    const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
        request_id: req.requestId
      });
    }

    const previousStatus = candidate.candidateStatus;
    const newStatus = status.toUpperCase();

    candidate.candidateStatus = newStatus;
    if (external_candidate_id) {
      candidate.external_candidate_id = external_candidate_id;
    }

    if (!candidate.statusHistory) {
      candidate.statusHistory = [];
    }
    candidate.statusHistory.push({
      status: newStatus,
      changedAt: new Date(),
      notes: notes || 'Updated via ATS Developer API'
    });

    await candidate.save({ validateModifiedOnly: true });

    // Emit matching webhook event
    const eventNameMap = {
      SHORTLISTED: 'candidate.shortlisted',
      REJECTED: 'candidate.rejected',
      SELECTED: 'candidate.selected',
      OFFER_RELEASED: 'offer.released',
      OFFER_ACCEPTED: 'offer.accepted',
      JOINED: 'candidate.joined'
    };

    const webhookEvent = eventNameMap[newStatus];
    if (webhookEvent) {
      webhookService.emitEvent(companyId, webhookEvent, {
        candidate_id: candidate.uniqueId,
        external_candidate_id: candidate.external_candidate_id,
        job_id: candidate.job?.uniqueId,
        previous_status: previousStatus,
        new_status: newStatus
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    }

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalCandidateToApi(candidate),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/* =========================================================================
   3. INTERVIEWS API
========================================================================= */

/**
 * @desc    List interviews for company
 * @route   GET /api/v1/interviews
 * @scope   interviews:read
 */
exports.listInterviews = async (req, res) => {
  const companyId = req.developer.company_id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const query = { company: companyId };
  if (req.query.status) {
    query.status = req.query.status.toUpperCase();
  }

  try {
    const [slots, total] = await Promise.all([
      InterviewSlot.find(query)
        .populate('job', 'title uniqueId external_job_id')
        .populate('bookedCandidates.candidate', 'firstName lastName uniqueId external_candidate_id email')
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit),
      InterviewSlot.countDocuments(query)
    ]);

    const formatted = slots.map(slot => ({
      interview_id: String(slot._id),
      job_id: slot.job?.uniqueId || String(slot.job?._id || slot.job),
      date: slot.date,
      start_time: slot.startTime,
      end_time: slot.endTime,
      interview_mode: slot.interviewMode,
      status: slot.status,
      candidates: (slot.bookedCandidates || []).map(b => ({
        candidate_id: b.candidate?.uniqueId || String(b.candidate?._id || b.candidate),
        name: b.candidate ? `${b.candidate.firstName} ${b.candidate.lastName}` : null,
        email: b.candidate?.email || null,
        booking_status: b.bookingStatus,
        booked_at: b.bookedAt
      }))
    }));

    return res.status(200).json({
      success: true,
      data: formatted,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Get interview details
 * @route   GET /api/v1/interviews/:id
 * @scope   interviews:read
 */
exports.getInterview = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const slot = await InterviewSlot.findOne({
      _id: req.params.id,
      company: companyId
    })
      .populate('job', 'title uniqueId external_job_id')
      .populate('bookedCandidates.candidate', 'firstName lastName uniqueId external_candidate_id email mobile');

    if (!slot) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Interview slot not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        interview_id: String(slot._id),
        job_id: slot.job?.uniqueId,
        date: slot.date,
        start_time: slot.startTime,
        end_time: slot.endTime,
        max_candidates: slot.maxCandidates,
        available_spots: slot.availableSpots,
        interview_mode: slot.interviewMode,
        status: slot.status,
        notes: slot.notes,
        candidates: (slot.bookedCandidates || []).map(b => ({
          candidate_id: b.candidate?.uniqueId,
          name: b.candidate ? `${b.candidate.firstName} ${b.candidate.lastName}` : null,
          email: b.candidate?.email,
          booking_status: b.bookingStatus,
          booked_at: b.bookedAt
        }))
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Create / schedule interview slot
 * @route   POST /api/v1/interviews
 * @scope   interviews:write
 */
exports.createInterview = async (req, res) => {
  const companyId = req.developer.company_id;
  const { job_id, date, start_time, end_time, max_candidates, interview_mode, notes } = req.body;

  if (!job_id || !date || !start_time || !end_time) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'job_id, date, start_time, and end_time are required' },
      request_id: req.requestId
    });
  }

  try {
    const job = await findJobByFlexibleId(companyId, job_id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    const capacity = Number(max_candidates) || 1;
    const slot = await InterviewSlot.create({
      job: job._id,
      company: companyId,
      date: new Date(date),
      startTime: start_time,
      endTime: end_time,
      maxCandidates: capacity,
      availableSpots: capacity,
      interviewMode: interview_mode === 'Face-to-Face' ? 'Face-to-Face' : 'Virtual',
      notes: notes || null,
      status: 'ACTIVE'
    });

    webhookService.emitEvent(companyId, 'interview.scheduled', {
      interview_id: String(slot._id),
      job_id: job.uniqueId,
      date: slot.date,
      start_time: slot.startTime,
      end_time: slot.endTime
    }, { entity_type: 'INTERVIEW', entity_id: slot._id });

    return res.status(201).json({
      success: true,
      data: {
        interview_id: String(slot._id),
        job_id: job.uniqueId,
        date: slot.date,
        start_time: slot.startTime,
        end_time: slot.endTime,
        status: slot.status
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Cancel interview slot
 * @route   POST /api/v1/interviews/:id/cancel
 * @scope   interviews:write
 */
exports.cancelInterview = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const slot = await InterviewSlot.findOne({ _id: req.params.id, company: companyId });
    if (!slot) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Interview slot not found' },
        request_id: req.requestId
      });
    }

    slot.status = 'CANCELLED';
    await slot.save();

    webhookService.emitEvent(companyId, 'interview.cancelled', {
      interview_id: String(slot._id),
      status: 'CANCELLED'
    }, { entity_type: 'INTERVIEW', entity_id: slot._id });

    return res.status(200).json({
      success: true,
      data: { interview_id: String(slot._id), status: slot.status },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/* =========================================================================
   4. WEBHOOKS API
========================================================================= */

/**
 * @desc    List all webhooks for employer
 * @route   GET /api/v1/webhooks
 * @scope   webhooks:read
 */
exports.listWebhooks = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const webhooks = await WebhookEndpoint.find({ company_id: companyId }).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: webhooks.map(w => ({
        id: String(w._id),
        url: w.url,
        events: w.events,
        status: w.status,
        failure_count: w.failure_count,
        last_delivery_at: w.last_delivery_at,
        created_at: w.created_at
      })),
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Create a webhook endpoint
 * @route   POST /api/v1/webhooks
 * @scope   webhooks:write
 */
exports.createWebhook = async (req, res) => {
  const companyId = req.developer.company_id;
  const integrationId = req.developer.integration_id;
  const { url, events } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FIELD', message: 'Webhook url must be a valid HTTPS URL', field: 'url' },
      request_id: req.requestId
    });
  }

  try {
    const rawSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const endpoint = await WebhookEndpoint.create({
      integration_id: integrationId,
      company_id: companyId,
      url: url.trim(),
      secret_hash: rawSecret, // stored directly for HMAC computation
      events: Array.isArray(events) && events.length > 0 ? events : ['*'],
      status: 'ACTIVE'
    });

    return res.status(201).json({
      success: true,
      data: {
        id: String(endpoint._id),
        url: endpoint.url,
        events: endpoint.events,
        secret: rawSecret, // Displayed ONCE to user
        status: endpoint.status,
        created_at: endpoint.created_at
      },
      message: 'Save this webhook secret securely. It will not be shown again.',
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Delete a webhook endpoint
 * @route   DELETE /api/v1/webhooks/:id
 * @scope   webhooks:write
 */
exports.deleteWebhook = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const endpoint = await WebhookEndpoint.findOneAndDelete({
      _id: req.params.id,
      company_id: companyId
    });

    if (!endpoint) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Webhook endpoint not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook endpoint deleted',
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Send test webhook event
 * @route   POST /api/v1/webhooks/:id/test
 * @scope   webhooks:write
 */
exports.testWebhook = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const delivery = await webhookService.sendTestWebhook(req.params.id, companyId);
    return res.status(200).json({
      success: true,
      data: {
        delivery_id: String(delivery._id),
        event_id: delivery.event_id,
        status: delivery.status,
        response_code: delivery.response_code,
        response_body: delivery.response_body
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: { code: 'TEST_FAILED', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    List webhook deliveries
 * @route   GET /api/v1/webhooks/:id/deliveries
 * @scope   webhooks:read
 */
exports.listWebhookDeliveries = async (req, res) => {
  const companyId = req.developer.company_id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  try {
    const query = { company_id: companyId };
    if (req.params.id && req.params.id !== 'all') {
      query.webhook_id = req.params.id;
    }

    const [deliveries, total] = await Promise.all([
      WebhookDelivery.find(query).sort({ created_at: -1 }).skip(skip).limit(limit),
      WebhookDelivery.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: deliveries.map(d => ({
        id: String(d._id),
        event_id: d.event_id,
        event_type: d.event_type,
        status: d.status,
        attempts: d.attempts,
        response_code: d.response_code,
        response_body: d.response_body,
        last_attempt_at: d.last_attempt_at,
        created_at: d.created_at
      })),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/* =========================================================================
   5. INTEGRATION & LOGS API
========================================================================= */

/**
 * @desc    Get integration health & statistics
 * @route   GET /api/v1/integration
 * @scope   integration:read
 */
exports.getIntegration = async (req, res) => {
  const companyId = req.developer.company_id;
  const integrationId = req.developer.integration_id;

  try {
    const [integration, jobsCount, candidatesCount, interviewsCount, webhookCount, failedLogsCount] =
      await Promise.all([
        Integration.findById(integrationId),
        Job.countDocuments({ company: companyId, source_system: 'API' }),
        Candidate.countDocuments({ company: companyId }),
        InterviewSlot.countDocuments({ company: companyId }),
        WebhookDelivery.countDocuments({ company_id: companyId }),
        ApiLog.countDocuments({ company_id: companyId, status_code: { $gte: 400 } })
      ]);

    return res.status(200).json({
      success: true,
      data: {
        status: integration?.status || 'ACTIVE',
        environment: integration?.environment || 'PRODUCTION',
        last_sync_at: integration?.last_sync_at,
        health: {
          api_connection: 'HEALTHY',
          job_sync: 'HEALTHY',
          candidate_sync: 'HEALTHY',
          interview_sync: 'HEALTHY',
          webhooks: 'HEALTHY'
        },
        metrics: {
          jobs_synced: jobsCount,
          candidates_received: candidatesCount,
          interviews_synced: interviewsCount,
          webhook_events: webhookCount,
          failed_requests: failedLogsCount
        },
        settings: integration?.settings || {}
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    List API request logs
 * @route   GET /api/v1/logs/api
 * @scope   logs:read
 */
exports.listApiLogs = async (req, res) => {
  const companyId = req.developer.company_id;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const query = { company_id: companyId };

  if (req.query.status_code) {
    query.status_code = parseInt(req.query.status_code);
  }
  if (req.query.method) {
    query.method = req.query.method.toUpperCase();
  }

  try {
    const [logs, total] = await Promise.all([
      ApiLog.find(query).sort({ created_at: -1 }).skip(skip).limit(limit),
      ApiLog.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: logs.map(l => ({
        id: String(l._id),
        request_id: l.request_id,
        method: l.method,
        path: l.path,
        status_code: l.status_code,
        latency_ms: l.latency_ms,
        error_code: l.error_code,
        created_at: l.created_at
      })),
      pagination: {
        current: page,
        pages: Math.ceil(total / limit) || 1,
        total,
        limit
      },
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Get single API log detail
 * @route   GET /api/v1/logs/api/:requestId
 * @scope   logs:read
 */
exports.getApiLogDetail = async (req, res) => {
  const companyId = req.developer.company_id;
  try {
    const log = await ApiLog.findOne({
      company_id: companyId,
      $or: [{ request_id: req.params.requestId }, { _id: req.params.requestId }]
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'API log not found' },
        request_id: req.requestId
      });
    }

    return res.status(200).json({
      success: true,
      data: log,
      request_id: req.requestId
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

