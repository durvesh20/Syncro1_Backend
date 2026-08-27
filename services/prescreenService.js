/**
 * prescreenService.js
 *
 * Rule-based (non-AI) pre-screening scoring engine.
 * All functions are PURE — no DB calls, no external requests, no side effects.
 * Each scoreX() function is independently unit-testable.
 *
 * Scoring dimensions (each 0–100):
 *   - Location      (default weight: 25%)
 *   - Salary        (default weight: 25%)
 *   - Notice Period (default weight: 15%)
 *   - Experience    (default weight: 35%)
 *
 * Status thresholds:
 *   >= 60  → qualified
 *   40–59  → borderline
 *   < 40   → not_qualified
 */

const DEFAULT_WEIGHTS = {
  location:   0.25,
  salary:     0.25,
  notice:     0.15,
  experience: 0.35,
};

// ─── NOTICE PERIOD HELPERS ────────────────────────────────────────────────────
const NOTICE_DAYS_MAP = {
  'immediate':         0,
  '0-15 days':         15,
  '15 days':           15,
  '15-30 days':        30,
  '30 days':           30,
  '1 month':           30,
  '30-45 days':        45,
  '45 days':           45,
  '45-60 days':        60,
  '60 days':           60,
  '2 months':          60,
  '60-75 days':        75,
  '75 days':           75,
  '75-90 days':        90,
  '90 days':           90,
  '3 months':          90,
  'more than 90 days': 120,
  'currently serving': 15,
  'any':               0,
};

function parseNoticeDays(npStr) {
  if (!npStr) return null;
  const lower = npStr.toLowerCase().trim();
  // Sort keys by descending length so longer/more-specific entries match first
  // e.g. 'more than 90 days' must match before '90 days'
  const sortedKeys = Object.keys(NOTICE_DAYS_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) return NOTICE_DAYS_MAP[key];
  }
  const match = lower.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

function parseJobNoticeCriteria(jobNoticeInput) {
  let list = [];
  if (Array.isArray(jobNoticeInput)) {
    list = jobNoticeInput.map(s => String(s).trim());
  } else if (typeof jobNoticeInput === 'string' && jobNoticeInput.trim()) {
    list = [jobNoticeInput.trim()];
  }

  if (list.length === 0 || list.some(s => s.toLowerCase() === 'any')) {
    return { maxDays: null, immediatePreferred: false, anyAccepted: true };
  }

  const dayValues = list.map(s => parseNoticeDays(s)).filter(d => d !== null);
  const maxDays = dayValues.length > 0 ? Math.max(...dayValues) : null;
  const immediatePreferred = list.some(s => s.toLowerCase().includes('immediate'));

  return { maxDays, immediatePreferred, anyAccepted: false };
}

// ─── SALARY HELPERS ───────────────────────────────────────────────────────────

function normalizeSalaryToLPA(val) {
  if (val == null || val === '') return null;
  const num = Number(String(val).replace(/,/g, ''));
  if (isNaN(num)) return null;
  if (num < 100) return num;
  return num / 100000;
}

// ─── SCORING FUNCTIONS ────────────────────────────────────────────────────────

/**
 * Score location fit (0–100).
 * Evaluation Order per Manager Rules:
 * 1. If Job is Remote -> location does not matter (100%).
 * 2. If Job is Hybrid -> check city match (100%). If different city: willing to relocate (80%), not willing (40%).
 * 3. If Job is Onsite -> city match required for 100%. If different city: willing to relocate (60%), not willing (10%).
 */
