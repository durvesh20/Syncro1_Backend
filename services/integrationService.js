// backend/services/integrationService.js
const { v4: uuidv4 } = require('uuid');

/**
 * Maps incoming ATS external job payload to internal Job model attributes
 */
exports.mapExternalJobToInternal = (payload, companyId, postedByUserId, integrationId) => {
  // Normalize employment type
  const empTypeMap = {
    FULL_TIME: 'Full-time',
    'FULL-TIME': 'Full-time',
    'Full-time': 'Full-time',
    PART_TIME: 'Part-time',
    'PART-TIME': 'Part-time',
    'Part-time': 'Part-time',
    CONTRACT: 'Contract',
    Contract: 'Contract',
    INTERNSHIP: 'Internship',
    Internship: 'Internship',
    FREELANCE: 'Freelance',
    Freelance: 'Freelance'
  };

  const employmentType = empTypeMap[payload.employment_type] || empTypeMap[payload.employmentType] || 'Full-time';

  // Normalize location (Remember: location.city MUST be an Array of strings per Project Knowledge!)
  let cities = ['Remote'];
  if (payload.location) {
    if (Array.isArray(payload.location.city)) {
      cities = payload.location.city;
    } else if (typeof payload.location.city === 'string' && payload.location.city.trim()) {
      cities = [payload.location.city.trim()];
    } else if (typeof payload.location === 'string' && payload.location.trim()) {
      cities = [payload.location.trim()];
    }
  }

  // Experience range
  let expMin = 0;
  let expMax = 5;
  if (payload.experience) {
    expMin = Number(payload.experience.min) || 0;
    expMax = Number(payload.experience.max) || (expMin + 3);
  } else {
    expMin = Number(payload.experience_min) || 0;
    expMax = Number(payload.experience_max) || (expMin + 3);
  }

  // Determine experience level label
  let experienceLevel = payload.experience_level || payload.experienceLevel;
  if (!experienceLevel) {
    if (expMax <= 2) experienceLevel = 'Entry';
    else if (expMin >= 12) experienceLevel = 'Executive';
    else if (expMin >= 5 || expMax >= 8) experienceLevel = 'Senior';
    else experienceLevel = 'Mid';
  }

  // Compensation
  const comp = payload.compensation || payload.salary || {};

  // Unique slug and short ID
  const shortRandom = Math.floor(10000 + Math.random() * 90000);
  const titleSlug = (payload.title || 'job')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50);
  const slug = `${titleSlug}-${shortRandom}`;
  const uniqueId = `JOB-${shortRandom}`;

  return {
    company: companyId,
    postedBy: postedByUserId,
    title: payload.title,
    slug,
    uniqueId,
    description: payload.description || 'Job description provided via ATS integration.',
    category: payload.department || payload.category || 'Technology',
    subCategory: payload.subCategory || payload.sub_category || '',
    employmentType,
    experienceLevel,
    experienceRange: {
      min: expMin,
      max: expMax
    },
    salary: {
      min: comp.min != null ? comp.min : 0,
      max: comp.max != null ? comp.max : 0,
      currency: comp.currency || 'INR',
      isNegotiable: Boolean(comp.isNegotiable || comp.is_negotiable),
      isConfidential: Boolean(comp.isConfidential || comp.is_confidential)
    },
    location: {
      city: cities,
      state: payload.location?.state || 'N/A',
      country: payload.location?.country || 'India',
      isRemote: Boolean(payload.location?.isRemote ?? payload.location?.is_remote ?? false),
      isHybrid: Boolean(payload.location?.isHybrid ?? payload.location?.is_hybrid ?? false),
      isOnSite: Boolean(payload.location?.isOnSite ?? payload.location?.is_onsite ?? true)
    },
    requirements: Array.isArray(payload.skills)
      ? payload.skills
      : (Array.isArray(payload.requirements) ? payload.requirements : []),
    responsibilities: Array.isArray(payload.responsibilities) ? payload.responsibilities : [],
    openings: Number(payload.openings) || 1,
    external_job_id: payload.external_job_id || null,
    source_system: 'API',
    integration_id: integrationId || null,
    // By default API-created jobs start in DRAFT or PENDING_APPROVAL unless auto-publish is enabled
    status: 'DRAFT',
    approvalStatus: 'DRAFT'
  };
};

