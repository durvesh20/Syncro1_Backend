// backend/services/integrationService.js
const { v4: uuidv4 } = require('uuid');

/**
 * Maps incoming ATS external job payload to internal Job model attributes
 */
exports.mapExternalJobToInternal = (payload, companyId, postedByUserId, integrationId) => {
  // 1. Normalize employment type
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

  // 2. Normalize location (location.city MUST be an Array of strings per Project Knowledge!)
  let cities = ['Remote'];
  if (payload.location) {
    if (Array.isArray(payload.location.city) && payload.location.city.length > 0) {
      cities = payload.location.city.map(c => String(c).trim()).filter(Boolean);
    } else if (typeof payload.location.city === 'string' && payload.location.city.trim()) {
      cities = [payload.location.city.trim()];
    } else if (typeof payload.location === 'string' && payload.location.trim()) {
      cities = [payload.location.trim()];
    }
  } else if (payload.city) {
    cities = Array.isArray(payload.city)
      ? payload.city.map(c => String(c).trim()).filter(Boolean)
      : [String(payload.city).trim()];
  }
  if (cities.length === 0) cities = ['Remote'];

  let isRemote = Boolean(payload.location?.isRemote ?? payload.location?.is_remote ?? false);
  let isHybrid = Boolean(payload.location?.isHybrid ?? payload.location?.is_hybrid ?? false);
  let isOnSite = Boolean(payload.location?.isOnSite ?? payload.location?.is_onsite ?? false);
  // Ensure at least one work mode is true per web app validation requirements
  if (!isRemote && !isHybrid && !isOnSite) {
    isOnSite = true;
  }

  // 3. Experience range & level
  let expMin = 0;
  let expMax = 5;
  if (payload.experience) {
    expMin = Number(payload.experience.min) || 0;
    expMax = Number(payload.experience.max) || (expMin + 3);
  } else {
    expMin = Number(payload.experience_min) || 0;
    expMax = Number(payload.experience_max) || (expMin + 3);
  }
  if (expMin < 0) expMin = 0;
  if (expMax < expMin) expMax = expMin;

  let experienceLevel = payload.experience_level || payload.experienceLevel;
  if (!experienceLevel) {
    if (expMax <= 2) experienceLevel = 'Entry';
    else if (expMin >= 12) experienceLevel = 'Executive';
    else if (expMin >= 5 || expMax >= 8) experienceLevel = 'Senior';
    else experienceLevel = 'Mid';
  }

  // 4. Compensation & commission
  const comp = payload.compensation || payload.salary || {};
  let salaryMin = comp.min != null ? Number(comp.min) : undefined;
  let salaryMax = comp.max != null ? Number(comp.max) : undefined;
  if (salaryMin !== undefined && salaryMin < 0) salaryMin = 0;
  if (salaryMax !== undefined && salaryMax < 0) salaryMax = 0;
  if (salaryMin !== undefined && salaryMax !== undefined && salaryMax < salaryMin) {
    salaryMax = salaryMin;
  }

  const commissionData = payload.commission || {};
  const commission = {
    type: commissionData.type === 'fixed' ? 'fixed' : 'percentage',
    value: Number(commissionData.value) || 0,
    paymentTerms: commissionData.paymentTerms || commissionData.payment_terms || ''
  };

  // 5. Skills & Requirements (Map to skills.required & skills.preferred matching web app)
  let requiredSkills = [];
  let preferredSkills = [];
  if (payload.skills && typeof payload.skills === 'object' && !Array.isArray(payload.skills)) {
    requiredSkills = Array.isArray(payload.skills.required) ? payload.skills.required : [];
    preferredSkills = Array.isArray(payload.skills.preferred) ? payload.skills.preferred : [];
  } else if (Array.isArray(payload.skills)) {
    requiredSkills = payload.skills;
    preferredSkills = Array.isArray(payload.preferred_skills || payload.preferredSkills)
      ? (payload.preferred_skills || payload.preferredSkills)
      : [];
  } else if (Array.isArray(payload.requirements)) {
    requiredSkills = payload.requirements;
  }
  requiredSkills = requiredSkills.map(s => String(s).trim()).filter(Boolean);
  preferredSkills = preferredSkills.map(s => String(s).trim()).filter(Boolean);

  // 6. Education
  const eduMin = payload.education?.minimum || payload.education_minimum || payload.qualification || 'Any Graduate';
  const eduPref = Array.isArray(payload.education?.preferred)
    ? payload.education.preferred.map(e => String(e).trim()).filter(Boolean)
    : (Array.isArray(payload.preferred_education) ? payload.preferred_education.map(e => String(e).trim()).filter(Boolean) : []);

  // 7. Vacancies (enforce Job schema attribute: vacancies, accept openings alias)
  const vacancies = Math.max(1, parseInt(payload.vacancies ?? payload.openings, 10) || 1);

  // 8. Application Deadline (Enforce 30 days minimum per web app rules, or auto-default)
  let deadlineDate;
  const rawDeadline = payload.applicationDeadline || payload.application_deadline || payload.deadline;
  const minThirtyDays = new Date();
  minThirtyDays.setDate(minThirtyDays.getDate() + 30);
  minThirtyDays.setHours(0, 0, 0, 0);

  if (rawDeadline) {
    const parsed = new Date(rawDeadline);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      deadlineDate = parsed < minThirtyDays ? minThirtyDays : parsed;
    } else {
      deadlineDate = minThirtyDays;
    }
  } else {
    deadlineDate = minThirtyDays;
  }

  // 9. Expected Joining Date
  const rawJoining = payload.expectedJoiningDate || payload.expected_joining_date || payload.notice_period || ['Any'];
  const expectedJoiningDate = Array.isArray(rawJoining) ? rawJoining : [String(rawJoining).trim()];

  return {
    company: companyId,
    postedBy: postedByUserId,
    title: (payload.title || '').trim(),
    description: (payload.description || '').trim(),
    category: (payload.category || payload.department || 'IT & Software').trim(),
    subCategory: (payload.subCategory || payload.sub_category || payload.subcategory || '').trim(),
    employmentType,
    experienceLevel,
    experienceRange: {
      min: expMin,
      max: expMax
    },
    salary: {
      min: salaryMin,
      max: salaryMax,
      currency: comp.currency || 'INR',
      isNegotiable: Boolean(comp.isNegotiable || comp.is_negotiable),
      isConfidential: Boolean(comp.isConfidential || comp.is_confidential)
    },
    commission,
    location: {
      city: cities,
      state: payload.location?.state || 'N/A',
      country: payload.location?.country || 'India',
      isRemote,
      isHybrid,
      isOnSite
    },
    skills: {
      required: requiredSkills,
      preferred: preferredSkills
    },
    requirements: requiredSkills,
    responsibilities: Array.isArray(payload.responsibilities)
      ? payload.responsibilities.map(r => String(r).trim()).filter(Boolean)
      : [],
    education: {
      minimum: String(eduMin).trim(),
      preferred: eduPref
    },
    vacancies,
    applicationDeadline: deadlineDate,
    expectedJoiningDate: expectedJoiningDate.length > 0 ? expectedJoiningDate : ['Any'],
    isUrgent: Boolean(payload.isUrgent || payload.is_urgent),
    isFeatured: Boolean(payload.isFeatured || payload.is_featured),
    external_job_id: payload.external_job_id ? String(payload.external_job_id).trim() : null,
    source_system: 'API',
    integration_id: integrationId || null,
    // When created via API, immediately routes to PENDING_APPROVAL for Admin Review & verification
    status: 'PENDING_APPROVAL',
    approvalStatus: 'PENDING_APPROVAL'
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
    sub_category: job.subCategory || null,
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
      is_negotiable: job.salary?.isNegotiable || false,
      is_confidential: job.salary?.isConfidential || false
    },
    commission: job.commission?.value ? {
      type: job.commission.type,
      value: job.commission.value,
      payment_terms: job.commission.paymentTerms || null
    } : null,
    location: {
      cities: Array.isArray(job.location?.city) ? job.location.city : [job.location?.city || 'N/A'],
      state: job.location?.state || 'N/A',
      country: job.location?.country || 'India',
      is_remote: job.location?.isRemote || false,
      is_hybrid: job.location?.isHybrid || false,
      is_onsite: job.location?.isOnSite || false
    },
    skills: {
      required: job.skills?.required || job.requirements || [],
      preferred: job.skills?.preferred || []
    },
    requirements: job.requirements || [],
    responsibilities: job.responsibilities || [],
    education: {
      minimum: job.education?.minimum || null,
      preferred: job.education?.preferred || []
    },
    vacancies: job.vacancies || 1,
    application_deadline: job.applicationDeadline || null,
    expected_joining_date: job.expectedJoiningDate || ['Any'],
    is_urgent: job.isUrgent || false,
    is_featured: job.isFeatured || false,
    status: job.status,
    approval_status: job.approvalStatus,
    rejection_reason: job.rejectionReason || null,
    rejected_at: job.rejectedAt || null,
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
/**
 * Format internal Candidate document into v1 API format
 */
