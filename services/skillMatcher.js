// backend/services/skillMatcher.js
// Deterministic skill normalization and matching.
// Called AFTER the AI extracts candidateProfile.skills from the resume —
// this module re-runs the matched/missing classification locally so the
// lists shown to admins are never hallucinated by the LLM.
//
// Consumers:
//   aiService.js  — calls matchSkills() to overwrite aiResult.rankingSignals
//   candidateScoringService.js — calls _skillMatches() (its own copy, pre-AI)

const Fuse = require('fuse.js');

// ─────────────────────────────────────────────────────────────────────────────
// ALIAS TABLE
// Each entry: canonical (index 0) → array of known aliases / supersets.
// Rules (mirror scoring-prompt.txt "SKILL ALIAS MATCHING"):
//   IDENTICAL  — any member of the same group matches any other
//   SUPERSET   — TypeScript→JavaScript, Next.js→React (handled via group membership)
//   NEVER      — Java ≠ JavaScript, Angular ≠ React, Manual ≠ Automation
// ─────────────────────────────────────────────────────────────────────────────
const ALIAS_GROUPS = [
  // ── JavaScript / Web ──────────────────────────────────────────────────────
  ['javascript', 'js', 'es6', 'es2015', 'ecmascript', 'vanilla js', 'vanilla javascript'],
  ['typescript', 'ts'],          // TS is a superset of JS but separate group (TS ≠ JS)
  ['node.js', 'nodejs', 'node'],
  ['react', 'reactjs', 'react.js'],
  ['next.js', 'nextjs', 'next'],
  ['angular', 'angularjs', 'angular.js'],
  ['vue', 'vue.js', 'vuejs', 'vue 3', 'vue 2'],
  ['nestjs', 'nest.js', 'nest'],
  ['express', 'express.js', 'expressjs'],
  ['svelte', 'sveltekit'],
  ['jquery'],
  ['webpack', 'vite', 'rollup'],           // bundlers — separate from frameworks
  // ── Java ecosystem ────────────────────────────────────────────────────────
  ['java'],                                // strict — never merges with JS
  ['kotlin'],
  ['spring', 'spring boot', 'spring-boot', 'springboot', 'spring framework'],
  ['hibernate', 'jpa'],
  ['maven', 'gradle'],
  // ── Python ────────────────────────────────────────────────────────────────
  ['python'],
  ['django'],
  ['flask'],
  ['fastapi'],
  ['pandas'],
  ['numpy'],
  ['scikit-learn', 'sklearn'],
  ['tensorflow', 'tf'],
  ['pytorch'],
  // ── C-family ──────────────────────────────────────────────────────────────
  ['c#', 'csharp', 'c sharp', 'dotnet c#'],
  ['c++', 'cpp'],
  ['c'],                                   // plain C — strict, no cross-matches
  // ── .NET ──────────────────────────────────────────────────────────────────
  ['.net', 'dotnet', 'asp.net', 'asp.net core', 'dot net'],
  // ── PHP / Ruby / Go / Rust ────────────────────────────────────────────────
  ['php', 'laravel', 'symfony'],           // grouped — php ecosystem
  ['ruby', 'ruby on rails', 'rails', 'ror'],
  ['go', 'golang'],
  ['rust'],
  // ── Databases (SQL) ───────────────────────────────────────────────────────
  ['sql'],
  ['mysql'],
  ['postgresql', 'postgres', 'pg'],
  ['mssql', 'sql server', 'microsoft sql server', 'ms sql'],
  ['sqlite'],
  ['oracle', 'oracle db', 'oracle database'],
  // ── Databases (NoSQL) ─────────────────────────────────────────────────────
  ['mongodb', 'mongo', 'mongoose'],
  ['redis'],
  ['cassandra'],
  ['elasticsearch', 'elastic search', 'opensearch'],
  ['firebase', 'firestore'],
  ['dynamodb'],
  // ── Cloud ─────────────────────────────────────────────────────────────────
  ['aws', 'amazon web services', 'amazon aws'],
  ['azure', 'microsoft azure', 'azure cloud'],
  ['gcp', 'google cloud', 'google cloud platform'],
  // ── DevOps / Infra ────────────────────────────────────────────────────────
  ['docker'],
  ['kubernetes', 'k8s'],
  ['terraform'],
  ['ansible'],
  ['jenkins'],
  ['github actions', 'gh actions'],
  ['gitlab ci', 'gitlab ci/cd'],
  ['ci/cd', 'cicd', 'continuous integration', 'continuous deployment'],
  ['nginx'],
  ['linux', 'unix'],
  // ── Version Control ───────────────────────────────────────────────────────
  ['git'],
  ['github'],
  ['gitlab'],
  ['bitbucket'],
  // ── Mobile ────────────────────────────────────────────────────────────────
  ['react native'],
  ['flutter'],
  ['swift'],
  ['android', 'android development'],
  ['ios', 'ios development'],
  // ── Web Markup / Style ────────────────────────────────────────────────────
  ['html', 'html5'],
  ['css', 'css3'],
  ['sass', 'scss'],
  ['tailwind', 'tailwindcss', 'tailwind css'],
  ['bootstrap'],
  ['material ui', 'mui'],
  // ── API ───────────────────────────────────────────────────────────────────
  ['rest', 'rest api', 'restful', 'restful api'],
  ['graphql'],
  ['grpc'],
  ['soap', 'soap api'],
  // ── Testing ───────────────────────────────────────────────────────────────
  ['selenium'],
  ['jest'],
  ['mocha'],
  ['cypress'],
  ['playwright'],
  ['junit'],
  ['pytest'],
  ['postman'],
  // ── Data / Analytics ──────────────────────────────────────────────────────
  ['power bi', 'powerbi'],
  ['tableau'],
  ['excel', 'ms excel', 'microsoft excel', 'google sheets', 'spreadsheets'],
  ['sql analytics', 'data analysis', 'data analytics'],
  ['looker'],
  // ── Design / Media ────────────────────────────────────────────────────────
  ['figma'],
  ['adobe xd', 'xd'],
  ['photoshop', 'adobe photoshop'],
  ['illustrator', 'adobe illustrator'],
  ['canva'],
  // ── Office / Productivity ─────────────────────────────────────────────────
  ['powerpoint', 'ms powerpoint', 'microsoft powerpoint', 'google slides'],
  ['word', 'ms word', 'microsoft word', 'google docs'],
  ['outlook', 'ms outlook', 'microsoft outlook'],
  ['google workspace', 'g suite'],
  ['microsoft office', 'ms office', 'office 365'],
  // ── ERP / CRM ─────────────────────────────────────────────────────────────
  ['tally', 'tally erp', 'tally prime', 'tally erp 9'],
  ['sap', 'sap erp', 'sap s/4hana'],
  ['salesforce', 'sfdc', 'salesforce crm'],
  ['zoho', 'zoho crm'],
  ['hubspot'],
  ['dynamics 365', 'microsoft dynamics', 'ms dynamics'],
  // ── HR Specific ───────────────────────────────────────────────────────────
  ['hrms', 'hrm', 'hr software', 'hris', 'human resource management system'],
  ['recruitment', 'talent acquisition', 'hiring', 'sourcing', 'head hunting'],
  ['payroll', 'payroll management', 'payroll processing'],
  ['performance management', 'pms', 'appraisal'],
  ['onboarding'],
  ['employee relations', 'er'],
  ['labour law', 'labor law', 'employment law', 'statutory compliance'],
  ['pf', 'provident fund', 'epf'],
  ['esi', 'employee state insurance'],
  // ── Sales / Business Development ─────────────────────────────────────────
  ['business development', 'bd', 'biz dev'],
  ['lead generation', 'lead gen'],
  ['cold calling', 'tele-calling', 'telecalling'],
  ['client relationship management', 'crm management', 'account management'],
  ['b2b sales', 'b2b'],
  ['b2c sales', 'b2c'],
  ['inside sales'],
  ['field sales', 'outside sales'],
  ['negotiation', 'negotiation skills'],
  // ── Marketing ─────────────────────────────────────────────────────────────
  ['digital marketing'],
  ['seo', 'search engine optimization'],
  ['sem', 'search engine marketing', 'google ads', 'ppc'],
  ['social media marketing', 'smm', 'social media management'],
  ['content marketing', 'content writing', 'copywriting'],
  ['email marketing'],
  ['affiliate marketing'],
  // ── Finance / Accounting ──────────────────────────────────────────────────
  ['accounting', 'accounts'],
  ['bookkeeping'],
  ['financial analysis', 'financial modelling', 'financial modeling'],
  ['budgeting', 'budget management'],
  ['taxation', 'tax', 'gst', 'income tax', 'tds'],
  ['auditing', 'audit'],
  ['accounts payable', 'ap'],
  ['accounts receivable', 'ar'],
  ['ifrs', 'gaap', 'ind as'],
  ['chartered accountant', 'ca', 'cpa'],
  // ── Operations / Supply Chain ─────────────────────────────────────────────
  ['supply chain', 'supply chain management', 'scm'],
  ['inventory management', 'inventory control'],
  ['logistics', 'logistics management'],
  ['procurement', 'vendor management', 'purchasing'],
  ['warehouse management', 'warehousing'],
  ['quality control', 'qc', 'quality assurance', 'qa'],
  ['lean', 'six sigma', 'lean six sigma'],
  ['project management', 'pm'],
  ['pmp', 'prince2'],
  ['agile', 'scrum', 'kanban'],
  ['jira'],
  ['ms project', 'microsoft project'],
  // ── Healthcare ────────────────────────────────────────────────────────────
  ['medical coding', 'icd coding'],
  ['emr', 'ehr', 'electronic health records'],
  ['clinical research', 'clinical trials'],
  ['pharmacovigilance'],
  // ── Legal ─────────────────────────────────────────────────────────────────
  ['contract management', 'contract drafting'],
  ['corporate law'],
  ['compliance', 'regulatory compliance'],
  // ── Communication / Soft Skills ───────────────────────────────────────────
  ['communication', 'communication skills'],
  ['presentation', 'presentation skills'],
  ['leadership', 'team leadership'],
  ['team management', 'people management'],
  ['problem solving', 'analytical thinking', 'critical thinking'],
  ['customer service', 'customer support', 'customer success'],
];

