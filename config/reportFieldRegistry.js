// backend/config/reportFieldRegistry.js
// ---------------------------------------------------------------------------
// SINGLE SOURCE OF TRUTH for the "Download Report" feature.
//
// This registry drives BOTH:
//   - the frontend field-selection UI (via GET /api/reports/config/:reportType)
//   - the backend query builder / column mapper (via services/reportService.js)
//
// Field `path` is a dotted path into the aggregated MongoDB document produced
// by the report resolver. The resolver runs the lookups declared per report
// type so these paths resolve. `type` drives Excel cell formatting:
//   'date'   -> real Excel date cell
//   'number' -> numeric cell
//   'array'  -> joined with ", "
//   'string' / 'boolean' -> text
// `compute` (optional) names a special computation handled in reportService.
//
// Filters:
//   type: 'dateRange' | 'select' | 'multiselect' | 'jobSelect' | 'companySelect'
//   appliesTo: the BASE collection field the filter is applied to (after scope)
//   roles: (optional) restrict filter visibility to these roles only
// ---------------------------------------------------------------------------

// ---- Shared section builders (reused across report types) ----------------

// Candidate "application" base lookups (used by all candidate-centric reports)
const CANDIDATE_LOOKUPS = [
  { from: 'jobs', localField: 'job', foreignField: '_id', as: 'jobInfo' },
  { from: 'companies', localField: 'company', foreignField: '_id', as: 'companyInfo' },
  { from: 'staffingpartners', localField: 'submittedBy', foreignField: '_id', as: 'partnerInfo' },
  { from: 'jobpositions', localField: 'job', foreignField: 'jobId', as: 'jobPositionInfo' }
];

const CANDIDATE_DETAILS_SECTION = {
  sectionKey: 'candidateDetails',
  label: 'Candidate Details',
  fields: [
    { key: 'cand_uniqueId', label: 'Candidate ID', path: 'uniqueId', type: 'string', default: false },
    { key: 'cand_firstName', label: 'First Name', path: 'firstName', type: 'string', default: true },
    { key: 'cand_lastName', label: 'Last Name', path: 'lastName', type: 'string', default: true },
    { key: 'cand_email', label: 'Email', path: 'email', type: 'string', default: true },
    { key: 'cand_mobile', label: 'Mobile', path: 'mobile', type: 'string', default: false },
    { key: 'cand_consentStatus', label: 'Consent Status', path: 'consent.consentStatus', type: 'string', default: false }
  ]
};

const CANDIDATE_PROFILE_SECTION = {
  sectionKey: 'candidateProfile',
  label: 'Candidate Profile',
  fields: [
    { key: 'cand_location', label: 'Location', path: 'profile.location', type: 'string', default: false },
    { key: 'cand_totalExp', label: 'Total Experience (yrs)', path: 'profile.totalExperience', type: 'number', default: true },
    { key: 'cand_relExp', label: 'Relevant Experience (yrs)', path: 'profile.relevantExperience', type: 'number', default: false },
    { key: 'cand_notice', label: 'Notice Period', path: 'profile.noticePeriod', type: 'string', default: false },
    { key: 'cand_currentCompany', label: 'Current Company', path: 'profile.currentCompany', type: 'string', default: false },
    { key: 'cand_currentDesignation', label: 'Current Designation', path: 'profile.currentDesignation', type: 'string', default: false },
    { key: 'cand_skills', label: 'Skills', path: 'profile.skills', type: 'array', default: true },
    { key: 'cand_linkedin', label: 'LinkedIn', path: 'profile.linkedinProfile', type: 'string', default: false }
  ]
};

