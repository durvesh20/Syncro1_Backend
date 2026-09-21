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
const Company = require('../models/Company');
const User = require('../models/User');
const ScreeningQuestion = require('../models/ScreeningQuestion');
const JobEditRequest = require('../models/JobEditRequest');
const StaffingPartner = require('../models/StaffingPartner');
const integrationService = require('../services/integrationService');
const webhookService = require('../services/webhookService');
const candidateLifecycleService = require('../services/candidateLifecycleService');
const whatsappService = require('../services/whatsappService');
const notificationEngine = require('../services/notificationEngine');
const auditService = require('../services/auditService');
const emailService = require('../services/emailService');
const {
  transition,
  ACTIONS,
  ROLES,
  PIPELINE_STATES,
  MAX_CANDIDATE_RESCHEDULES,
  MAX_PARTNER_RESCHEDULES,
  getInitialRoundState
} = require('../services/pipelineStateMachine');

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
  const { title, description, external_job_id, vacancies, openings, salary, compensation, experience, skills } = req.body;

  // 1. Basic field validations
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'Job title is required', field: 'title' },
      request_id: req.requestId
    });
  }

  if (title.trim().length > 200) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FIELD', message: 'Title cannot exceed 200 characters', field: 'title' },
      request_id: req.requestId
    });
  }

  if (!description || typeof description !== 'string' || description.trim().length < 50) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FIELD', message: 'Job description is required and must be at least 50 characters', field: 'description' },
      request_id: req.requestId
    });
  }

  // 2. Validate vacancies
  const vacancyVal = vacancies ?? openings;
  if (vacancyVal !== undefined && (Number(vacancyVal) <= 0 || !Number.isInteger(Number(vacancyVal)))) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FIELD', message: 'Vacancies must be a positive integer greater than 0', field: 'vacancies' },
      request_id: req.requestId
    });
  }

  // 3. Validate salary range
  const comp = salary || compensation;
  if (comp) {
    if (comp.min != null && Number(comp.min) < 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FIELD', message: 'Salary minimum must be greater than or equal to 0', field: 'salary.min' },
        request_id: req.requestId
      });
    }
    if (comp.max != null && Number(comp.max) < 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FIELD', message: 'Salary maximum must be greater than or equal to 0', field: 'salary.max' },
        request_id: req.requestId
      });
    }
    if (comp.min != null && comp.max != null && Number(comp.min) > Number(comp.max)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FIELD', message: 'Salary minimum cannot be greater than salary maximum', field: 'salary' },
        request_id: req.requestId
      });
    }
  }

  // 4. Validate experience range
  if (experience) {
    const expMin = experience.min != null ? Number(experience.min) : 0;
    const expMax = experience.max != null ? Number(experience.max) : expMin;
    if (expMin < 0 || expMax < 0 || expMin > expMax) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FIELD', message: 'Experience minimum cannot be greater than maximum or negative', field: 'experience' },
        request_id: req.requestId
      });
    }
  }

  // 5. Validate mandatory skills
  let hasSkills = false;
  if (Array.isArray(skills) && skills.length > 0) hasSkills = true;
  else if (skills && typeof skills === 'object' && Array.isArray(skills.required) && skills.required.length > 0) hasSkills = true;
  else if (Array.isArray(req.body.requirements) && req.body.requirements.length > 0) hasSkills = true;

  if (!hasSkills) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'At least one mandatory skill is required to post a job', field: 'skills' },
      request_id: req.requestId
    });
  }

  try {
    // Check external_job_id uniqueness for this company
    if (external_job_id) {
      const existing = await Job.findOne({ company: companyId, external_job_id: String(external_job_id).trim() });
      if (existing) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_RESOURCE',
            message: `A job with external_job_id '${external_job_id}' already exists`,
            field: 'external_job_id',
            existing_job_id: existing.uniqueId || String(existing._id)
          },
          request_id: req.requestId
        });
      }
    }

    // Get integration to check user_id
    const integration = await Integration.findById(integrationId);
    const postedByUserId = integration?.user_id;

    if (!postedByUserId) {
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Integration user association missing' },
        request_id: req.requestId
      });
    }

    // Map payload to job schema (always routes to PENDING_APPROVAL)
    const jobData = integrationService.mapExternalJobToInternal(
      req.body,
      companyId,
      postedByUserId,
      integrationId
    );
    jobData.status = 'PENDING_APPROVAL';
    jobData.approvalStatus = 'PENDING_APPROVAL';

    const job = await Job.create(jobData);

    // Record audit history entries
    job.addToHistory('CREATED', postedByUserId, {}, 'Job created via Developer API');
    job.addToHistory('SUBMITTED', postedByUserId, {}, 'Job submitted for admin approval via Developer API');
    await job.save();

    // Persist optional screening questions if provided
    const rawQuestions = Array.isArray(req.body.screening_questions)
      ? req.body.screening_questions
      : (Array.isArray(req.body.screeningQuestions) ? req.body.screeningQuestions : []);

    if (rawQuestions.length > 0) {
      const questionsToInsert = rawQuestions
        .filter(q => q && typeof q.questionText === 'string' && q.questionText.trim())
        .map((q, idx) => ({
          job: job._id,
          questionText: q.questionText.trim(),
          answerType: ['yes_no', 'numeric'].includes(q.answerType) ? q.answerType : 'yes_no',
          idealAnswer: String(q.idealAnswer ?? (q.answerType === 'numeric' ? '0' : 'yes')),
          isRequired: q.isRequired !== false,
          createdBy: postedByUserId,
          order: idx
        }));

      if (questionsToInsert.length > 0) {
        await ScreeningQuestion.insertMany(questionsToInsert);
      }
    }

    // Increment company metric atomically
    const company = await Company.findByIdAndUpdate(companyId, {
      $inc: { 'metrics.totalJobsPosted': 1 }
    }, { new: true });

    // Update integration last_sync_at
    await Integration.findByIdAndUpdate(integrationId, { last_sync_at: new Date() });

    // Emit developer webhook
    webhookService.emitEvent(companyId, 'job.created', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      title: job.title,
      status: job.status
    }, { entity_type: 'JOB', entity_id: job._id });

    // Send Admin notification asynchronously
    const notifyAdmins = async () => {
      try {
        const notificationEngine = require('../services/notificationEngine');
        const adminUsers = await User.find({ role: 'admin' });
        for (const admin of adminUsers) {
          await notificationEngine.send({
            recipientId: admin._id,
            type: 'JOB_SUBMITTED_FOR_APPROVAL',
            title: `New API job requires approval: "${job.title}"`,
            message: `${company?.companyName || 'Company'} submitted job "${job.title}" for approval via Developer API.`,
            data: {
              jobId: job._id,
              uniqueId: job.uniqueId,
              companyId,
              companyName: company?.companyName || 'Company',
              source: 'API'
            }
          });
        }
      } catch (notifErr) {
        console.error('[Developer API createJob] Admin notification error:', notifErr.message);
      }
    };
    notifyAdmins();

    return res.status(201).json({
      success: true,
      message: 'Job created and submitted for admin approval.',
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
 * @route   GET /api/v1/jobs/:id/**
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

    const jobData = integrationService.mapInternalJobToApi(job);

    // Attach screening questions if any exist
    const screeningQuestions = await ScreeningQuestion.find({ job: job._id }).sort({ order: 1 });
    if (screeningQuestions.length > 0) {
      jobData.screening_questions = screeningQuestions.map(q => ({
        id: q._id,
        questionText: q.questionText,
        answerType: q.answerType,
        idealAnswer: q.idealAnswer,
        isRequired: q.isRequired
      }));
    }

    return res.status(200).json({
      success: true,
      data: jobData,
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
 * @desc    Update a job (Direct update if PENDING_APPROVAL; creates JobEditRequest for Admin Approval if ACTIVE)
 * @route   PATCH /api/v1/jobs/:id
 * @scope   jobs:write
 */
exports.updateJob = async (req, res) => {
  const companyId = req.developer.company_id;
  const integrationId = req.developer.integration_id;
  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    const integration = await Integration.findById(integrationId);
    const postedByUserId = integration?.user_id;

    // ── CASE 1: Job is in PENDING_APPROVAL or REJECTED ──────────────────────
    // PENDING_APPROVAL: Admin has not reviewed yet. Edits apply directly.
    // REJECTED: Admin requested revisions. Updating fixes issues and resubmits to PENDING_APPROVAL.
    if (job.status === 'PENDING_APPROVAL' || job.status === 'REJECTED') {
      const wasRejected = job.status === 'REJECTED';
      const {
        title, description, category, subCategory, sub_category, department,
        skills, requirements, vacancies, openings, salary, compensation,
        experience, location, education, applicationDeadline, application_deadline,
        expectedJoiningDate, expected_joining_date, screening_questions, screeningQuestions
      } = req.body;

      if (title && typeof title === 'string' && title.trim()) {
        if (title.trim().length > 200) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FIELD', message: 'Title cannot exceed 200 characters', field: 'title' },
            request_id: req.requestId
          });
        }
        job.title = title.trim();
      }

      if (description && typeof description === 'string') {
        if (description.trim().length < 50) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FIELD', message: 'Description must be at least 50 characters', field: 'description' },
            request_id: req.requestId
          });
        }
        job.description = description.trim();
      }

      if (category || department) {
        job.category = (category || department).trim();
      }
      if (subCategory || sub_category) {
        job.subCategory = (subCategory || sub_category).trim();
      }

      const vac = vacancies ?? openings;
      if (vac !== undefined) {
        const numVac = Number(vac);
        if (numVac <= 0 || !Number.isInteger(numVac)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FIELD', message: 'Vacancies must be a positive integer greater than 0', field: 'vacancies' },
            request_id: req.requestId
          });
        }
        job.vacancies = numVac;
      }

      const comp = salary || compensation;
      if (comp) {
        if (comp.min != null && Number(comp.min) < 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FIELD', message: 'Salary minimum must be >= 0', field: 'salary.min' },
            request_id: req.requestId
          });
        }
        if (comp.max != null && Number(comp.max) < 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_FIELD', message: 'Salary maximum must be >= 0', field: 'salary.max' },
            request_id: req.requestId
          });
        }
        job.salary = job.salary || {};
        if (comp.min != null) job.salary.min = Number(comp.min);
        if (comp.max != null) job.salary.max = Number(comp.max);
        if (comp.currency) job.salary.currency = comp.currency;
        if (comp.is_negotiable != null || comp.isNegotiable != null) {
          job.salary.isNegotiable = Boolean(comp.is_negotiable ?? comp.isNegotiable);
        }
        if (comp.is_confidential != null || comp.isConfidential != null) {
          job.salary.isConfidential = Boolean(comp.is_confidential ?? comp.isConfidential);
        }
      }

      if (experience) {
        job.experienceRange = job.experienceRange || {};
        if (experience.min != null) job.experienceRange.min = Number(experience.min);
        if (experience.max != null) job.experienceRange.max = Number(experience.max);
        if (experience.level) job.experienceLevel = experience.level;
      }

      if (skills || requirements) {
        let reqSkills = [];
        let prefSkills = [];
        if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
          reqSkills = Array.isArray(skills.required) ? skills.required : [];
          prefSkills = Array.isArray(skills.preferred) ? skills.preferred : [];
        } else if (Array.isArray(skills)) {
          reqSkills = skills;
        } else if (Array.isArray(requirements)) {
          reqSkills = requirements;
        }
        job.skills = { required: reqSkills, preferred: prefSkills };
        job.requirements = reqSkills;
      }

      if (education) {
        job.education = job.education || {};
        if (education.minimum) job.education.minimum = education.minimum;
        if (Array.isArray(education.preferred)) job.education.preferred = education.preferred;
      }

      if (location) {
        job.location = job.location || {};
        if (Array.isArray(location.city)) job.location.city = location.city;
        else if (typeof location.city === 'string') job.location.city = [location.city];
        if (location.state) job.location.state = location.state;
        if (location.country) job.location.country = location.country;
        if (location.is_remote != null) job.location.isRemote = Boolean(location.is_remote);
        if (location.is_hybrid != null) job.location.isHybrid = Boolean(location.is_hybrid);
        if (location.is_onsite != null) job.location.isOnSite = Boolean(location.is_onsite);
      }

      const rawDeadline = applicationDeadline || application_deadline;
      if (rawDeadline) {
        const parsed = new Date(rawDeadline);
        if (!isNaN(parsed.getTime())) job.applicationDeadline = parsed;
      }

      const rawJoining = expectedJoiningDate || expected_joining_date;
      if (rawJoining) {
        job.expectedJoiningDate = Array.isArray(rawJoining) ? rawJoining : [rawJoining];
      }

      // Handle screening questions if passed
      const rawQuestions = Array.isArray(screening_questions) ? screening_questions : (Array.isArray(screeningQuestions) ? screeningQuestions : null);
      if (rawQuestions) {
        await ScreeningQuestion.deleteMany({ job: job._id });
        const questionsToInsert = rawQuestions
          .filter(q => q && typeof q.questionText === 'string' && q.questionText.trim())
          .map((q, idx) => ({
            job: job._id,
            questionText: q.questionText.trim(),
            answerType: ['yes_no', 'numeric'].includes(q.answerType) ? q.answerType : 'yes_no',
            idealAnswer: String(q.idealAnswer ?? (q.answerType === 'numeric' ? '0' : 'yes')),
            isRequired: q.isRequired !== false,
            createdBy: postedByUserId,
            order: idx
          }));
        if (questionsToInsert.length > 0) {
          await ScreeningQuestion.insertMany(questionsToInsert);
        }
      }

      if (wasRejected) {
        job.status = 'PENDING_APPROVAL';
        job.approvalStatus = 'PENDING_APPROVAL';
        job.addToHistory('SUBMITTED', postedByUserId, req.body, 'Job revised and resubmitted for admin approval via Developer API');
      } else {
        job.addToHistory('UPDATED', postedByUserId, req.body, 'Job modified via ATS API while pending approval');
      }
      await job.save();

      // If resubmitted from REJECTED, notify Admins that revisions have been made
      if (wasRejected) {
        const notifyAdmins = async () => {
          try {
            const notificationEngine = require('../services/notificationEngine');
            const adminUsers = await User.find({ role: 'admin' });
            for (const admin of adminUsers) {
              await notificationEngine.send({
                recipientId: admin._id,
                type: 'JOB_SUBMITTED_FOR_APPROVAL',
                title: `Revised API job requires approval: "${job.title}"`,
                message: `Employer revised previously rejected job "${job.title}" via Developer API and resubmitted for review.`,
                data: {
                  jobId: job._id,
                  uniqueId: job.uniqueId,
                  companyId,
                  source: 'API'
                }
              });
            }
          } catch (notifErr) {
            console.error('[Developer API updateJob] Admin notification error:', notifErr.message);
          }
        };
        notifyAdmins();
      }

      webhookService.emitEvent(companyId, 'job.updated', {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        title: job.title,
        status: job.status,
        resubmitted: wasRejected
      }, { entity_type: 'JOB', entity_id: job._id });

      return res.status(200).json({
        success: true,
        message: wasRejected
          ? 'Job updated and resubmitted for admin approval.'
          : 'Job updated successfully while pending approval.',
        data: integrationService.mapInternalJobToApi(job),
        request_id: req.requestId
      });
    }

    // ── CASE 2: Job is ACTIVE ────────────────────────────────────────────────
    // Recruiters are live. Changes must strictly go to Admin for Edit Approval!
    if (job.status === 'ACTIVE') {
      // Check if an edit request is already pending
      const existingRequest = await JobEditRequest.findOne({
        job: job._id,
        status: 'PENDING'
      });

      if (existingRequest) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PENDING_EDIT_EXISTS',
            message: 'An edit request is already pending admin review for this active job. Please wait for resolution before submitting further changes.',
            edit_request_id: existingRequest._id
          },
          request_id: req.requestId
        });
      }

      // Compute field diff between requested changes and current job
      const requestedChanges = {};

      const checkFieldDiff = (fieldPath, incomingVal, currentVal) => {
        if (incomingVal === undefined) return;
        const incomingStr = JSON.stringify(incomingVal);
        const currentStr = JSON.stringify(currentVal);
        if (incomingStr !== currentStr) {
          requestedChanges[fieldPath] = {
            old: currentVal !== undefined ? currentVal : null,
            new: incomingVal
          };
        }
      };

      if (req.body.title && req.body.title.trim()) {
        checkFieldDiff('title', req.body.title.trim(), job.title);
      }
      if (req.body.description && req.body.description.trim()) {
        checkFieldDiff('description', req.body.description.trim(), job.description);
      }
      if (req.body.category || req.body.department) {
        checkFieldDiff('category', (req.body.category || req.body.department).trim(), job.category);
      }
      if (req.body.subCategory || req.body.sub_category) {
        checkFieldDiff('subCategory', (req.body.subCategory || req.body.sub_category).trim(), job.subCategory);
      }

      const vac = req.body.vacancies ?? req.body.openings;
      if (vac !== undefined) {
        checkFieldDiff('vacancies', Number(vac), job.vacancies);
      }

      const comp = req.body.salary || req.body.compensation;
      if (comp) {
        if (comp.min !== undefined) checkFieldDiff('salary.min', Number(comp.min), job.salary?.min);
        if (comp.max !== undefined) checkFieldDiff('salary.max', Number(comp.max), job.salary?.max);
        if (comp.currency !== undefined) checkFieldDiff('salary.currency', comp.currency, job.salary?.currency);
      }

      if (req.body.skills || req.body.requirements) {
        let reqSkills = [];
        if (Array.isArray(req.body.skills)) reqSkills = req.body.skills;
        else if (req.body.skills?.required) reqSkills = req.body.skills.required;
        else if (Array.isArray(req.body.requirements)) reqSkills = req.body.requirements;
        checkFieldDiff('skills.required', reqSkills, job.skills?.required || job.requirements || []);
      }

      if (req.body.location) {
        if (req.body.location.city) {
          const cities = Array.isArray(req.body.location.city) ? req.body.location.city : [req.body.location.city];
          checkFieldDiff('location.city', cities, job.location?.city || []);
        }
        if (req.body.location.is_remote !== undefined) {
          checkFieldDiff('location.isRemote', Boolean(req.body.location.is_remote), job.location?.isRemote);
        }
        if (req.body.location.is_hybrid !== undefined) {
          checkFieldDiff('location.isHybrid', Boolean(req.body.location.is_hybrid), job.location?.isHybrid);
        }
        if (req.body.location.is_onsite !== undefined) {
          checkFieldDiff('location.isOnSite', Boolean(req.body.location.is_onsite), job.location?.isOnSite);
        }
      }

      if (Object.keys(requestedChanges).length === 0) {
        return res.status(200).json({
          success: true,
          message: 'No changes detected between incoming payload and existing active job.',
          data: integrationService.mapInternalJobToApi(job),
          request_id: req.requestId
        });
      }

      // Create JobEditRequest in DB
      const changeDesc = req.body.change_description || req.body.reason || 'Job modified via ATS API synchronization';
      const editRequest = await JobEditRequest.create({
        job: job._id,
        company: companyId,
        requestedBy: postedByUserId,
        requestedChanges,
        changeDescription: String(changeDesc).trim().slice(0, 1000) || 'Modified via ATS API',
        priority: req.body.priority || 'MEDIUM',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      // Move job status to EDIT_REQUESTED
      job.status = 'EDIT_REQUESTED';
      job.editRequestCount = (job.editRequestCount || 0) + 1;
      job.lastEditRequestAt = new Date();
      job.addToHistory('EDIT_REQUESTED', postedByUserId, requestedChanges, changeDesc);
      await job.save();

      // Emit developer webhook: job.edit_requested
      webhookService.emitEvent(companyId, 'job.edit_requested', {
        edit_request_id: editRequest._id,
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        status: 'EDIT_REQUESTED',
        requested_changes: requestedChanges
      }, { entity_type: 'JOB', entity_id: job._id });

      // Notify Admins to inspect & approve the edit
      const notifyAdmins = async () => {
        try {
          const notificationEngine = require('../services/notificationEngine');
          const adminUsers = await User.find({ role: 'admin' });
          const compDoc = await Company.findById(companyId).select('companyName');
          for (const admin of adminUsers) {
            await notificationEngine.send({
              recipientId: admin._id,
              type: 'JOB_EDIT_REQUESTED',
              title: `Job edit requires approval: "${job.title}"`,
              message: `${compDoc?.companyName || 'Company'} modified terms on active job "${job.title}" via ATS API. Requires verification.`,
              data: {
                editRequestId: editRequest._id,
                jobId: job._id,
                uniqueId: job.uniqueId,
                companyId,
                source: 'API'
              }
            });
          }
        } catch (notifErr) {
          console.error('[Developer API updateJob] Admin notification error:', notifErr.message);
        }
      };
      notifyAdmins();

      return res.status(202).json({
        success: true,
        action: 'EDIT_REQUEST_SUBMITTED',
        message: 'Job is currently active. Changes to job terms have been submitted to Admin for verification and approval.',
        data: {
          edit_request_id: editRequest._id,
          job_id: job.uniqueId,
          external_job_id: job.external_job_id,
          status: 'EDIT_REQUESTED',
          requested_changes: requestedChanges
        },
        request_id: req.requestId
      });
    }

    // ── CASE 3: Job is in EDIT_REQUESTED, CLOSED, or FILLED ──────────────────
    if (job.status === 'EDIT_REQUESTED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EDIT_IN_PROGRESS',
          message: 'Job is currently awaiting admin verification for a pending edit request. Further edits cannot be submitted until resolved.'
        },
        request_id: req.requestId
      });
    }

    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STATUS',
        message: `Cannot edit a job with status '${job.status}'. Reopen or reactivate the job first.`
      },
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API updateJob Error]:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Update job operational status (FILLED, CLOSED, ON_HOLD, ACTIVE)
 * @route   PATCH /api/v1/jobs/:id/status
 * @scope   jobs:write
 */