// Build a flat lookup map: normalized alias → canonical (first item in group)
const _aliasMap = new Map();
for (const group of ALIAS_GROUPS) {
  const canonical = group[0];
  for (const alias of group) {
    _aliasMap.set(alias, canonical);
  }
}

// Short tokens that must NEVER be matched via substring containment
const _ambiguousTokens = new Set([
  'c', 'r', 'go', 'js', 'ts', 'db', 'qa', 'pm', 'ca', 'ap', 'ar',
  'bd', 'er', 'pf', 'sa', 'ui', 'ux', 'ai', 'ml', 'bi',
]);

// ─────────────────────────────────────────────────────────────────────────────
// normalizeSkill(rawSkillString) → canonical lowercase string
// ─────────────────────────────────────────────────────────────────────────────
function normalizeSkill(raw) {
  if (!raw || typeof raw !== 'string') return '';
  // Lowercase, collapse whitespace, strip leading/trailing punctuation
  let s = raw.toLowerCase().trim().replace(/\s+/g, ' ').replace(/^[^\w]+|[^\w]+$/g, '');
  // Normalize common punctuation variants: node.js → node.js (keep dots for aliases),
  // but strip trailing dots/dashes used as separators
  s = s.replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-');
  // Look up alias map
  return _aliasMap.get(s) ?? s;
}