const CANDIDATE_SCORING_SECTION = {
  sectionKey: 'candidateScoring',
  label: 'AI Scoring',
  fields: [
    { key: 'score_match', label: 'Match Score %', path: 'submissionMetadata.matchScore', type: 'number', default: true },
    { key: 'score_matchLevel', label: 'Match Level', path: 'resumeAnalysis.matchLevel', type: 'string', default: false },
    { key: 'score_profileScore', label: 'Profile Score', path: 'resumeAnalysis.profileScore', type: 'number', default: false },
    { key: 'score_skillCoverage', label: 'Skill Coverage %', path: 'resumeAnalysis.scoreBreakdown.skills.coveragePercent', type: 'number', default: false },
    { key: 'score_matchedSkills', label: 'Matched Skills', path: 'resumeAnalysis.scoreBreakdown.skills.matchedRequired', type: 'array', default: false },
    { key: 'score_missingSkills', label: 'Missing Skills', path: 'resumeAnalysis.scoreBreakdown.skills.missingRequired', type: 'array', default: false }
  ]
};

const CANDIDATE_PIPELINE_SECTION = {
  sectionKey: 'candidatePipeline',
  label: 'Pipeline',
  fields: [
    { key: 'cand_status', label: 'Current Stage', path: 'status', type: 'string', default: true },
    { key: 'cand_submittedAt', label: 'Submitted At', path: 'createdAt', type: 'date', default: true }
  ]
};

const CANDIDATE_JOB_CONTEXT_SECTION = {
  sectionKey: 'jobContext',
  label: 'Job Context',
  fields: [
    { key: 'job_title', label: 'Job Title', path: 'jobInfo.title', type: 'string', default: true },
    { key: 'job_uniqueId', label: 'Job ID', path: 'jobInfo.uniqueId', type: 'string', default: false },
    { key: 'job_status', label: 'Job Status', path: 'jobInfo.status', type: 'string', default: false },
    { key: 'job_city', label: 'Job Location', path: 'jobInfo.location.city', type: 'array', default: false },
    { key: 'job_company', label: 'Owning Company', path: 'companyInfo.companyName', type: 'string', default: true },
    { key: 'job_sourcePartner', label: 'Submitted By (Partner)', path: 'partnerInfo.firmName', type: 'string', default: false },
    { key: 'job_requiredSkills', label: 'Job Required Skills', path: 'jobPositionInfo.parsedRequirements.skills.mustHave', type: 'array', default: false }
  ]
};

// Job base lookups (for the admin standalone Job Report)
const JOB_LOOKUPS = [
  { from: 'companies', localField: 'company', foreignField: '_id', as: 'companyInfo' }
];

const JOB_DETAILS_SECTION = {
  sectionKey: 'jobDetails',
  label: 'Job Details',
  fields: [
    { key: 'job_title', label: 'Job Title', path: 'title', type: 'string', default: true },
    { key: 'job_uniqueId', label: 'Job ID', path: 'uniqueId', type: 'string', default: true },
    { key: 'job_category', label: 'Category', path: 'category', type: 'string', default: false },
    { key: 'job_subCategory', label: 'Sub Category', path: 'subCategory', type: 'string', default: false },
    { key: 'job_employmentType', label: 'Employment Type', path: 'employmentType', type: 'string', default: false },
    { key: 'job_experienceLevel', label: 'Experience Level', path: 'experienceLevel', type: 'string', default: false },
    { key: 'job_expMin', label: 'Min Experience', path: 'experienceRange.min', type: 'number', default: false },
    { key: 'job_expMax', label: 'Max Experience', path: 'experienceRange.max', type: 'number', default: false },
    { key: 'job_salaryMin', label: 'Salary Min', path: 'salary.min', type: 'number', default: true },
    { key: 'job_salaryMax', label: 'Salary Max', path: 'salary.max', type: 'number', default: true },
    { key: 'job_salaryCurrency', label: 'Salary Currency', path: 'salary.currency', type: 'string', default: false },
    { key: 'job_city', label: 'Location', path: 'location.city', type: 'array', default: true },
    { key: 'job_state', label: 'State', path: 'location.state', type: 'string', default: false },
    { key: 'job_skillsRequired', label: 'Required Skills', path: 'skills.required', type: 'array', default: false },
    { key: 'job_skillsPreferred', label: 'Preferred Skills', path: 'skills.preferred', type: 'array', default: false },
    { key: 'job_vacancies', label: 'Vacancies', path: 'vacancies', type: 'number', default: false },
    { key: 'job_filled', label: 'Filled Positions', path: 'filledPositions', type: 'number', default: false },
    { key: 'job_applicationDeadline', label: 'Application Deadline', path: 'applicationDeadline', type: 'date', default: false },
    { key: 'job_status', label: 'Status', path: 'status', type: 'string', default: true },
    { key: 'job_approvalStatus', label: 'Approval Status', path: 'approvalStatus', type: 'string', default: false },
    { key: 'job_visibility', label: 'Visibility', path: 'visibility', type: 'string', default: false },
    { key: 'job_createdAt', label: 'Posted At', path: 'createdAt', type: 'date', default: true }
  ]
};