function scoreLocation(candidate, jobLocation) {
  // 1. Remote Job: Candidate location does not matter
  if (!jobLocation || jobLocation.isRemote) {
    return { score: 100, detail: 'Remote job — location is not a factor' };
  }

  const candidateCity = (
    candidate.location ||
    candidate.currentLocation ||
    candidate.profile?.location ||
    candidate.profile?.currentLocation ||
    candidate.profile?.standardizedLocation ||
    ''
  ).trim().toLowerCase();

  const willingToRelocate = !!(
    candidate.profile?.willingToRelocate ??
    candidate.willingToRelocate
  );

  const jobCities = (
    Array.isArray(jobLocation?.city) ? jobLocation.city : [jobLocation?.city || '']
  ).map(c => String(c).trim().toLowerCase()).filter(Boolean);

  if (jobCities.length === 0) {
    return { score: 50, detail: 'Job city not specified — neutral score', skipped: true };
  }

  if (!candidateCity) {
    return { score: 50, detail: 'Candidate location not provided — neutral score', skipped: true };
  }

  const CITY_ALIASES = {
    bangalore: ['bengaluru', 'blr'],
    mumbai: ['bombay'],
    kolkata: ['calcutta'],
    chennai: ['madras'],
    delhi: ['new delhi', 'ncr', 'delhi ncr'],
    hyderabad: ['hyd'],
    pune: ['pun'],
  };

  const normalizeCity = (c) => {
    const l = c.toLowerCase();
    for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
      if (l === canonical || aliases.some(a => l.includes(a) || a.includes(l))) return canonical;
    }
    return l;
  };

  const normCandCity = normalizeCity(candidateCity);
  const normJobCities = jobCities.map(normalizeCity);
  const isCityMatch = normJobCities.includes(normCandCity);

  // 2. Hybrid Job
  if (jobLocation.isHybrid) {
    if (isCityMatch) {
      return { score: 100, detail: `Hybrid role — candidate in ${candidateCity} (exact city match)` };
    }
    if (willingToRelocate) {
      return { score: 80, detail: 'Hybrid role in different city — candidate willing to relocate' };
    }
    return {
      score: 40,
      detail: `Hybrid role in ${candidateCity} — candidate not willing to relocate to ${jobCities.join('/')}`
    };
  }

  // 3. Onsite Job
  if (isCityMatch) {
    return { score: 100, detail: `Onsite role — candidate in ${candidateCity} (exact city match)` };
  }

  if (willingToRelocate) {
    return { score: 60, detail: 'Onsite role in different city — candidate willing to relocate' };
  }

  return {
    score: 10,
    detail: `Onsite role in ${candidateCity} — candidate not willing to relocate to ${jobCities.join('/')}`,
  };
}

/**
 * Score salary fit (0–100).
 */
function scoreSalary(candidate, jobSalary) {
  if (!jobSalary || (!jobSalary.max && !jobSalary.min)) {
    return { score: 100, detail: 'Salary range not published — not screened', skipped: true };
  }

  const rawExpected = candidate.expectedSalary ?? candidate.profile?.expectedSalary ?? candidate.currentSalary ?? candidate.profile?.currentSalary;
  const expected = normalizeSalaryToLPA(rawExpected);

  if (expected === null) {
    return { score: 50, detail: 'Candidate expected salary not provided — neutral score', skipped: true };
  }

  const jobMax = normalizeSalaryToLPA(jobSalary.max);
  const jobMin = normalizeSalaryToLPA(jobSalary.min) ?? 0;
  const negotiable = !!(jobSalary.isNegotiable);

  if (jobMin > 0 && expected < jobMin) {
    return { score: 100, detail: `Below budget minimum (${expected.toFixed(1)} LPA < ${jobMin.toFixed(1)} LPA) — flag as under-market` };
  }

  if (jobMax && expected <= jobMax) {
    return { score: 100, detail: `Within budget (${expected.toFixed(1)} LPA <= ${jobMax.toFixed(1)} LPA)` };
  }

  if (!jobMax) {
    return { score: 100, detail: 'No job max salary set — not screened on upper end', skipped: true };
  }

  const deltaPercent = Math.round(((expected / jobMax) - 1) * 100);

  if (deltaPercent <= 10 && negotiable) {
    return { score: 75, detail: `${deltaPercent}% above max — within negotiation range (negotiable)` };
  }
  if (deltaPercent <= 10) {
    return { score: 60, detail: `${deltaPercent}% above max — slight overage` };
  }
  if (deltaPercent <= 25) {
    return { score: 40, detail: `${deltaPercent}% above max — significant overage` };
  }
  return { score: 5, detail: `${deltaPercent}% above max — well over budget` };
}