exports.mapInternalCandidateToApi = (candidate) => {
  if (!candidate) return null;
  const job = candidate.job || {};
  const profile = candidate.profile || {};
  const resume = candidate.resume || {};
  const offer = candidate.offer || {};
  const interviewConfig = candidate.interviewConfig || {};

  // Resolve active/current round from pipeline rounds array if present
  let currentRound = null;
  if (Array.isArray(candidate.rounds) && candidate.rounds.length > 0) {
    const active = candidate.rounds.find(r => 
      !['ROUND_REJECTED', 'ASSESSMENT_FAILED', 'ROUND_SELECTED_NEXT', 'HR_SELECTED', 'HR_REJECTED'].includes(r.status)
    ) || candidate.rounds[candidate.rounds.length - 1];

    if (active) {
      currentRound = {
        round_type: active.roundType,
        order: active.order,
        status: active.status,
        reschedule_count: active.rescheduleCount || { candidateInitiated: 0, clientInitiated: 0, partnerInitiated: 0 }
      };
    }
  }

  return {
    candidate_id: candidate.uniqueId || String(candidate._id),
    internal_id: candidate._id,
    external_candidate_id: candidate.external_candidate_id || null,
    job_id: job.uniqueId || (typeof job === 'object' ? String(job._id || '') : String(job)),
    external_job_id: job.external_job_id || null,
    name: [candidate.firstName, profile.middleName || candidate.middleName, candidate.lastName].filter(Boolean).join(' '),
    first_name: candidate.firstName,
    last_name: candidate.lastName,
    email: candidate.email,
    phone: candidate.mobile,
    location: profile.location || profile.currentLocation || candidate.location || null,
    resume: {
      url: resume.url || candidate.resumeUrl || null,
      file_name: resume.fileName || candidate.resumeOriginalName || null,
      uploaded_at: resume.uploadedAt || null
    },
    professional: {
      current_company: profile.currentCompany || candidate.currentCompany || null,
      current_designation: profile.currentDesignation || candidate.currentDesignation || null,
      experience_years: profile.totalExperience ?? candidate.totalExperience ?? 0,
      relevant_experience_years: profile.relevantExperience ?? candidate.relevantExperience ?? 0,
      notice_period: profile.noticePeriod || candidate.noticePeriod || null,
      last_working_day: profile.lastWorkingDay || null,
      current_salary: profile.currentSalary ?? candidate.currentSalary ?? null,
      expected_salary: profile.expectedSalary ?? candidate.expectedSalary ?? null,
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      languages: Array.isArray(profile.languages) ? profile.languages : [],
      summary_writeup: profile.writeup || null,
      education: Array.isArray(profile.education) ? profile.education.map(e => ({
        degree: e.degree || null,
        institution: e.institution || null,
        year: e.year || null
      })) : [],
      experience: Array.isArray(profile.experience) ? profile.experience.map(exp => ({
        company: exp.company || null,
        title: exp.title || null,
        start_date: exp.startDate || null,
        end_date: exp.endDate || null,
        is_current: !!exp.isCurrent,
        duration_months: exp.durationMonths || null
      })) : []
    },
    source: {
      type: candidate.submittedBy ? 'TALENT_PARTNER' : 'DIRECT',
      partner_id: candidate.submittedBy?._id || (typeof candidate.submittedBy === 'string' ? candidate.submittedBy : null)
    },
    match: {
      score: candidate.resumeAnalysis?.profileScore ?? candidate.prescreen?.prescreen_score ?? candidate.submissionMetadata?.matchScore ?? candidate.aiScore ?? null,
      match_level: candidate.resumeAnalysis?.matchLevel || candidate.prescreen?.status || null,
      recommendation: candidate.resumeAnalysis?.recommendation || null
    },
    status: candidate.status || candidate.candidateStatus || 'SUBMITTED',
    current_round: currentRound,
    interview_details: interviewConfig.mode ? {
      mode: interviewConfig.mode,
      details: interviewConfig.details || null,
      interviewer: interviewConfig.interviewer || null,
      is_confirmed_by_company: !!interviewConfig.isConfirmedByCompany,
      confirmed_at: interviewConfig.confirmedAt || null,
      candidate_response: interviewConfig.candidateResponse || 'PENDING',
      responded_at: interviewConfig.respondedAt || null
    } : null,
    offer: (offer.isOfferSent || offer.salary) ? {
      salary: offer.salary || null,
      inhand_ctc: offer.inhandCtc || null,
      variable_ctc: offer.variableCtc || null,
      joining_date: offer.joiningDate || offer.expectedJoiningDate || null,
      work_mode: offer.workMode || null,
      work_location: offer.workLocation || null,
      offer_letter_url: offer.offerLetterUrl || null,
      status: offer.response || (offer.isOfferSent ? 'SENT' : null),
      sent_at: offer.offerSentAt || null,
      expires_at: offer.offerExpiresAt || null
    } : null,
    interviews: Array.isArray(candidate.interviews) ? candidate.interviews.map(i => ({
      round: i.round,
      type: i.type,
      scheduled_at: i.scheduledAt,
      interviewer_name: i.interviewerName,
      meeting_link: i.meetingLink,
      feedback: i.feedback,
      rating: i.rating,
      result: i.result
    })) : [],
    applied_at: candidate.createdAt,
    updated_at: candidate.updatedAt
  };
};