const JOB_COMPANY_SECTION = {
  sectionKey: 'companyContext',
  label: 'Company Context',
  fields: [
    { key: 'job_companyName', label: 'Company Name', path: 'companyInfo.companyName', type: 'string', default: true },
    { key: 'job_companyIndustry', label: 'Industry', path: 'companyInfo.kyc.industry', type: 'string', default: false }
  ]
};

const JOB_METRICS_SECTION = {
  sectionKey: 'jobMetrics',
  label: 'Job Metrics',
  fields: [
    { key: 'job_views', label: 'Views', path: 'metrics.views', type: 'number', default: false },
    { key: 'job_applications', label: 'Applications', path: 'metrics.applications', type: 'number', default: true },
    { key: 'job_shortlisted', label: 'Shortlisted', path: 'metrics.shortlisted', type: 'number', default: false },
    { key: 'job_interviewed', label: 'Interviewed', path: 'metrics.interviewed', type: 'number', default: false },
    { key: 'job_offered', label: 'Offered', path: 'metrics.offered', type: 'number', default: false },
    { key: 'job_joined', label: 'Joined', path: 'metrics.joined', type: 'number', default: false }
  ]
};

// Candidate FSM statuses (subset surfaced as a filter option list)
const CANDIDATE_STATUS_OPTIONS = [
  'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED',
  'INTERVIEWED', 'OFFERED', 'OFFER_ACCEPTED', 'JOINED', 'REJECTED', 'WITHDRAWN', 'ON_HOLD'
];

const JOB_STATUS_OPTIONS = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'FILLED', 'ON_HOLD'];
const VERIFICATION_STATUS_OPTIONS = ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];