/**
 * Score notice period fit (0–100).
 * Job field: expectedJoiningDate (multi-select array).
 */
function scoreNotice(candidate, jobExpectedJoiningDate) {
  const criteria = parseJobNoticeCriteria(jobExpectedJoiningDate);

  if (criteria.anyAccepted) {
    return { score: 100, detail: 'Job accepts any notice period' };
  }

  const candidateNpStr = candidate.noticePeriod || candidate.profile?.noticePeriod;
  const candidateDays = parseNoticeDays(candidateNpStr);

  if (candidateDays === null) {
    return { score: 50, detail: 'Candidate notice period not provided — neutral score', skipped: true };
  }

  const { maxDays, immediatePreferred } = criteria;

  if (maxDays !== null && candidateDays <= maxDays) {
    return { score: 100, detail: `Candidate notice (${candidateDays}d) within job maximum (${maxDays}d)` };
  }

  if (immediatePreferred && candidateDays <= 7) {
    return { score: 100, detail: 'Immediate joiner — matches requirement' };
  }

  if (immediatePreferred && candidateDays > 7) {
    if (candidateDays <= 30) return { score: 40, detail: `Job prefers immediate, candidate has ${candidateDays}d notice` };
    return { score: 20, detail: `Job prefers immediate, candidate has ${candidateDays}d notice — significant mismatch` };
  }

  if (maxDays === null) {
    return { score: 50, detail: 'Job notice criteria unclear — neutral score', skipped: true };
  }

  const over = candidateDays - maxDays;
  if (over <= 15) return { score: 60, detail: `Notice ${candidateDays}d — ${over}d over job max (${maxDays}d)` };
  if (over <= 30) return { score: 30, detail: `Notice ${candidateDays}d — ${over}d over job max (${maxDays}d)` };
  return { score: 10, detail: `Notice ${candidateDays}d — ${over}d over job max (${maxDays}d) — significant mismatch` };
}

/**
 * Score experience fit (0–100).
 */
function scoreExperience(candidate, experienceRange, strict = false) {
  if (!experienceRange || (experienceRange.min == null && experienceRange.max == null)) {
    return { score: 100, detail: 'Experience range not specified — not screened', skipped: true };
  }

  // STRICT: Candidate Form Data ONLY (Zero reliance on resume parsing)
  let candidateYears = null;
  const rawFormExp =
    candidate.totalExperience ??
    candidate.profile?.totalExperience ??
    candidate.relevantExperience ??
    candidate.profile?.relevantExperience;

  if (rawFormExp != null && rawFormExp !== '') {
    const parsed = Number(rawFormExp);
    if (!isNaN(parsed) && parsed >= 0) {
      candidateYears = parsed;
    }
  }

  if (candidateYears === null) {
    return { score: 50, detail: 'Experience data not available in form submission — neutral score', skipped: true };
  }

  const min = experienceRange.min ?? 0;
  const max = experienceRange.max ?? null;

  if (candidateYears >= min && (max === null || candidateYears <= max)) {
    return { score: 100, detail: `${candidateYears}yr within required range (${min}–${max !== null ? max : 'any'}yr)` };
  }

  if (candidateYears < min) {
    const gap = min - candidateYears;
    if (strict) return { score: 0, detail: `${candidateYears}yr — below minimum ${min}yr (strict filter active)` };
    if (gap <= 1) return { score: 70, detail: `${candidateYears}yr — ${gap.toFixed(1)}yr below minimum ${min}yr` };
    if (gap <= 3) return { score: 30, detail: `${candidateYears}yr — ${gap.toFixed(1)}yr below minimum ${min}yr` };
    return { score: 10, detail: `${candidateYears}yr — significant gap (${gap.toFixed(1)}yr below min ${min}yr)` };
  }

  if (max !== null && candidateYears > max) {
    const excess = candidateYears - max;
    if (excess <= 2) return { score: 90, detail: `${candidateYears}yr — slightly above max ${max}yr` };
    if (excess <= 5) return { score: 75, detail: `${candidateYears}yr — ${excess.toFixed(1)}yr above max ${max}yr (possibly overqualified)` };
    return { score: 50, detail: `${candidateYears}yr — ${excess.toFixed(1)}yr above max ${max}yr (possible flight risk)` };
  }

  return { score: 50, detail: 'Could not determine score — neutral fallback', skipped: true };
}