/**
 * Format internal InterviewSlot document into v1 API format
 */
exports.mapInternalInterviewToApi = (slot) => {
  if (!slot) return null;
  return {
    interview_id: String(slot._id),
    job_id: slot.job?.uniqueId || (typeof slot.job === 'object' ? String(slot.job._id || '') : String(slot.job || '')),
    date: slot.date,
    start_time: slot.startTime,
    end_time: slot.endTime,
    duration_minutes: slot.averageTime || 30,
    interview_mode: slot.interviewMode || 'Virtual',
    interview_details: slot.interviewDetails || null,
    interviewer_name: slot.interviewerName || null,
    status: slot.status || 'ACTIVE',
    round_type: slot.roundType || null,
    max_candidates: slot.maxCandidates || 1,
    available_spots: slot.availableSpots ?? 1,
    notes: slot.notes || null,
    booked_candidates: Array.isArray(slot.bookedCandidates) ? slot.bookedCandidates.map(b => {
      const cand = b.candidate || {};
      return {
        candidate_id: cand.uniqueId || (typeof cand === 'object' ? String(cand._id || '') : String(cand)),
        name: [cand.firstName, cand.lastName].filter(Boolean).join(' ') || null,
        email: cand.email || null,
        booking_status: b.bookingStatus,
        booked_at: b.bookedAt,
        cancel_reason: b.cancelReason || null
      };
    }) : [],
    created_at: slot.createdAt,
    updated_at: slot.updatedAt
  };
};