exports.updateJobStatus = async (req, res) => {
  const companyId = req.developer.company_id;
  const integrationId = req.developer.integration_id;
  const { status, reason, notes } = req.body;

  if (!status || typeof status !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_FIELD',
        message: 'Field "status" is required. Valid values: FILLED, CLOSED, ON_HOLD, PAUSED, ACTIVE',
        field: 'status'
      },
      request_id: req.requestId
    });
  }

  const targetStatus = status.trim().toUpperCase();
  const allowedStatuses = ['FILLED', 'CLOSED', 'ON_HOLD', 'PAUSED', 'ACTIVE'];

  if (!allowedStatuses.includes(targetStatus)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_STATUS',
        message: `Status '${status}' is not supported. Valid statuses: ${allowedStatuses.join(', ')}`,
        field: 'status'
      },
      request_id: req.requestId
    });
  }

  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    const previousStatus = job.status;
    const comment = reason || notes || `Status updated to ${targetStatus} via ATS API`;

    // Prevent bypassing admin approval if job is PENDING_APPROVAL
    if (previousStatus === 'PENDING_APPROVAL' && targetStatus === 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: 'Cannot transition a PENDING_APPROVAL job directly to ACTIVE via API. Admin verification is required.'
        },
        request_id: req.requestId
      });
    }

    const integration = await Integration.findById(integrationId);
    const userId = integration?.user_id;

    if (targetStatus === 'FILLED') {
      job.status = 'FILLED';
      job.filledPositions = job.vacancies;
      job.addToHistory('CLOSED', userId, { previousStatus, newStatus: 'FILLED' }, comment);
      await job.save();

      webhookService.emitEvent(companyId, 'job.filled', {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        status: 'FILLED'
      }, { entity_type: 'JOB', entity_id: job._id });

    } else if (targetStatus === 'CLOSED') {
      job.status = 'CLOSED';
      job.addToHistory('CLOSED', userId, { previousStatus, newStatus: 'CLOSED' }, comment);
      await job.save();

      // Decrement active jobs metric
      await Company.findByIdAndUpdate(companyId, {
        $inc: { 'metrics.activeJobs': -1 }
      });

      webhookService.emitEvent(companyId, 'job.closed', {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        status: 'CLOSED'
      }, { entity_type: 'JOB', entity_id: job._id });

    } else if (targetStatus === 'ON_HOLD' || targetStatus === 'PAUSED') {
      job.status = targetStatus === 'ON_HOLD' ? 'ON_HOLD' : 'PAUSED';
      job.addToHistory('PAUSED', userId, { previousStatus, newStatus: job.status }, comment);
      await job.save();

      webhookService.emitEvent(companyId, 'job.paused', {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        status: job.status
      }, { entity_type: 'JOB', entity_id: job._id });

    } else if (targetStatus === 'ACTIVE') {
      job.status = 'ACTIVE';
      job.approvalStatus = 'APPROVED';
      job.addToHistory('RESUMED', userId, { previousStatus, newStatus: 'ACTIVE' }, comment);
      await job.save();

      webhookService.emitEvent(companyId, 'job.reopened', {
        job_id: job.uniqueId,
        external_job_id: job.external_job_id,
        status: 'ACTIVE'
      }, { entity_type: 'JOB', entity_id: job._id });
    }

    // Always emit unified job.status_updated webhook
    webhookService.emitEvent(companyId, 'job.status_updated', {
      job_id: job.uniqueId,
      external_job_id: job.external_job_id,
      previous_status: previousStatus,
      new_status: job.status,
      reason: comment
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(200).json({
      success: true,
      message: `Job status updated to ${job.status} successfully`,
      data: integrationService.mapInternalJobToApi(job),
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API updateJobStatus Error]:', error);
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

    if (job.status === 'PENDING_APPROVAL' || job.status === 'REJECTED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'APPROVAL_REQUIRED',
          message: job.status === 'REJECTED'
            ? `Job was rejected by Admin (Reason: "${job.rejectionReason || 'Requires revision'}"). Please update the job via PATCH /api/v1/jobs/:id to address issues and resubmit for approval.`
            : 'Job is currently awaiting Admin approval and cannot be directly published via API.'
        },
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
        rejection_reason: job.rejectionReason || null,
        rejected_at: job.rejectedAt || null,
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

// ── Time Calculation Helpers ──────────────────────────────────────────────────
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(' ');
  const [hoursStr, minutesStr] = parts[0].split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10) || 0;
  const modifier = parts[1] ? parts[1].toUpperCase() : '';

  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const addMinutesTo12h = (timeStr, minutesToAdd) => {
  const parts = timeStr.trim().split(' ');
  const [hoursStr, minutesStr] = parts[0].split(':');
  let hours = parseInt(hoursStr, 10);
  const mins = parseInt(minutesStr, 10) || 0;
  const modifier = parts[1] ? parts[1].toUpperCase() : '';

  if (modifier === 'PM' && hours < 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;

  const totalMins = hours * 60 + mins + minutesToAdd;
  let newHours = Math.floor(totalMins / 60) % 24;
  const newMins = totalMins % 60;
  const ampm = newHours >= 12 ? 'PM' : 'AM';
  newHours = newHours % 12 || 12;

  return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')} ${ampm}`;
};

// Hidden candidate statuses (Pre-pipeline sourcing states never visible to employers)
const HIDDEN_CANDIDATE_STATUSES = [
  'DRAFT',
  'CONSENT_PENDING',
  'CONSENT_CONFIRMED',
  'CONSENT_DENIED',
  'ADMIN_REVIEW',
  'ADMIN_REJECTED'
];

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
      query.status = req.query.status.toUpperCase();
    } else {
      query.status = { $nin: HIDDEN_CANDIDATE_STATUSES };
    }

    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('job', 'title uniqueId external_job_id pipelineTemplate')
        .populate('assignedSlot')
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
    query.status = req.query.status.toUpperCase();
  } else {
    query.status = { $nin: HIDDEN_CANDIDATE_STATUSES };
  }

  if (req.query.job_id) {
    const job = await findJobByFlexibleId(companyId, req.query.job_id);
    if (job) query.job = job._id;
  }

  if (req.query.search && typeof req.query.search === 'string') {
    const s = req.query.search.trim();
    if (s) {
      query.$or = [
        { firstName: { $regex: s, $options: 'i' } },
        { lastName: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { mobile: { $regex: s, $options: 'i' } },
        { uniqueId: { $regex: s, $options: 'i' } }
      ];
    }
  }

  try {
    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('job', 'title uniqueId external_job_id pipelineTemplate')
        .populate('assignedSlot')
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
  })
    .populate('job', 'title uniqueId external_job_id pipelineTemplate')
    .populate('assignedSlot')
    .populate('company', 'companyName user');
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
 * @desc    Get candidate status, active round & history
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

    let activeRound = null;
    if (Array.isArray(candidate.rounds) && candidate.rounds.length > 0) {
      const found = candidate.rounds.find(r =>
        !['ROUND_REJECTED', 'ASSESSMENT_FAILED', 'ROUND_SELECTED_NEXT', 'HR_SELECTED', 'HR_REJECTED'].includes(r.status)
      ) || candidate.rounds[candidate.rounds.length - 1];

      if (found) {
        activeRound = {
          round_type: found.roundType,
          order: found.order,
          status: found.status,
          reschedule_count: found.rescheduleCount || {}
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        candidate_id: candidate.uniqueId,
        external_candidate_id: candidate.external_candidate_id,
        current_status: candidate.status,
        current_round: activeRound,
        interview_details: candidate.interviewConfig?.mode ? {
          mode: candidate.interviewConfig.mode,
          details: candidate.interviewConfig.details,
          interviewer: candidate.interviewConfig.interviewer,
          confirmed: candidate.interviewConfig.isConfirmedByCompany,
          candidate_response: candidate.interviewConfig.candidateResponse,
          responded_at: candidate.interviewConfig.respondedAt
        } : null,
        updated_at: candidate.updatedAt,
        history: candidate.statusHistory || [],
        audit_trail: candidate.auditTrail || []
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
 * @desc    Get full candidate pipeline progression
 * @route   GET /api/v1/candidates/:id/pipeline
 * @scope   candidates:read
 */
exports.getCandidatePipeline = async (req, res) => {
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
        current_status: candidate.status,
        pipeline_template: candidate.pipelineTemplate || candidate.job?.pipelineTemplate || [],
        rounds: (candidate.rounds || []).map(r => ({
          round_type: r.roundType,
          order: r.order,
          status: r.status,
          reschedule_count: r.rescheduleCount,
          outcome: r.outcome || null,
          slots: (r.slots || []).map(s => ({
            date: s.date,
            start_time: s.startTime,
            end_time: s.endTime,
            mode: s.mode,
            interviewer: s.interviewerName,
            details: s.details || null
          }))
        })),
        audit_trail: candidate.auditTrail || []
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

// ─── Helper for Developer Candidate Override Actions (Global Reject, Drop, Duplicate, Not Joined) ──
const _performDeveloperCandidateOverride = async ({
  req,
  res,
  targetState,
  action,
  reason,
  auditAction,
  webhookEvent
}) => {
  const companyId = req.developer.company_id;
  const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
  if (!candidate) {
    return res.status(404).json({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
      request_id: req.requestId
    });
  }

  const fromState = candidate.status;
  if (fromState === 'JOINED') {
    return res.status(422).json({
      success: false,
      error: {
        code: 'ALREADY_JOINED',
        message: 'Cannot reject or modify a candidate who has already joined.'
      },
      request_id: req.requestId
    });
  }

  const company = await Company.findById(companyId).populate('user', 'email firstName lastName');
  const userId = company?.user?._id || req.developer.client_id;
  const actorEmail = company?.user?.email || `api-client:${req.developer.client_id}`;
  const actorFirstName = company?.user?.firstName || company?.companyName || 'Developer';
  const actorLastName = company?.user?.lastName || 'API';

  candidate.status = targetState;
  candidate.statusHistory = candidate.statusHistory || [];
  candidate.statusHistory.push({
    status: targetState,
    changedBy: userId,
    changedAt: new Date(),
    notes: reason
  });

  // Update active round in candidate.rounds array to match targetState
  if (Array.isArray(candidate.rounds)) {
    for (const r of candidate.rounds) {
      if (!r.outcome || !r.outcome.decision) {
        r.status = targetState;
        r.outcome = {
          decision: targetState,
          decidedBy: userId,
          decidedAt: new Date(),
          notes: reason
        };
        break;
      }
    }
  }

  // Enriched audit trail
  candidate.auditTrail = candidate.auditTrail || [];
  candidate.auditTrail.push({
    actorId: userId,
    actorRole: 'company',
    actorEmail,
    actorFirstName,
    actorLastName,
    action,
    fromState,
    toState: targetState,
    reason,
    timestamp: new Date()
  });

  if (targetState === 'NOT_JOINED') {
    candidate.joining = {
      ...(candidate.joining || {}),
      confirmed: false
    };
  }

  await candidate.save();

  // Audit service logging (non-blocking)
  auditService.log({
    actor: userId,
    actorRole: 'company',
    actorEmail,
    action: auditAction,
    entityType: 'CandidateApplication',
    entityId: candidate._id,
    description: `[Developer API | ${req.developer.client_id}] ${auditAction} from ${fromState}. Reason: ${reason}`,
    notes: reason,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']
  }).catch(err => console.error('[AUDIT] Failed to log developer override audit:', err.message));

  // Notify staffing partner via email (non-blocking)
  try {
    const populated = await Candidate.findById(candidate._id)
      .populate('job')
      .populate({ path: 'submittedBy', populate: { path: 'user', select: 'email' } });

    const partnerEmail = populated?.submittedBy?.user?.email;
    if (partnerEmail) {
      emailService.sendEmail({
        to: partnerEmail,
        subject: `❌ Candidate Status Update - ${populated.job?.title || 'Job Application'}`,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <div style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0; text-align: center;">
            <h2 style="margin: 0; font-size: 20px;">Candidate Status Update</h2>
          </div>
          <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
            <p>Hello Team,</p>
            <p>Your candidate, <strong>${candidate.firstName} ${candidate.lastName}</strong>, has been updated for the <strong>${populated.job?.title || ''}</strong> role.</p>
            <p><strong>Status:</strong> ${targetState.replace(/_/g, ' ')}</p>
            <p><strong>Reason:</strong> ${reason}</p>
          </div>
        </div>`
      }).catch(e => console.error('[EMAIL] Partner notification email failed:', e.message));
    }
  } catch (emailErr) {
    console.error('[NOTIFY] Partner email error:', emailErr.message);
  }

  // Emit webhook
  webhookService.emitEvent(companyId, webhookEvent, {
    candidate_id: candidate.uniqueId,
    external_candidate_id: candidate.external_candidate_id,
    job_id: candidate.job?.uniqueId,
    previous_status: fromState,
    new_status: targetState,
    reason
  }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

  return res.status(200).json({
    success: true,
    message: `Candidate status updated to ${targetState}`,
    data: {
      candidate_id: candidate.uniqueId,
      external_candidate_id: candidate.external_candidate_id,
      previous_status: fromState,
      status: targetState,
      reason
    },
    request_id: req.requestId
  });
};

/**
 * @desc    Update candidate status from ATS (Shortlist, Reject, Offer Accept, Joined, Drop, Duplicate, etc.)
 * @route   POST /api/v1/candidates/:id/status
 * @scope   statuses:write, candidates:write
 */
exports.updateCandidateStatus = async (req, res) => {
  const companyId = req.developer.company_id;
  const { status, external_candidate_id, notes, reason } = req.body;

  const validStatuses = [
    'SHORTLISTED',
    'REJECTED',
    'CLIENT_PORTAL_DUPLICATE',
    'CANDIDATE_DROP',
    'NOT_JOINED',
    'INTERVIEW_SCHEDULED',
    'INTERVIEWED',
    'OFFERED',
    'OFFER_ACCEPTED',
    'OFFER_DECLINED',
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

  const newStatus = status.toUpperCase();

  // Route override actions to dedicated override handler for full platform parity
  if (newStatus === 'REJECTED') {
    const rejectReason = reason || notes || 'Rejected via ATS Developer API';
    if (rejectReason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: { code: 'REASON_REQUIRED', message: 'A reason is required (minimum 5 characters).' },
        request_id: req.requestId
      });
    }
    return _performDeveloperCandidateOverride({
      req,
      res,
      targetState: 'REJECTED',
      action: 'GLOBAL_REJECT',
      reason: rejectReason.trim(),
      auditAction: 'PIPELINE_GLOBAL_REJECT',
      webhookEvent: 'candidate.rejected'
    });
  }

  if (newStatus === 'CLIENT_PORTAL_DUPLICATE') {
    const duplicateReason = reason || notes || 'Duplicate entry in Client Portal';
    return _performDeveloperCandidateOverride({
      req,
      res,
      targetState: 'CLIENT_PORTAL_DUPLICATE',
      action: 'CLIENT_PORTAL_DUPLICATE',
      reason: duplicateReason,
      auditAction: 'PIPELINE_CLIENT_PORTAL_DUPLICATE',
      webhookEvent: 'candidate.duplicate'
    });
  }

  if (newStatus === 'CANDIDATE_DROP') {
    const customReason = reason || notes;
    const dropReason = customReason && typeof customReason === 'string' && customReason.trim()
      ? `Candidate Drop: ${customReason.trim()}`
      : 'Candidate Drop';
    return _performDeveloperCandidateOverride({
      req,
      res,
      targetState: 'CANDIDATE_DROP',
      action: 'CANDIDATE_DROP',
      reason: dropReason,
      auditAction: 'PIPELINE_CANDIDATE_DROP',
      webhookEvent: 'candidate.dropped'
    });
  }

  if (newStatus === 'NOT_JOINED') {
    const notJoinedReason = reason || notes || 'Candidate marked as not joined';
    return _performDeveloperCandidateOverride({
      req,
      res,
      targetState: 'NOT_JOINED',
      action: 'MARK_NOT_JOINED',
      reason: notJoinedReason,
      auditAction: 'PIPELINE_MARK_NOT_JOINED',
      webhookEvent: 'candidate.not_joined'
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

    const previousStatus = candidate.status;

    if (external_candidate_id) {
      candidate.external_candidate_id = external_candidate_id;
      await candidate.save({ validateModifiedOnly: true });
    }

    // Resolve company user ID for candidateLifecycleService
    const company = await Company.findById(companyId);
    const userId = company?.user || req.developer.client_id;

    // Use centralized CandidateLifecycleService to ensure:
    // 1. Valid status transition check
    // 2. Cloning pipelineTemplate into rounds when SHORTLISTED
    // 3. Incrementing job metrics atomically
    // 4. Dispatching notifications to Staffing Partner
    // 5. Handling 5% commission & 90-day replacement guarantee if JOINED
    const updatedCandidate = await candidateLifecycleService.updateStatus(
      candidate._id,
      newStatus,
      userId,
      'company',
      notes || reason || `Status updated to ${newStatus} via ATS Developer API`
    );

    // Emit matching webhook event
    const eventNameMap = {
      SHORTLISTED: 'candidate.shortlisted',
      INTERVIEW_SCHEDULED: 'interview.scheduled',
      OFFERED: 'offer.released',
      OFFER_ACCEPTED: 'offer.accepted',
      OFFER_DECLINED: 'offer.declined',
      JOINED: 'candidate.joined',
      ON_HOLD: 'candidate.on_hold'
    };

    const webhookEvent = eventNameMap[newStatus];
    if (webhookEvent) {
      webhookService.emitEvent(companyId, webhookEvent, {
        candidate_id: candidate.uniqueId,
        external_candidate_id: candidate.external_candidate_id,
        job_id: candidate.job?.uniqueId,
        previous_status: previousStatus,
        new_status: newStatus,
        reason: reason || notes || null
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    }

    return res.status(200).json({
      success: true,
      data: integrationService.mapInternalCandidateToApi(updatedCandidate),
      request_id: req.requestId
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: error.message, allowedTransitions: error.allowedTransitions },
        request_id: req.requestId
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Global force-reject candidate from any stage
 * @route   POST /api/v1/candidates/:id/global-reject
 * @route   POST /api/v1/candidates/:id/reject
 * @scope   candidates:write, statuses:write
 */
exports.globalRejectCandidate = async (req, res) => {
  const reason = req.body?.reason || req.body?.notes;
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({
      success: false,
      error: { code: 'REASON_REQUIRED', message: 'A reason is required (minimum 5 characters).' },
      request_id: req.requestId
    });
  }

  return _performDeveloperCandidateOverride({
    req,
    res,
    targetState: 'REJECTED',
    action: 'GLOBAL_REJECT',
    reason: reason.trim(),
    auditAction: 'PIPELINE_GLOBAL_REJECT',
    webhookEvent: 'candidate.rejected'
  });
};

/**
 * @desc    Mark candidate as client portal duplicate
 * @route   POST /api/v1/candidates/:id/client-portal-duplicate
 * @scope   candidates:write, statuses:write
 */
exports.clientPortalDuplicate = async (req, res) => {
  const customReason = req.body?.reason || req.body?.notes;
  const finalReason = customReason && typeof customReason === 'string' && customReason.trim()
    ? customReason.trim()
    : 'Duplicate entry in Client Portal';

  return _performDeveloperCandidateOverride({
    req,
    res,
    targetState: 'CLIENT_PORTAL_DUPLICATE',
    action: 'CLIENT_PORTAL_DUPLICATE',
    reason: finalReason,
    auditAction: 'PIPELINE_CLIENT_PORTAL_DUPLICATE',
    webhookEvent: 'candidate.duplicate'
  });
};

/**
 * @desc    Mark candidate as dropped (ghosted, declined, etc.)
 * @route   POST /api/v1/candidates/:id/candidate-drop
 * @scope   candidates:write, statuses:write
 */
exports.candidateDrop = async (req, res) => {
  const customReason = req.body?.reason || req.body?.notes;
  const finalReason = customReason && typeof customReason === 'string' && customReason.trim()
    ? `Candidate Drop: ${customReason.trim()}`
    : 'Candidate Drop';

  return _performDeveloperCandidateOverride({
    req,
    res,
    targetState: 'CANDIDATE_DROP',
    action: 'CANDIDATE_DROP',
    reason: finalReason,
    auditAction: 'PIPELINE_CANDIDATE_DROP',
    webhookEvent: 'candidate.dropped'
  });
};

/**
 * @desc    Mark candidate as not joined after offer acceptance
 * @route   POST /api/v1/candidates/:id/mark-not-joined
 * @scope   candidates:write, statuses:write
 */
exports.markNotJoined = async (req, res) => {
  const reason = req.body?.reason || req.body?.notes;
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: 'REASON_REQUIRED', message: 'Reason is required for marking as not joined.' },
      request_id: req.requestId
    });
  }

  return _performDeveloperCandidateOverride({
    req,
    res,
    targetState: 'NOT_JOINED',
    action: 'MARK_NOT_JOINED',
    reason: reason.trim(),
    auditAction: 'PIPELINE_MARK_NOT_JOINED',
    webhookEvent: 'candidate.not_joined'
  });
};

/**
 * @desc    Mark candidate as joined after offer acceptance / onboarding
 * @route   POST /api/v1/candidates/:id/mark-joined
 * @scope   candidates:write, statuses:write
 */
exports.markJoined = async (req, res) => {
  const companyId = req.developer.company_id;
  const { actual_joining_date, joining_date, notes } = req.body || {};
  try {
    const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
        request_id: req.requestId
      });
    }

    const fromState = candidate.status;
    const allowedFrom = ['OFFER_ACCEPTED', 'ONBOARDING', 'OFFERED', 'OFFER_SENT'];
    if (!allowedFrom.includes(fromState)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot mark as Joined from status "${fromState}". Candidate must be in OFFER_ACCEPTED or ONBOARDING status.`
        },
        request_id: req.requestId
      });
    }

    const company = await Company.findById(companyId);
    const userId = company?.user || req.developer.client_id;
    const jDate = actual_joining_date || joining_date;
    const parsedDate = jDate ? new Date(jDate) : new Date();

    const updatedCandidate = await candidateLifecycleService.updateStatus(
      candidate._id,
      'JOINED',
      userId,
      'company',
      notes || `Candidate joined on ${parsedDate.toDateString()} (via Developer API)`
    );

    updatedCandidate.joining = {
      actualJoiningDate: parsedDate,
      confirmed: true,
      confirmedAt: new Date(),
      documentsSubmitted: true
    };
    await updatedCandidate.save();

    webhookService.emitEvent(companyId, 'candidate.joined', {
      candidate_id: candidate.uniqueId,
      external_candidate_id: candidate.external_candidate_id,
      job_id: candidate.job?.uniqueId,
      previous_status: fromState,
      new_status: 'JOINED',
      joining_date: parsedDate
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Candidate marked as Joined. Commission and placement processing initiated.',
      data: integrationService.mapInternalCandidateToApi(updatedCandidate),
      request_id: req.requestId
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        error: { code: 'INVALID_STATUS_TRANSITION', message: error.message },
        request_id: req.requestId
      });
    }
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Confirm onboarding for candidate (moves from OFFER_ACCEPTED to ONBOARDING)
 * @route   POST /api/v1/candidates/:id/onboarding/confirm
 * @scope   candidates:write, statuses:write
 */
exports.confirmOnboarding = async (req, res) => {
  const companyId = req.developer.company_id;
  const { notes } = req.body || {};
  try {
    const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
        request_id: req.requestId
      });
    }

    if (candidate.status !== 'OFFER_ACCEPTED') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Cannot confirm onboarding from status "${candidate.status}". Candidate must be in OFFER_ACCEPTED status.`
        },
        request_id: req.requestId
      });
    }

    candidate.status = 'ONBOARDING';
    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'ONBOARDING',
      changedAt: new Date(),
      notes: notes || 'Onboarding initiated via Developer API'
    });

    candidate.auditTrail = candidate.auditTrail || [];
    candidate.auditTrail.push({
      actorRole: 'company',
      action: 'CONFIRM_ONBOARDING',
      fromState: 'OFFER_ACCEPTED',
      toState: 'ONBOARDING',
      reason: notes || 'Onboarding initiated via Developer API',
      timestamp: new Date()
    });

    await candidate.save();

    // Notify partner
    if (candidate.submittedBy) {
      StaffingPartner.findById(candidate.submittedBy).select('user').then(partner => {
        if (partner?.user) {
          notificationEngine.send({
            recipientId: partner.user,
            type: 'ONBOARDING_STARTED',
            title: '🚀 Onboarding Started!',
            message: `${candidate.firstName} ${candidate.lastName} has moved to the Onboarding phase. Please coordinate document verification.`,
            data: { entityType: 'Candidate', entityId: candidate._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          }).catch(e => console.error('[NOTIFY] Partner onboarding notify failed:', e.message));
        }
      }).catch(e => console.error('[NOTIFY] Partner lookup error:', e.message));
    }

    webhookService.emitEvent(companyId, 'candidate.onboarding_started', {
      candidate_id: candidate.uniqueId,
      status: 'ONBOARDING'
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Onboarding confirmed successfully.',
      data: {
        candidate_id: candidate.uniqueId,
        status: candidate.status
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
   3. INTERVIEWS & PIPELINE SCHEDULING API
========================================================================= */

/**
 * @desc    Create interview slots for a job
 * @route   POST /api/v1/jobs/:id/interview-slots
 * @scope   interviews:write
 */
exports.createJobInterviewSlots = async (req, res) => {
  const companyId = req.developer.company_id;
  const { slots, round_type } = req.body;

  if (!slots || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'Please provide at least one interview slot in "slots" array' },
      request_id: req.requestId
    });
  }

  try {
    const job = await findJobByFlexibleId(companyId, req.params.id);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Job not found' },
        request_id: req.requestId
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingSlots = await InterviewSlot.find({
      job: job._id,
      status: { $ne: 'CANCELLED' }
    });

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const invalidSlots = [];

    slots.forEach((slot, index) => {
      const errors = [];
      if (!slot.date) errors.push('date is required (YYYY-MM-DD)');
      if (!slot.start_time && !slot.startTime) errors.push('start_time is required');
      if (!slot.end_time && !slot.endTime) errors.push('end_time is required');

      const sTime = slot.start_time || slot.startTime;
      const eTime = slot.end_time || slot.endTime;

      if (slot.date && sTime && eTime) {
        const slotDate = new Date(slot.date);
        slotDate.setHours(0, 0, 0, 0);
        const startMin = timeToMinutes(sTime);
        const endMin = timeToMinutes(eTime);

        if (startMin >= endMin) {
          errors.push('start_time must be before end_time');
        }
        if (slotDate < today) {
          errors.push(`Date ${slot.date} is in the past`);
        } else if (slotDate.getTime() === today.getTime() && startMin < currentMinutes + 15) {
          errors.push(`start_time ${sTime} must be at least 15 minutes in the future`);
        }

        // Check for internal collision in payload
        const internalOverlap = slots.find((other, oIdx) => {
          if (oIdx === index || other.date !== slot.date) return false;
          const oStart = timeToMinutes(other.start_time || other.startTime);
          const oEnd = timeToMinutes(other.end_time || other.endTime);
          return startMin < oEnd && endMin > oStart;
        });
        if (internalOverlap) {
          errors.push('Slot overlaps with another slot in this request');
        }

        // Check for DB collision
        const dbOverlap = existingSlots.find(existing => {
          const eDate = new Date(existing.date);
          eDate.setHours(0, 0, 0, 0);
          if (eDate.getTime() !== slotDate.getTime()) return false;
          const eStart = timeToMinutes(existing.startTime);
          const eEnd = timeToMinutes(existing.endTime);
          return startMin < eEnd && endMin > eStart;
        });
        if (dbOverlap) {
          errors.push(`Slot overlaps with an existing slot on ${slot.date} (${dbOverlap.startTime} - ${dbOverlap.endTime})`);
        }
      }

      if (errors.length > 0) {
        invalidSlots.push({ index, slot, errors });
      }
    });

    if (invalidSlots.length > 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SLOTS', message: 'One or more slots failed validation', invalidSlots },
        request_id: req.requestId
      });
    }

    // Explode multi-candidate slots into individual slot documents
    const explodedSlots = [];
    slots.forEach(slot => {
      const capacity = Number(slot.max_candidates || slot.maxCandidates || 1);
      const avg = Number(slot.average_time || slot.averageTime || 30);
      const sTime = slot.start_time || slot.startTime;
      const eTime = slot.end_time || slot.endTime;
      let currentStartTime = sTime;

      for (let i = 0; i < capacity; i++) {
        const currentEndTime = addMinutesTo12h(currentStartTime, avg);
        explodedSlots.push({
          job: job._id,
          company: companyId,
          date: new Date(slot.date),
          startTime: currentStartTime,
          endTime: currentEndTime,
          maxCandidates: 1,
          availableSpots: 1,
          averageTime: avg,
          interviewMode: (slot.interview_mode || slot.interviewMode) === 'Face-to-Face' ? 'Face-to-Face' : 'Virtual',
          interviewDetails: slot.interview_details || slot.interviewDetails || '',
          interviewerName: slot.interviewer_name || slot.interviewerName || '',
          notes: slot.notes || null,
          status: 'ACTIVE',
          roundType: round_type || slot.round_type || slot.roundType || null,
          source_system: 'API'
        });
        currentStartTime = currentEndTime;
      }
    });

    const createdSlots = await InterviewSlot.insertMany(explodedSlots);

    webhookService.emitEvent(companyId, 'interview.slots_created', {
      job_id: job.uniqueId,
      total_created: createdSlots.length,
      round_type: round_type || null
    }, { entity_type: 'JOB', entity_id: job._id });

    return res.status(201).json({
      success: true,
      message: `${createdSlots.length} interview slot(s) created successfully`,
      data: createdSlots.map(integrationService.mapInternalInterviewToApi),
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
 * @desc    Get interview slots for a job
 * @route   GET /api/v1/jobs/:id/interview-slots
 * @scope   interviews:read
 */
exports.getJobInterviewSlots = async (req, res) => {
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

    const slots = await InterviewSlot.find({
      job: job._id,
      company: companyId,
      status: { $ne: 'CANCELLED' }
    })
      .populate('job', 'title uniqueId')
      .populate('bookedCandidates.candidate', 'firstName lastName uniqueId email mobile')
      .sort({ date: 1, startTime: 1 });

    return res.status(200).json({
      success: true,
      data: slots.map(integrationService.mapInternalInterviewToApi),
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
 * @desc    Schedule interview for candidate with WhatsApp Consent
 * @route   POST /api/v1/candidates/:id/schedule-interview
 * @scope   interviews:write
 */
exports.scheduleInterview = async (req, res) => {
  const companyId = req.developer.company_id;
  const {
    date,
    start_time,
    end_time,
    interview_mode,
    meeting_link,
    interview_details,
    interviewer_name,
    interviewer_email,
    round_type,
    notes,
    slot_id
  } = req.body;

  if (!date || !start_time) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'date and start_time are required' },
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

    const company = await Company.findById(companyId);
    const job = await Job.findById(candidate.job?._id || candidate.job);

    const mode = interview_mode === 'Face-to-Face' ? 'Face-to-Face' : 'Virtual';
    const details = meeting_link || interview_details || (mode === 'Virtual' ? 'Online Video Call' : 'Office Location');
    const interviewer = interviewer_name || 'Hiring Team';
    const computedEndTime = end_time || addMinutesTo12h(start_time, 30);

    let assignedSlotId = slot_id;

    // If slot_id is provided, verify and book it
    if (assignedSlotId) {
      const existingSlot = await InterviewSlot.findOne({ _id: assignedSlotId, company: companyId });
      if (!existingSlot) {
        return res.status(404).json({
          success: false,
          error: { code: 'RESOURCE_NOT_FOUND', message: 'Specified interview slot not found' },
          request_id: req.requestId
        });
      }
      existingSlot.bookedCandidates = existingSlot.bookedCandidates || [];
      existingSlot.bookedCandidates.push({
        candidate: candidate._id,
        bookedAt: new Date(),
        bookingStatus: 'BOOKED'
      });
      existingSlot.availableSpots = Math.max(0, (existingSlot.availableSpots || 1) - 1);
      if (existingSlot.availableSpots === 0) existingSlot.status = 'FULL';
      await existingSlot.save();
    } else {
      // Create new slot for this interview booking
      const newSlot = await InterviewSlot.create({
        job: job?._id || candidate.job,
        company: companyId,
        date: new Date(date),
        startTime: start_time,
        endTime: computedEndTime,
        maxCandidates: 1,
        availableSpots: 0,
        interviewMode: mode,
        interviewDetails: details,
        interviewerName: interviewer,
        notes: notes || null,
        status: 'FULL',
        roundType: round_type || null,
        source_system: 'API',
        bookedCandidates: [{
          candidate: candidate._id,
          bookedAt: new Date(),
          bookingStatus: 'BOOKED'
        }]
      });
      assignedSlotId = newSlot._id;
    }

    // Generate unique confirmation token for WhatsApp Agree/Disagree buttons
    const confirmationToken = crypto.randomBytes(32).toString('hex');

    // Update candidate interviewConfig
    candidate.assignedSlot = assignedSlotId;
    candidate.interviewConfig = {
      mode,
      details,
      interviewer,
      isConfirmedByCompany: true,
      confirmedAt: new Date(),
      confirmationToken,
      candidateResponse: 'PENDING'
    };

    // Update active round in candidate.rounds if present
    if (Array.isArray(candidate.rounds) && candidate.rounds.length > 0) {
      let targetRound = candidate.rounds.find(r => 
        round_type ? r.roundType === round_type : !['ROUND_REJECTED', 'ROUND_SELECTED_NEXT'].includes(r.status)
      );
      if (!targetRound) targetRound = candidate.rounds[0];

      if (targetRound) {
        targetRound.status = 'SLOT_DETAILS_SHARED';
        targetRound.slots = targetRound.slots || [];
        targetRound.slots.push({
          date: new Date(date),
          startTime: start_time,
          endTime: computedEndTime,
          mode: mode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL',
          interviewerName: interviewer,
          details: {
            meetingLink: mode === 'Virtual' ? details : '',
            address: mode !== 'Virtual' ? details : '',
            pointOfContact: { name: interviewer, email: interviewer_email || '' }
          }
        });
      }
    }

    // Push into candidate.interviews history
    candidate.interviews = candidate.interviews || [];
    candidate.interviews.push({
      round: candidate.interviews.length + 1,
      slot: assignedSlotId,
      type: mode === 'Face-to-Face' ? 'Face-to-Face' : 'Technical',
      scheduledAt: new Date(date),
      interviewerName: interviewer,
      interviewerEmail: interviewer_email || null,
      meetingLink: mode === 'Virtual' ? details : null,
      result: 'PENDING'
    });

    // Update candidate status to SLOT_DETAILS_SHARED
    candidate.status = 'SLOT_DETAILS_SHARED';
    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'SLOT_DETAILS_SHARED',
      changedAt: new Date(),
      notes: `Interview scheduled (${mode}) with ${interviewer} on ${date} @ ${start_time}`
    });

    candidate.auditTrail = candidate.auditTrail || [];
    candidate.auditTrail.push({
      actorRole: 'company',
      action: 'SHARE_DETAILS',
      fromState: candidate.status,
      toState: 'SLOT_DETAILS_SHARED',
      reason: notes || `Interview invitation dispatched via WhatsApp`,
      timestamp: new Date()
    });

    await candidate.save();

    // ── Dispatch WhatsApp Interview Invitation with Consent Buttons ───────
    const formattedDate = new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    whatsappService.sendInterviewInvitation(
      candidate.mobile,
      candidate.firstName,
      company?.companyName || 'Employer',
      formattedDate,
      start_time,
      job?.title || 'Position',
      mode === 'Virtual' ? 'Online' : 'Offline',
      details,
      interviewer,
      confirmationToken
    ).catch(err => console.error('[WHATSAPP API] sendInterviewInvitation failed:', err.message));

    // ── Notify Partner (Non-blocking) ─────────────────────────────────────
    if (candidate.submittedBy) {
      StaffingPartner.findById(candidate.submittedBy).select('user').then(partner => {
        if (partner?.user) {
          notificationEngine.send({
            recipientId: partner.user,
            type: 'CANDIDATE_INTERVIEW_SCHEDULED',
            title: '📅 Interview Scheduled',
            message: `An interview has been scheduled for ${candidate.firstName} ${candidate.lastName} on ${formattedDate} at ${start_time}.`,
            data: { candidateId: candidate._id, jobId: job?._id },
            channels: { inApp: true, email: true },
            priority: 'high'
          }).catch(err => console.error('[NOTIFY API] Partner interview notification failed:', err.message));
        }
      }).catch(err => console.error('[NOTIFY API] Partner lookup failed:', err.message));
    }

    // ── Emit webhook ──────────────────────────────────────────────────────
    webhookService.emitEvent(companyId, 'interview.scheduled', {
      candidate_id: candidate.uniqueId,
      external_candidate_id: candidate.external_candidate_id,
      job_id: job?.uniqueId,
      slot_id: String(assignedSlotId),
      date,
      start_time,
      end_time: computedEndTime,
      interview_mode: mode,
      interviewer_name: interviewer,
      status: 'SLOT_DETAILS_SHARED'
    }, { entity_type: 'INTERVIEW', entity_id: assignedSlotId });

    return res.status(200).json({
      success: true,
      message: 'Interview scheduled successfully. WhatsApp invitation dispatched to candidate.',
      data: {
        candidate_id: candidate.uniqueId,
        status: candidate.status,
        interview: {
          slot_id: String(assignedSlotId),
          date,
          start_time,
          end_time: computedEndTime,
          mode,
          details,
          interviewer,
          confirmation_status: candidate.interviewConfig.candidateResponse
        }
      },
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API scheduleInterview Error]:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/**
 * @desc    Resend WhatsApp interview invitation consent
 * @route   POST /api/v1/candidates/:id/resend-interview-consent
 * @scope   interviews:write
 */
exports.resendInterviewConsent = async (req, res) => {
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

    if (!candidate.interviewConfig?.confirmationToken) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_ACTIVE_INTERVIEW', message: 'No interview details or confirmation token found for this candidate' },
        request_id: req.requestId
      });
    }

    const company = await Company.findById(companyId);
    const job = await Job.findById(candidate.job?._id || candidate.job);
    const slot = candidate.assignedSlot ? await InterviewSlot.findById(candidate.assignedSlot) : null;

    const interviewDate = slot ? new Date(slot.date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }) : 'Scheduled Date';

    const startTime = slot?.startTime || 'Scheduled Time';
    const cfg = candidate.interviewConfig;

    await whatsappService.sendInterviewInvitation(
      candidate.mobile,
      candidate.firstName,
      company?.companyName || 'Employer',
      interviewDate,
      startTime,
      job?.title || 'Position',
      cfg.mode === 'Virtual' ? 'Online' : 'Offline',
      cfg.details || '',
      cfg.interviewer || 'Hiring Team',
      cfg.confirmationToken
    );

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: candidate.status,
      changedAt: new Date(),
      notes: 'Interview WhatsApp invitation resent via Developer API'
    });
    await candidate.save();

    return res.status(200).json({
      success: true,
      message: 'Interview invitation resent successfully via WhatsApp',
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
 * @desc    Request interview reschedule
 * @route   POST /api/v1/candidates/:id/reschedule-interview
 * @scope   interviews:write
 */
exports.requestInterviewReschedule = async (req, res) => {
  const companyId = req.developer.company_id;
  const { reason, requested_by } = req.body;

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FIELD', message: 'A reason of at least 5 characters is required for reschedule' },
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

    const previousStatus = candidate.status;
    candidate.status = 'RESCHEDULE_REQUESTED';

    if (Array.isArray(candidate.rounds) && candidate.rounds.length > 0) {
      const active = candidate.rounds.find(r => r.status === 'SLOT_DETAILS_SHARED') || candidate.rounds[0];
      if (active) {
        active.status = 'RESCHEDULE_REQUESTED';
        active.rescheduleCount = active.rescheduleCount || {};
        if (requested_by === 'CANDIDATE') {
          active.rescheduleCount.candidateInitiated = (active.rescheduleCount.candidateInitiated || 0) + 1;
        } else {
          active.rescheduleCount.clientInitiated = (active.rescheduleCount.clientInitiated || 0) + 1;
        }
      }
    }

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'RESCHEDULE_REQUESTED',
      changedAt: new Date(),
      notes: `Reschedule requested: ${reason}`
    });

    await candidate.save();

    webhookService.emitEvent(companyId, 'interview.reschedule_requested', {
      candidate_id: candidate.uniqueId,
      external_candidate_id: candidate.external_candidate_id,
      previous_status: previousStatus,
      reason
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Interview reschedule request recorded',
      data: { candidate_id: candidate.uniqueId, status: candidate.status },
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
 * @desc    Confirm interview reschedule with new date & time
 * @route   POST /api/v1/candidates/:id/confirm-reschedule
 * @scope   interviews:write
 */
exports.confirmInterviewReschedule = async (req, res) => {
  const companyId = req.developer.company_id;
  const { date, start_time, end_time, interview_mode, meeting_link, interviewer_name } = req.body;

  if (!date || !start_time) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'date and start_time are required to confirm reschedule' },
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

    const company = await Company.findById(companyId);
    const job = await Job.findById(candidate.job?._id || candidate.job);

    const mode = interview_mode === 'Face-to-Face' ? 'Face-to-Face' : 'Virtual';
    const details = meeting_link || candidate.interviewConfig?.details || 'Online Meeting';
    const interviewer = interviewer_name || candidate.interviewConfig?.interviewer || 'Hiring Team';
    const computedEndTime = end_time || addMinutesTo12h(start_time, 30);
    const confirmationToken = crypto.randomBytes(32).toString('hex');

    // Create a new slot for the rescheduled interview
    const slot = await InterviewSlot.create({
      job: job?._id || candidate.job,
      company: companyId,
      date: new Date(date),
      startTime: start_time,
      endTime: computedEndTime,
      maxCandidates: 1,
      availableSpots: 0,
      interviewMode: mode,
      interviewDetails: details,
      interviewerName: interviewer,
      status: 'FULL',
      source_system: 'API',
      bookedCandidates: [{
        candidate: candidate._id,
        bookedAt: new Date(),
        bookingStatus: 'BOOKED'
      }]
    });

    candidate.assignedSlot = slot._id;
    candidate.interviewConfig = {
      mode,
      details,
      interviewer,
      isConfirmedByCompany: true,
      confirmedAt: new Date(),
      confirmationToken,
      candidateResponse: 'PENDING'
    };

    candidate.status = 'SLOT_DETAILS_SHARED';
    if (Array.isArray(candidate.rounds)) {
      const active = candidate.rounds.find(r => r.status === 'RESCHEDULE_REQUESTED') || candidate.rounds[0];
      if (active) active.status = 'SLOT_DETAILS_SHARED';
    }

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'SLOT_DETAILS_SHARED',
      changedAt: new Date(),
      notes: `Reschedule confirmed for ${date} @ ${start_time}`
    });

    await candidate.save();

    // Resend WhatsApp invitation with new time
    const formattedDate = new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });

    whatsappService.sendInterviewInvitation(
      candidate.mobile,
      candidate.firstName,
      company?.companyName || 'Employer',
      formattedDate,
      start_time,
      job?.title || 'Position',
      mode === 'Virtual' ? 'Online' : 'Offline',
      details,
      interviewer,
      confirmationToken
    ).catch(err => console.error('[WHATSAPP API] Reschedule invitation failed:', err.message));

    webhookService.emitEvent(companyId, 'interview.rescheduled', {
      candidate_id: candidate.uniqueId,
      job_id: job?.uniqueId,
      date,
      start_time,
      end_time: computedEndTime,
      status: 'SLOT_DETAILS_SHARED'
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Interview reschedule confirmed. WhatsApp invitation sent to candidate.',
      data: {
        candidate_id: candidate.uniqueId,
        status: candidate.status,
        date,
        start_time,
        end_time: computedEndTime
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
 * @desc    Decline/reject a pending interview reschedule request
 * @route   POST /api/v1/candidates/:id/reject-reschedule
 * @scope   interviews:write
 */
exports.rejectInterviewReschedule = async (req, res) => {
  const companyId = req.developer.company_id;
  const { reason } = req.body || {};
  try {
    const candidate = await findCandidateByFlexibleId(companyId, req.params.id);
    if (!candidate) {
      return res.status(404).json({
        success: false,
        error: { code: 'RESOURCE_NOT_FOUND', message: 'Candidate not found' },
        request_id: req.requestId
      });
    }

    let activeRound = null;
    if (Array.isArray(candidate.rounds)) {
      activeRound = candidate.rounds.find(r => r.rescheduleRequest?.status === 'PENDING') ||
                    candidate.rounds.find(r => !r.outcome?.decision);
    }

    if (!activeRound || activeRound.rescheduleRequest?.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_PENDING_RESCHEDULE', message: 'No pending reschedule request found for this candidate.' },
        request_id: req.requestId
      });
    }

    const rejectionReason = reason || 'Reschedule declined by employer via Developer API';
    activeRound.rescheduleRequest.status = 'REJECTED';
    activeRound.rescheduleRequest.actionedAt = new Date();
    activeRound.rescheduleRequest.actionedBy = req.developer.client_id;
    activeRound.rescheduleRequest.rejectionReason = rejectionReason;

    const revertedStatus = 'SLOT_DETAILS_SHARED';
    activeRound.status = revertedStatus;
    candidate.status = revertedStatus;

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: revertedStatus,
      changedAt: new Date(),
      notes: `Reschedule request rejected. Reason: ${rejectionReason}`
    });

    candidate.auditTrail = candidate.auditTrail || [];
    candidate.auditTrail.push({
      actorRole: 'company',
      action: 'REJECT_RESCHEDULE',
      fromState: 'RESCHEDULE_REQUESTED',
      toState: revertedStatus,
      reason: rejectionReason,
      timestamp: new Date()
    });

    await candidate.save();

    webhookService.emitEvent(companyId, 'interview.reschedule_rejected', {
      candidate_id: candidate.uniqueId,
      status: candidate.status,
      reason: rejectionReason
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Reschedule request rejected. Interview schedule retained.',
      data: {
        candidate_id: candidate.uniqueId,
        status: candidate.status,
        reschedule_status: 'REJECTED'
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
 * @desc    Submit interview result & advance pipeline round
 * @route   POST /api/v1/candidates/:id/interviews/result
 * @scope   interviews:write
 */
exports.submitInterviewResult = async (req, res) => {
  const companyId = req.developer.company_id;
  const { decision, feedback, rating, reason, round_number } = req.body;

  const validDecisions = [
    'SELECT_NEXT_ROUND',
    'REJECT_ROUND',
    'SELECT_DIRECT_HR',
    'HOLD_ROUND',
    'RESOLVE_HOLD',
    'MARK_CONDUCTED',
    'MARK_NOT_CONDUCTED',
    'HR_SELECT',
    'HR_REJECT',
    'HR_HOLD',
    'HR_RESOLVE_HOLD'
  ];
  if (!decision || !validDecisions.includes(decision)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_DECISION', message: `decision must be one of: ${validDecisions.join(', ')}` },
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

    const previousStatus = candidate.status;
    let nextStatus = previousStatus;

    // Update interview record
    if (Array.isArray(candidate.interviews) && candidate.interviews.length > 0) {
      const idx = round_number ? (parseInt(round_number) - 1) : (candidate.interviews.length - 1);
      if (candidate.interviews[idx]) {
        candidate.interviews[idx].feedback = feedback || candidate.interviews[idx].feedback;
        candidate.interviews[idx].rating = rating || candidate.interviews[idx].rating;
        candidate.interviews[idx].result = ['REJECT_ROUND', 'HR_REJECT'].includes(decision) ? 'FAILED' : 'PASSED';
      }
    }

    const activeRound = Array.isArray(candidate.rounds)
      ? candidate.rounds.find(r => ['SLOT_DETAILS_SHARED', 'INTERVIEW_CONDUCTED', 'ROUND_ON_HOLD'].includes(r.status)) ||
        candidate.rounds.find(r => !r.outcome?.decision)
      : null;

    if (decision === 'SELECT_NEXT_ROUND') {
      nextStatus = 'ROUND_SELECTED_NEXT';
      if (Array.isArray(candidate.rounds) && candidate.rounds.length > 0) {
        const activeIdx = candidate.rounds.findIndex(r => r.status === 'SLOT_DETAILS_SHARED' || r.status === 'INTERVIEW_CONDUCTED');
        if (activeIdx !== -1) {
          candidate.rounds[activeIdx].status = 'ROUND_SELECTED_NEXT';
          candidate.rounds[activeIdx].outcome = {
            decision: 'SELECTED_NEXT_ROUND',
            reason: reason || 'Cleared round',
            decidedAt: new Date()
          };
          if (candidate.rounds[activeIdx + 1]) {
            const nextRound = candidate.rounds[activeIdx + 1];
            nextRound.status = getInitialRoundState(nextRound.roundType);
            nextStatus = nextRound.status;
          } else {
            nextStatus = 'HR_ROUND_PENDING';
          }
        }
      }
      webhookService.emitEvent(companyId, 'candidate.round_passed', {
        candidate_id: candidate.uniqueId,
        decision,
        next_status: nextStatus
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'REJECT_ROUND') {
      nextStatus = 'ROUND_REJECTED';
      if (activeRound) {
        activeRound.status = 'ROUND_REJECTED';
        activeRound.outcome = { decision: 'REJECTED', reason: reason || feedback || 'Not selected', decidedAt: new Date() };
      }
      webhookService.emitEvent(companyId, 'candidate.round_rejected', {
        candidate_id: candidate.uniqueId,
        decision,
        reason: reason || feedback || null
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'SELECT_DIRECT_HR') {
      nextStatus = 'ROUND_SELECTED_DIRECT_HR';
      if (activeRound) {
        activeRound.status = 'ROUND_SELECTED_DIRECT_HR';
        activeRound.outcome = { decision: 'SELECTED_DIRECT_HR', reason: reason || 'Selected directly for HR round', decidedAt: new Date() };
      }
      webhookService.emitEvent(companyId, 'candidate.advanced_to_hr', {
        candidate_id: candidate.uniqueId,
        decision
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'HOLD_ROUND') {
      nextStatus = 'ROUND_ON_HOLD';
      if (activeRound) {
        activeRound.status = 'ROUND_ON_HOLD';
      }
      webhookService.emitEvent(companyId, 'candidate.on_hold', {
        candidate_id: candidate.uniqueId,
        decision,
        reason: reason || null
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'RESOLVE_HOLD') {
      nextStatus = 'SLOT_DETAILS_SHARED';
      if (activeRound) {
        activeRound.status = 'SLOT_DETAILS_SHARED';
      }
      webhookService.emitEvent(companyId, 'candidate.hold_resolved', {
        candidate_id: candidate.uniqueId,
        decision
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'MARK_CONDUCTED') {
      nextStatus = 'INTERVIEW_CONDUCTED';
      if (activeRound) {
        activeRound.status = 'INTERVIEW_CONDUCTED';
      }
      webhookService.emitEvent(companyId, 'interview.conducted', {
        candidate_id: candidate.uniqueId,
        feedback: feedback || null
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'MARK_NOT_CONDUCTED') {
      nextStatus = 'SLOT_DETAILS_SHARED';
      if (activeRound) {
        activeRound.status = 'SLOT_DETAILS_SHARED';
      }
      webhookService.emitEvent(companyId, 'interview.not_conducted', {
        candidate_id: candidate.uniqueId,
        reason: reason || 'Interview not conducted'
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'HR_SELECT') {
      nextStatus = 'HR_SELECTED';
      candidate.hrRound = candidate.hrRound || {};
      candidate.hrRound.status = 'HR_SELECTED';
      candidate.hrRound.decidedAt = new Date();
      webhookService.emitEvent(companyId, 'candidate.hr_passed', {
        candidate_id: candidate.uniqueId,
        next_status: 'HR_SELECTED'
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'HR_REJECT') {
      nextStatus = 'REJECTED';
      candidate.hrRound = candidate.hrRound || {};
      candidate.hrRound.status = 'HR_REJECTED';
      candidate.hrRound.reason = reason || feedback || 'Rejected in HR round';
      candidate.hrRound.decidedAt = new Date();
      webhookService.emitEvent(companyId, 'candidate.hr_rejected', {
        candidate_id: candidate.uniqueId,
        reason: reason || feedback || null
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'HR_HOLD') {
      nextStatus = 'HR_ON_HOLD';
      candidate.hrRound = candidate.hrRound || {};
      candidate.hrRound.status = 'HR_ON_HOLD';
      webhookService.emitEvent(companyId, 'candidate.on_hold', {
        candidate_id: candidate.uniqueId,
        stage: 'HR_ROUND'
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    } else if (decision === 'HR_RESOLVE_HOLD') {
      nextStatus = 'HR_ROUND_PENDING';
      candidate.hrRound = candidate.hrRound || {};
      candidate.hrRound.status = 'HR_ROUND_PENDING';
      webhookService.emitEvent(companyId, 'candidate.hold_resolved', {
        candidate_id: candidate.uniqueId,
        stage: 'HR_ROUND'
      }, { entity_type: 'CANDIDATE', entity_id: candidate._id });
    }

    candidate.status = nextStatus;
    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: nextStatus,
      changedAt: new Date(),
      notes: `Interview result: ${decision}.${feedback ? ` Feedback: ${feedback}` : ''}`
    });

    candidate.auditTrail = candidate.auditTrail || [];
    candidate.auditTrail.push({
      actorRole: 'company',
      action: decision,
      fromState: previousStatus,
      toState: nextStatus,
      reason: reason || feedback || `Action: ${decision}`,
      timestamp: new Date()
    });

    await candidate.save();

    return res.status(200).json({
      success: true,
      message: `Interview result recorded. Status transitioned to ${nextStatus}.`,
      data: {
        candidate_id: candidate.uniqueId,
        status: candidate.status,
        decision,
        feedback: feedback || null
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
   4. ASSESSMENT PIPELINE API
========================================================================= */

/**
 * @desc    Send assessment link to candidate
 * @route   POST /api/v1/candidates/:id/assessment/send
 * @scope   candidates:write
 */
exports.sendAssessmentLink = async (req, res) => {
  const companyId = req.developer.company_id;
  const { assessment_link, instructions } = req.body;

  if (!assessment_link) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'assessment_link is required' },
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

    const previousStatus = candidate.status;
    candidate.status = 'ASSESSMENT_LINK_SENT';

    if (Array.isArray(candidate.rounds)) {
      const r = candidate.rounds.find(round => round.roundType === 'ASSESSMENT') || candidate.rounds[0];
      if (r) r.status = 'ASSESSMENT_LINK_SENT';
    }

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'ASSESSMENT_LINK_SENT',
      changedAt: new Date(),
      notes: `Assessment link sent: ${assessment_link}`
    });

    await candidate.save();

    webhookService.emitEvent(companyId, 'assessment.link_sent', {
      candidate_id: candidate.uniqueId,
      assessment_link,
      instructions: instructions || null
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Assessment link recorded and status transitioned to ASSESSMENT_LINK_SENT',
      data: { candidate_id: candidate.uniqueId, status: candidate.status },
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
 * @desc    Mark candidate assessment as complete
 * @route   POST /api/v1/candidates/:id/assessment/complete
 * @scope   candidates:write
 */
exports.completeAssessment = async (req, res) => {
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

    candidate.status = 'ASSESSMENT_LINK_COMPLETE';
    if (Array.isArray(candidate.rounds)) {
      const r = candidate.rounds.find(round => round.roundType === 'ASSESSMENT');
      if (r) r.status = 'ASSESSMENT_LINK_COMPLETE';
    }

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'ASSESSMENT_LINK_COMPLETE',
      changedAt: new Date(),
      notes: 'Assessment marked complete by ATS'
    });

    await candidate.save();

    webhookService.emitEvent(companyId, 'assessment.completed', {
      candidate_id: candidate.uniqueId
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Assessment marked complete',
      data: { candidate_id: candidate.uniqueId, status: candidate.status },
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
 * @desc    Submit assessment evaluation result (PASS / FAIL)
 * @route   POST /api/v1/candidates/:id/assessment/result
 * @scope   candidates:write
 */
exports.submitAssessmentResult = async (req, res) => {
  const companyId = req.developer.company_id;
  const { result, score, feedback, reason } = req.body;

  if (!result || !['PASS', 'FAIL'].includes(result.toUpperCase())) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_FIELD', message: 'result must be PASS or FAIL' },
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

    const isPass = result.toUpperCase() === 'PASS';
    const nextStatus = isPass ? 'ASSESSMENT_PASSED' : 'ASSESSMENT_FAILED';

    candidate.status = nextStatus;
    if (Array.isArray(candidate.rounds)) {
      const r = candidate.rounds.find(round => round.roundType === 'ASSESSMENT') || candidate.rounds[0];
      if (r) {
        r.status = nextStatus;
        r.outcome = {
          decision: isPass ? 'SELECTED_NEXT_ROUND' : 'REJECTED',
          reason: reason || feedback || (isPass ? 'Assessment passed' : 'Assessment failed'),
          decidedAt: new Date()
        };
      }
    }

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: nextStatus,
      changedAt: new Date(),
      notes: `Assessment ${result.toUpperCase()}${score ? ` (Score: ${score})` : ''}.${feedback ? ` ${feedback}` : ''}`
    });

    await candidate.save();

    webhookService.emitEvent(companyId, isPass ? 'assessment.passed' : 'assessment.failed', {
      candidate_id: candidate.uniqueId,
      result: result.toUpperCase(),
      score: score || null,
      feedback: feedback || null
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: `Assessment evaluated: ${result.toUpperCase()}`,
      data: { candidate_id: candidate.uniqueId, status: candidate.status },
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
   5. OFFER API
========================================================================= */

/**
 * @desc    Send candidate offer letter with WhatsApp consent
 * @route   POST /api/v1/candidates/:id/offer
 * @scope   candidates:write
 */
exports.sendOffer = async (req, res) => {
  const companyId = req.developer.company_id;
  const {
    salary,
    inhand_ctc,
    variable_ctc,
    joining_date,
    work_mode,
    work_location,
    office_address,
    offer_letter_url,
    notes
  } = req.body;

  if (!salary || isNaN(Number(salary)) || Number(salary) <= 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELD', message: 'salary (Annual CTC in INR) is required and must be greater than 0' },
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

    const company = await Company.findById(companyId);
    const job = await Job.findById(candidate.job?._id || candidate.job);

    const offerToken = crypto.randomBytes(32).toString('hex');
    const offerExpiresAt = new Date();
    offerExpiresAt.setDate(offerExpiresAt.getDate() + 7); // 7-day validity

    candidate.offer = {
      ...(candidate.offer || {}),
      salary: Number(salary),
      inhandCtc: inhand_ctc ? Number(inhand_ctc) : undefined,
      variableCtc: variable_ctc ? Number(variable_ctc) : undefined,
      joiningDate: joining_date ? new Date(joining_date) : undefined,
      expectedJoiningDate: joining_date ? new Date(joining_date) : undefined,
      workMode: work_mode || undefined,
      workLocation: work_location || undefined,
      officeAddress: office_address || undefined,
      offerLetterUrl: offer_letter_url || '',
      offeredAt: new Date(),
      response: 'PENDING',
      offerToken,
      isOfferSent: true,
      offerSentAt: new Date(),
      offerWhatsappSentAt: new Date(),
      offerExpiresAt
    };

    const previousStatus = candidate.status;
    candidate.status = 'OFFER_SENT';

    candidate.statusHistory = candidate.statusHistory || [];
    candidate.statusHistory.push({
      status: 'OFFER_SENT',
      changedAt: new Date(),
      notes: notes || `Offer sent. CTC: ₹${Number(salary).toLocaleString('en-IN')}`
    });

    candidate.auditTrail = candidate.auditTrail || [];
    candidate.auditTrail.push({
      actorRole: 'company',
      action: 'SEND_OFFER',
      fromState: previousStatus,
      toState: 'OFFER_SENT',
      reason: notes || `Offer extended: ₹${Number(salary).toLocaleString('en-IN')}`,
      timestamp: new Date()
    });

    await candidate.save();

    // ── Dispatch WhatsApp Offer Template with Accept/Reject Buttons ───────
    whatsappService.sendCandidateOffer(
      candidate.mobile,
      candidate.firstName,
      job?.title || 'Position',
      company?.companyName || 'Employer',
      `₹${Number(salary).toLocaleString('en-IN')}`,
      offerToken
    ).catch(err => console.error('[WHATSAPP API] sendCandidateOffer failed:', err.message));

    // ── Notify Partner (Priority Urgent) ──────────────────────────────────
    if (candidate.submittedBy) {
      StaffingPartner.findById(candidate.submittedBy).select('user').then(partner => {
        if (partner?.user) {
          notificationEngine.send({
            recipientId: partner.user,
            type: 'OFFER_SENT',
            title: '🎉 Offer Letter Sent!',
            message: `An offer has been extended to ${candidate.firstName} ${candidate.lastName} with CTC ₹${Number(salary).toLocaleString('en-IN')}/year.`,
            data: { candidateId: candidate._id, jobId: job?._id },
            channels: { inApp: true, email: true, whatsapp: true },
            priority: 'urgent'
          }).catch(err => console.error('[NOTIFY API] Offer partner notification failed:', err.message));
        }
      }).catch(err => console.error('[NOTIFY API] Offer partner lookup failed:', err.message));
    }

    webhookService.emitEvent(companyId, 'offer.sent', {
      candidate_id: candidate.uniqueId,
      external_candidate_id: candidate.external_candidate_id,
      job_id: job?.uniqueId,
      salary: Number(salary),
      joining_date: joining_date || null,
      status: 'OFFER_SENT'
    }, { entity_type: 'CANDIDATE', entity_id: candidate._id });

    return res.status(200).json({
      success: true,
      message: 'Offer dispatched successfully. Candidate received WhatsApp offer with Accept/Reject buttons.',
      data: {
        candidate_id: candidate.uniqueId,
        status: candidate.status,
        offer: {
          salary: Number(salary),
          inhand_ctc: inhand_ctc || null,
          variable_ctc: variable_ctc || null,
          joining_date: joining_date || null,
          work_mode: work_mode || null,
          offer_letter_url: offer_letter_url || null,
          expires_at: offerExpiresAt
        }
      },
      request_id: req.requestId
    });
  } catch (error) {
    console.error('[Developer API sendOffer Error]:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
      request_id: req.requestId
    });
  }
};

/* =========================================================================
   6. INTERVIEWS (CLASSIC LIST / GET / CANCEL)
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

    return res.status(200).json({
      success: true,
      data: slots.map(integrationService.mapInternalInterviewToApi),
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
      data: integrationService.mapInternalInterviewToApi(slot),
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
 * @desc    Create / schedule interview slot (Simple single slot)
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
      status: 'ACTIVE',
      source_system: 'API'
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
      data: integrationService.mapInternalInterviewToApi(slot),
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
        secret: w.secret_hash,
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
    // 1. Fetch integration and API jobs IDs
    const [integration, apiJobIds] = await Promise.all([
      Integration.findById(integrationId),
      Job.find({ company: companyId, source_system: 'API' }).distinct('_id')
    ]);

    // 2. Count strictly API-transacted records
    const [
      totalRequestsCount,
      jobsCount,
      candidatesCount,
      interviewsCount,
      webhookCount,
      failedLogsCount
    ] = await Promise.all([
      ApiLog.countDocuments({ company_id: companyId }),
      Job.countDocuments({ company: companyId, source_system: 'API' }),
      apiJobIds.length > 0
        ? Candidate.countDocuments({ company: companyId, job: { $in: apiJobIds } })
        : 0,
      InterviewSlot.countDocuments({
        company: companyId,
        $or: [
          { source_system: 'API' },
          ...(apiJobIds.length > 0 ? [{ job: { $in: apiJobIds } }] : [])
        ]
      }),
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
          total_requests: totalRequestsCount,
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
  if (req.query.client_id) {
    query.client_id = req.query.client_id;
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