// ─── HARD FILTERS (Phase 4 — all disabled in Phase 1) ────────────────────────

function checkHardFilters(scores, candidate, job) {
  return { triggered: false, reason: null };
}

// ─── AGGREGATION ──────────────────────────────────────────────────────────────

function computePrescreenScore(subScores, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const total =
    (subScores.location   * w.location) +
    (subScores.salary     * w.salary) +
    (subScores.notice     * w.notice) +
    (subScores.experience * w.experience);
  return Math.round(total * 10) / 10;
}

function getPrescreenStatus(score) {
  if (score >= 60) return 'qualified';
  if (score >= 40) return 'borderline';
  return 'not_qualified';
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

function runPreScreen(candidate, job) {
  const jobPlain = job && job.toObject ? job.toObject() : (job || {});
  const candidatePlain = candidate && candidate.toObject ? candidate.toObject() : (candidate || {});

  const incompleteFields = [];

  const locResult    = scoreLocation(candidatePlain, jobPlain.location);
  const salResult    = scoreSalary(candidatePlain, jobPlain.salary);
  const noticeResult = scoreNotice(candidatePlain, jobPlain.expectedJoiningDate);
  const expResult    = scoreExperience(candidatePlain, jobPlain.experienceRange);

  if (locResult.skipped)    incompleteFields.push('location');
  if (salResult.skipped)    incompleteFields.push('salary');
  if (noticeResult.skipped) incompleteFields.push('notice_period');
  if (expResult.skipped)    incompleteFields.push('experience');

  const subScores = {
    location:   locResult.score,
    salary:     salResult.score,
    notice:     noticeResult.score,
    experience: expResult.score,
  };

  const weights = (jobPlain.screeningCriteria && jobPlain.screeningCriteria.custom_weights) || DEFAULT_WEIGHTS;
  const hardFilter = checkHardFilters(subScores, candidatePlain, jobPlain);

  let prescreen_score;
  let status;

  if (hardFilter.triggered) {
    prescreen_score = 0;
    status = 'not_qualified';
  } else {
    prescreen_score = computePrescreenScore(subScores, weights);
    status = getPrescreenStatus(prescreen_score);
  }

  return {
    computed_at: new Date(),
    location_score:   subScores.location,
    salary_score:     subScores.salary,
    notice_score:     subScores.notice,
    experience_score: subScores.experience,
    prescreen_score,
    status,
    hard_filter_triggered: hardFilter.triggered,
    hard_filter_reason:    hardFilter.reason || null,
    data_incomplete:   incompleteFields.length > 0,
    incomplete_fields: incompleteFields,
    location_detail:   locResult.detail,
    salary_detail:     salResult.detail,
    notice_detail:     noticeResult.detail,
    experience_detail: expResult.detail,
  };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  runPreScreen,
  scoreLocation,
  scoreSalary,
  scoreNotice,
  scoreExperience,
  checkHardFilters,
  computePrescreenScore,
  getPrescreenStatus,
  parseNoticeDays,
  parseJobNoticeCriteria,
  normalizeSalaryToLPA,
  DEFAULT_WEIGHTS,
};