// ─────────────────────────────────────────────────────────────────────────────
// _matches(jdCanonical, candidateCanonicals) → boolean
// Single-skill matching: exact/alias/word-boundary containment only.
// NEVER direction: jdSkill.includes(candidateSkill) — prevents java→javascript.
// ─────────────────────────────────────────────────────────────────────────────
function _matches(jdCanonical, candidateCanonicals) {
  const candSet = new Set(candidateCanonicals);

  // 1. Exact canonical match (both already normalized through alias map)
  if (candSet.has(jdCanonical)) return true;

  // 2. Word-boundary containment: candidateSkill CONTAINS jdSkill as a whole phrase
  //    e.g. JD needs "react" → candidate has "react native" → match
  //    Only for skills ≥ 4 chars AND not a known ambiguous short token
  if (jdCanonical.length >= 4 && !_ambiguousTokens.has(jdCanonical)) {
    const escaped = jdCanonical.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const re = new RegExp(`(^|[\\s/\\-\\.])${escaped}([\\s/\\-\\.]|$)`);
    if ([...candSet].some(cs => re.test(cs) || cs === jdCanonical)) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY SECOND-CHANCE MATCHER
// Near-variants / typos not covered by ALIAS_GROUPS (e.g. "Postgre SQL" →
// "postgresql", "NodeJS" → "node.js"). Uses fuse.js to catch fuzzy matches
// that deterministic _matches() misses.
// ─────────────────────────────────────────────────────────────────────────────
const FUSE_THRESHOLD = 0.4;   // Fuse scores are in [0,1]; lower = stricter

// Build the Fuse index ONCE per candidate skill list (not per JD skill).
// matchSkills() calls this a single time and reuses the index for every
// missing JD skill — previously a fresh index was compiled per call.
function _buildFuse(candidateSkills) {
  const list = (candidateSkills || [])
    .map(normalizeSkill)
    .filter(Boolean);
  if (list.length === 0) return null;
  return new Fuse(list, {
    includeScore: true,
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true,
    minMatchCharLength: 3,
  });
}

function _fuzzyMatch(jdSkill, fuse) {
  if (!fuse) return false;
  const query = normalizeSkill(jdSkill);
  // Length gate: prevent short tokens like "java"/"js" from fuzzy-matching
  // longer words like "javascript".
  if (query.replace(/[^a-z0-9]/gi, '').length < 5) return false;

  const hits = fuse.search(query);
  return hits.length > 0 && hits[0].score <= FUSE_THRESHOLD;
}

// ─────────────────────────────────────────────────────────────────────────────
// matchSkills(candidateSkills, jdSkills) → classification object
//
// candidateSkills: string[]  (from AI-extracted candidateProfile.skills)
// jdSkills: { mustHave: string[], shouldHave: string[], niceToHave: string[] }
//
// Returns:
// {
//   mustHaveMatched:       string[],  // original JD strings that matched
//   mustHaveMissing:       string[],  // original JD strings that did NOT match
//   shouldHaveMatched:     string[],
//   niceToHaveMatched:     string[],
//   mustHaveCoveragePercent: number   // 0–100
// }
// ─────────────────────────────────────────────────────────────────────────────
function matchSkills(candidateSkills, jdSkills) {
  const { mustHave = [], shouldHave = [], niceToHave = [] } = jdSkills || {};

  // Normalize candidate skills once
  const candNorm = (candidateSkills || []).map(normalizeSkill).filter(Boolean);
  // Build the fuzzy index ONCE for the whole candidate list (perf fix).
  const fuse = _buildFuse(candidateSkills);

  const classify = (skillList) => {
    const matched = [];
    const missing = [];
    for (const skill of skillList) {
      const norm = normalizeSkill(skill);
      if (!norm) continue;
      if (_matches(norm, candNorm) || _fuzzyMatch(skill, fuse)) {
        matched.push(skill);
      } else {
        missing.push(skill);
      }
    }
    return { matched, missing };
  };

  const mustResult  = classify(mustHave);
  const shouldResult = classify(shouldHave);
  const niceResult  = classify(niceToHave);

  const total = mustHave.length;
  const coverage = total > 0
    ? Math.round((mustResult.matched.length / total) * 100)
    : 100;

  return {
    mustHaveMatched:          mustResult.matched,
    mustHaveMissing:          mustResult.missing,
    shouldHaveMatched:        shouldResult.matched,
    shouldHaveMissing:        shouldResult.missing,
    niceToHaveMatched:        niceResult.matched,
    mustHaveCoveragePercent:  coverage,
  };
}

module.exports = { normalizeSkill, matchSkills, ALIAS_GROUPS, _ambiguousTokens };