/**
 * Format internal Job document into v1 API format
 */
exports.mapInternalJobToApi = (job) => {
  return {
    job_id: job.uniqueId || String(job._id),
    internal_id: job._id,
    external_job_id: job.external_job_id || null,
    title: job.title,
    description: job.description,
    category: job.category,
    employment_type: job.employmentType,
    experience: {
      level: job.experienceLevel,
      min: job.experienceRange?.min ?? 0,
      max: job.experienceRange?.max ?? 0
    },
    compensation: {
      min: job.salary?.min,
      max: job.salary?.max,
      currency: job.salary?.currency || 'INR',
      is_negotiable: job.salary?.isNegotiable,
      is_confidential: job.salary?.isConfidential
    },
    location: {
      cities: Array.isArray(job.location?.city) ? job.location.city : [job.location?.city || 'N/A'],
      state: job.location?.state || 'N/A',
      country: job.location?.country || 'India',
      is_remote: job.location?.isRemote || false,
      is_hybrid: job.location?.isHybrid || false,
      is_onsite: job.location?.isOnSite || false
    },
    skills: job.requirements || [],
    responsibilities: job.responsibilities || [],
    status: job.status,
    metrics: {
      views: job.metrics?.views || 0,
      applications: job.metrics?.applications || 0,
      shortlisted: job.metrics?.shortlisted || 0,
      interviewed: job.metrics?.interviewed || 0,
      joined: job.metrics?.joined || 0
    },
    created_at: job.createdAt,
    updated_at: job.updatedAt
  };
};

/**
 * Format internal Candidate document into v1 API format
 */
exports.mapInternalCandidateToApi = (candidate) => {
  const job = candidate.job || {};
  return {
    candidate_id: candidate.uniqueId || String(candidate._id),
    internal_id: candidate._id,
    external_candidate_id: candidate.external_candidate_id || null,
    job_id: job.uniqueId || (typeof job === 'object' ? String(job._id) : String(job)),
    external_job_id: job.external_job_id || null,
    name: [candidate.firstName, candidate.middleName, candidate.lastName].filter(Boolean).join(' '),
    email: candidate.email,
    phone: candidate.mobile,
    location: candidate.location || null,
    resume: {
      url: candidate.resumeUrl || null,
      file_name: candidate.resumeOriginalName || null
    },
    professional: {
      current_company: candidate.currentCompany || null,
      current_designation: candidate.currentDesignation || null,
      experience_years: candidate.totalExperience || 0,
      relevant_experience_years: candidate.relevantExperience || 0,
      notice_period: candidate.noticePeriod || null,
      current_salary: candidate.currentSalary || null,
      expected_salary: candidate.expectedSalary || null
    },
    source: {
      type: candidate.submittedBy ? 'TALENT_PARTNER' : 'DIRECT',
      partner_id: candidate.submittedBy?._id || null
    },
    match: {
      score: candidate.aiScore || candidate.fitmentScore || null,
      skills_match: candidate.skillsScore || null,
      experience_match: candidate.experienceScore || null
    },
    status: candidate.candidateStatus || 'SUBMITTED',
    applied_at: candidate.createdAt,
    updated_at: candidate.updatedAt
  };
};

/**
 * Format internal InterviewSlot document into v1 API format
 */
exports.mapInternalInterviewToApi = (slot) => {
  return {
    interview_id: String(slot._id),
    job_id: slot.job?.uniqueId || String(slot.job?._id || slot.job),
    candidate_id: slot.candidate?.uniqueId || String(slot.candidate?._id || slot.candidate),
    round_name: slot.roundName || `Round ${slot.roundNumber || 1}`,
    scheduled_at: slot.startTime,
    duration_minutes: slot.durationMinutes || 60,
    meeting_link: slot.meetingLink || null,
    status: slot.status || 'SCHEDULED',
    interviewer: {
      name: slot.interviewerName || null,
      email: slot.interviewerEmail || null
    },
    feedback: slot.feedback || null,
    created_at: slot.createdAt,
    updated_at: slot.updatedAt
  };
};
