/**
 * educationUtils.js
 * Single source of truth for the education qualification hierarchy.
 * Used by candidateScoringService.js and aiService.js.
 *
 * Levels: 0 (lowest) → 5 (highest)
 */

// ── Education hierarchy ──────────────────────────────────────────────────────
const EDU_LEVELS = [
  // Level 0 — Secondary (10th)
  ['10th', '10th pass', 'ssc', 'matriculation', 'matric', 'secondary', '10'],

  // Level 1 — Higher Secondary (12th)
  ['12th', '12th pass', 'hsc', 'higher secondary', 'intermediate', 'puc',
   'plus two', '+2', '12', 'senior secondary'],

  // Level 2 — Diploma / Vocational / Industry Certifications
  // Includes: polytechnic diplomas, ITI, trade certs, and industry certs
  // (PMP, Six Sigma, cloud certs, CCNA, CISSP, etc.)
  ['diploma', 'polytechnic', 'iti', 'iti certificate', 'vocational',
   'pgd', 'pgdca', 'post graduate diploma', 'postgraduate diploma',
   'pmp', 'project management professional',
   'six sigma', 'green belt', 'black belt',
   'itil', 'itil foundation', 'itil certification',
   'aws certified', 'aws certification', 'azure certified', 'azure certification',
   'gcp certified', 'gcp certification', 'google cloud certified',
   'ccna', 'ccnp', 'cisco certified',
   'cissp', 'cisa', 'cism', 'comptia',
   'certificate course', 'diploma course'],

  // Level 3 — Bachelor's / Undergraduate / LLB
  ['bachelor', "bachelor's", 'bachelors', 'undergraduate', 'ug', 'graduate',
   'ba', 'bsc', 'bcom', 'bba', 'bca', 'btech', 'be', 'barch', 'bpharm',
   'bacheloroftechnology', 'bachelorofengineering', 'bachelorofscience',
   'bachelorofcommerce', 'bachelorofbusinessadministration',
   'bachelorofcomputerapplications',
   'llb', 'bachelor of laws', 'blaw', 'bl',
   'mbbs', 'bds', 'bhms', 'bams', 'bvsc',
   'b.ed', 'bed', 'bachelorofeducation'],

  // Level 4 — Master's / Postgraduate / Professional Qualifications
  // Professional: CA, CS, CMA, CFA, ACCA, CPA, FRM, CFP, Actuary, Chartered Engineer
  // These are treated as PG-equivalent (require degree + multi-year exams)
  ['master', "master's", 'masters', 'postgraduate', 'pg', 'mba', 'mca',
   'mtech', 'me', 'ma', 'msc', 'mcom', 'mpharm', 'pgdm', 'pgdbm',
   'masteroftechnology', 'masterofengineering', 'masterofscience',
   'masterofcommerce', 'masterofbusinessadministration',
   'masterofcomputerapplications',
   'llm', 'master of laws',
   'md', 'ms medicine', 'mvsc', 'master of surgery',
   'm.ed', 'med', 'masterofeducation',
   // Chartered / Professional Qualifications (India + Global)
   'ca', 'chartered accountant', 'icai',
   'cs', 'company secretary', 'icsi',
   'cma', 'cost and management accountant', 'icmai', 'icwa',
   'cfa', 'chartered financial analyst', 'cfa institute',
   'acca', 'association of chartered certified accountants',
   'cpa', 'certified public accountant',
   'frm', 'financial risk manager', 'garp',
   'cfp', 'certified financial planner',
   'actuary', 'fia', 'aiai', 'fellow actuary', 'associate actuary',
   'institute of actuaries',
   'chartered engineer', 'institution of engineers'],

  // Level 5 — Doctorate / PhD
  ['phd', 'doctorate', 'doctorofphilosophy', 'dsc', 'fellow',
   'd.litt', 'dlitt', 'doctor of science', 'doctor of letters'],
];

/**
 * Returns the numeric education level (0–5) for a given degree string.
 * Returns -1 if the degree cannot be classified.
 *
 * @param {string} degreeStr - e.g. "MCA in Computer Application", "BE in Computer Science", "B.Tech"
 * @returns {number} level index or -1
 */
function getEduLevel(degreeStr) {
  if (!degreeStr || typeof degreeStr !== 'string') return -1;

  const rawClean = degreeStr.toLowerCase().trim();
  const noDots = rawClean.replace(/\./g, '');
  const collapsed = noDots.replace(/[^a-z0-9+]/g, '');

  for (let lvl = EDU_LEVELS.length - 1; lvl >= 0; lvl--) {
    const found = EDU_LEVELS[lvl].some(alias => {
      const aRaw = alias.toLowerCase().trim();
      const aNoDots = aRaw.replace(/\./g, '');
      const aCollapsed = aNoDots.replace(/[^a-z0-9+]/g, '');

      // 1. Exact match against collapsed string
      if (collapsed === aCollapsed) return true;

      // 2. Word boundary match on normalized string (e.g. \bmca\b in "mca in computer application")
      const escaped = aNoDots.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const wordRegex = new RegExp(`(?:^|[^a-z0-9+])${escaped}(?:$|[^a-z0-9+])`, 'i');
      if (wordRegex.test(noDots) || wordRegex.test(rawClean)) return true;

      // 3. Substring match for longer multi-word phrases (>= 4 chars)
      if (aCollapsed.length >= 4) {
        if (collapsed.includes(aCollapsed) || aCollapsed.includes(collapsed)) return true;
      }

      return false;
    });
    if (found) return lvl;
  }
  return -1;
}

module.exports = { EDU_LEVELS, getEduLevel };