// ---------------------------------------------------------------------------
// REPORT TYPE REGISTRY
// ---------------------------------------------------------------------------
const reportFieldRegistry = {
  // ===================== ADMIN / SUB-ADMIN =====================
  TALENT_PARTNER_REPORT: {
    label: 'Talent Partner Report',
    description: 'Talent partner profiles, competencies and submission performance.',
    allowedRoles: ['admin', 'sub_admin'],
    base: 'staffingpartners',
    scope: null,
    lookups: [],
    sections: [
      {
        sectionKey: 'partnerDetails',
        label: 'Partner Details',
        fields: [
          { key: 'tp_firmName', label: 'Firm Name', path: 'firmName', type: 'string', default: true },
          { key: 'tp_uniqueId', label: 'Partner ID', path: 'uniqueId', type: 'string', default: false },
          { key: 'tp_firstName', label: 'First Name', path: 'firstName', type: 'string', default: false },
          { key: 'tp_lastName', label: 'Last Name', path: 'lastName', type: 'string', default: false },
          { key: 'tp_designation', label: 'Designation', path: 'designation', type: 'string', default: false },
          { key: 'tp_city', label: 'City', path: 'city', type: 'string', default: false },
          { key: 'tp_state', label: 'State', path: 'state', type: 'string', default: false },
          { key: 'tp_entityType', label: 'Entity Type', path: 'firmDetails.entityType', type: 'string', default: false },
          { key: 'tp_website', label: 'Website', path: 'firmDetails.website', type: 'string', default: false },
          { key: 'tp_sectors', label: 'Hiring Sectors', path: 'Syncro1Competency.primaryHiringSectors', type: 'array', default: true },
          { key: 'tp_plan', label: 'Subscription Plan', path: 'subscription.plan', type: 'string', default: false },
          { key: 'tp_verificationStatus', label: 'Verification Status', path: 'verificationStatus', type: 'string', default: true },
          { key: 'tp_createdAt', label: 'Registered At', path: 'createdAt', type: 'date', default: true }
        ]
      },
      {
        sectionKey: 'partnerMetrics',
        label: 'Performance Metrics',
        fields: [
          { key: 'tp_totalSubmissions', label: 'Total Submissions', path: 'metrics.totalSubmissions', type: 'number', default: true },
          { key: 'tp_totalPlacements', label: 'Total Placements', path: 'metrics.totalPlacements', type: 'number', default: true },
          {
            key: 'tp_submissionToHireRatio', label: 'Submission → Hire Ratio', path: null,
            type: 'number', default: false, compute: 'submissionToHireRatio'
          },
          { key: 'tp_totalShortlisted', label: 'Total Shortlisted', path: 'metrics.totalShortlisted', type: 'number', default: false },
          { key: 'tp_totalInterviewed', label: 'Total Interviewed', path: 'metrics.totalInterviewed', type: 'number', default: false },
          { key: 'tp_totalOffered', label: 'Total Offered', path: 'metrics.totalOffered', type: 'number', default: false },
          { key: 'tp_totalEarnings', label: 'Total Earnings', path: 'metrics.totalEarnings', type: 'number', default: false }
        ]
      }
    ],
    filters: [
      { key: 'dateRange', label: 'Registered Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'verificationStatus', label: 'Verification Status', type: 'select', appliesTo: 'verificationStatus', options: VERIFICATION_STATUS_OPTIONS }
    ]
  },

  COMPANY_REPORT: {
    label: 'Company Report',
    description: 'Company profiles, KYC and hiring performance.',
    allowedRoles: ['admin', 'sub_admin'],
    base: 'companies',
    scope: null,
    lookups: [],
    sections: [
      {
        sectionKey: 'companyDetails',
        label: 'Company Details',
        fields: [
          { key: 'co_companyName', label: 'Company Name', path: 'companyName', type: 'string', default: true },
          { key: 'co_uniqueId', label: 'Company ID', path: 'uniqueId', type: 'string', default: false },
          { key: 'co_decisionMaker', label: 'Decision Maker', path: 'decisionMakerName', type: 'string', default: false },
          { key: 'co_designation', label: 'Designation', path: 'designation', type: 'string', default: false },
          { key: 'co_department', label: 'Department', path: 'department', type: 'string', default: false },
          { key: 'co_city', label: 'City', path: 'city', type: 'string', default: false },
          { key: 'co_state', label: 'State', path: 'state', type: 'string', default: false },
          { key: 'co_industry', label: 'Industry', path: 'kyc.industry', type: 'string', default: true },
          { key: 'co_companyType', label: 'Company Type', path: 'kyc.companyType', type: 'string', default: false },
          { key: 'co_website', label: 'Website', path: 'kyc.website', type: 'string', default: false },
          { key: 'co_verificationStatus', label: 'Verification Status', path: 'verificationStatus', type: 'string', default: true },
          { key: 'co_createdAt', label: 'Registered At', path: 'createdAt', type: 'date', default: true }
        ]
      },
      {
        sectionKey: 'companyMetrics',
        label: 'Hiring Metrics',
        fields: [
          { key: 'co_totalJobsPosted', label: 'Total Jobs Posted', path: 'metrics.totalJobsPosted', type: 'number', default: true },
          { key: 'co_activeJobs', label: 'Active Jobs', path: 'metrics.activeJobs', type: 'number', default: true },
          { key: 'co_totalHires', label: 'Total Hires', path: 'metrics.totalHires', type: 'number', default: true },
          { key: 'co_totalSpent', label: 'Total Spent', path: 'metrics.totalSpent', type: 'number', default: false }
        ]
      }
    ],
    filters: [
      { key: 'dateRange', label: 'Registered Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'verificationStatus', label: 'Verification Status', type: 'select', appliesTo: 'verificationStatus', options: VERIFICATION_STATUS_OPTIONS }
    ]
  },

  JOB_REPORT: {
    label: 'Job Report',
    description: 'All jobs with status, owner company and applicant counts.',
    allowedRoles: ['admin', 'sub_admin'],
    base: 'jobs',
    scope: null,
    lookups: JOB_LOOKUPS,
    sections: [JOB_DETAILS_SECTION, JOB_COMPANY_SECTION, JOB_METRICS_SECTION],
    filters: [
      { key: 'dateRange', label: 'Posted Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'status', label: 'Job Status', type: 'select', appliesTo: 'status', options: JOB_STATUS_OPTIONS },
      { key: 'company', label: 'Company', type: 'companySelect', appliesTo: 'company', roles: ['admin', 'sub_admin'] }
    ]
  },

  JOB_WITH_CANDIDATES: {
    label: 'Job + Candidate Report',
    description: 'Job-wise list of all candidates who applied, with stage and score.',
    allowedRoles: ['admin', 'sub_admin'],
    base: 'candidates',
    scope: null,
    lookups: CANDIDATE_LOOKUPS,
    sections: [
      CANDIDATE_DETAILS_SECTION,
      CANDIDATE_PROFILE_SECTION,
      CANDIDATE_SCORING_SECTION,
      CANDIDATE_PIPELINE_SECTION,
      CANDIDATE_JOB_CONTEXT_SECTION
    ],
    filters: [
      { key: 'job', label: 'Job', type: 'jobSelect', appliesTo: 'job' },
      { key: 'company', label: 'Company', type: 'companySelect', appliesTo: 'company', roles: ['admin', 'sub_admin'] },
      { key: 'dateRange', label: 'Submitted Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'status', label: 'Candidate Stage', type: 'select', appliesTo: 'status', options: CANDIDATE_STATUS_OPTIONS }
    ]
  },

  // ===================== COMPANY =====================
  ALL_CANDIDATES: {
    label: 'All Candidates Report',
    description: 'Every candidate who applied to any of your jobs, with score and stage.',
    allowedRoles: ['company'],
    base: 'candidates',
    scope: { collection: 'companies', userField: 'user', field: 'company' },
    lookups: CANDIDATE_LOOKUPS,
    sections: [
      CANDIDATE_DETAILS_SECTION,
      CANDIDATE_PROFILE_SECTION,
      CANDIDATE_SCORING_SECTION,
      CANDIDATE_PIPELINE_SECTION,
      CANDIDATE_JOB_CONTEXT_SECTION
    ],
    filters: [
      { key: 'dateRange', label: 'Submitted Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'status', label: 'Candidate Stage', type: 'select', appliesTo: 'status', options: CANDIDATE_STATUS_OPTIONS }
    ]
  },

  JOB_WISE_CANDIDATES: {
    label: 'Job-wise Candidate Report',
    description: 'Pick one or more of your jobs and get the candidate list with full pipeline detail.',
    allowedRoles: ['company'],
    base: 'candidates',
    scope: { collection: 'companies', userField: 'user', field: 'company' },
    lookups: CANDIDATE_LOOKUPS,
    sections: [
      CANDIDATE_DETAILS_SECTION,
      CANDIDATE_PROFILE_SECTION,
      CANDIDATE_SCORING_SECTION,
      CANDIDATE_PIPELINE_SECTION,
      CANDIDATE_JOB_CONTEXT_SECTION
    ],
    filters: [
      { key: 'job', label: 'Job(s)', type: 'jobSelect', appliesTo: 'job' },
      { key: 'dateRange', label: 'Submitted Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'status', label: 'Candidate Stage', type: 'select', appliesTo: 'status', options: CANDIDATE_STATUS_OPTIONS }
    ]
  },

  // ===================== TALENT PARTNER =====================
  JOB_LIST_WITH_SUBMITTED_CANDIDATES: {
    label: 'Job List with Submitted Candidates',
    description: 'Jobs you have access to, and the candidates you personally submitted for each.',
    allowedRoles: ['staffing_partner'],
    base: 'candidates',
    scope: { collection: 'staffingpartners', userField: 'user', field: 'submittedBy' },
    lookups: CANDIDATE_LOOKUPS,
    sections: [
      CANDIDATE_DETAILS_SECTION,
      CANDIDATE_PROFILE_SECTION,
      CANDIDATE_SCORING_SECTION,
      CANDIDATE_PIPELINE_SECTION,
      CANDIDATE_JOB_CONTEXT_SECTION
    ],
    filters: [
      { key: 'job', label: 'Job(s)', type: 'jobSelect', appliesTo: 'job' },
      { key: 'dateRange', label: 'Submitted Between', type: 'dateRange', appliesTo: 'createdAt' },
      { key: 'status', label: 'Candidate Stage', type: 'select', appliesTo: 'status', options: CANDIDATE_STATUS_OPTIONS }
    ]
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Flatten all field defs for a report type into a key -> fieldDef map
function getFieldMap(reportType, role) {
  const def = reportFieldRegistry[reportType];
  if (!def) return {};
  const map = {};

  let sections = def.sections || [];
  if (role === 'staffing_partner' || role === 'company') {
    sections = sections.filter((s) => s.sectionKey !== 'candidateScoring');
    sections = sections.map((s) => {
      if (s.sectionKey === 'candidateProfile') {
        return {
          ...s,
          fields: s.fields.filter((f) => f.key !== 'cand_linkedin')
        };
      }
      if (s.sectionKey === 'jobContext') {
        return {
          ...s,
          fields: s.fields.filter((f) => f.key !== 'job_sourcePartner')
        };
      }
      return s;
    });
  }

  sections.forEach((section) => {
    section.fields.forEach((f) => {
      map[f.key] = f;
    });
  });
  return map;
}

// All valid field keys for a report type
function getValidFieldKeys(reportType, role) {
  return Object.keys(getFieldMap(reportType, role));
}

// Return the registry config filtered for a specific caller role
// (drops filters restricted to other roles). Throws if role not allowed.
function getConfigForRole(reportType, role) {
  const def = reportFieldRegistry[reportType];
  if (!def) return null;
  if (!def.allowedRoles.includes(role)) return null;

  const filters = (def.filters || []).filter((f) => {
    if (f.roles && f.roles.length && !f.roles.includes(role)) return false;
    return true;
  });

  // Filter out AI Scoring section, linkedin, and submitted by partner fields for staffing_partner and company roles
  let sections = def.sections || [];
  if (role === 'staffing_partner' || role === 'company') {
    sections = sections.filter((s) => s.sectionKey !== 'candidateScoring');
    sections = sections.map((s) => {
      if (s.sectionKey === 'candidateProfile') {
        return {
          ...s,
          fields: s.fields.filter((f) => f.key !== 'cand_linkedin')
        };
      }
      if (s.sectionKey === 'jobContext') {
        return {
          ...s,
          fields: s.fields.filter((f) => f.key !== 'job_sourcePartner')
        };
      }
      return s;
    });
  }

  return {
    reportType,
    label: def.label,
    description: def.description,
    allowedRoles: def.allowedRoles,
    sections,
    filters
  };
}

module.exports = {
  reportFieldRegistry,
  getFieldMap,
  getValidFieldKeys,
  getConfigForRole
};
