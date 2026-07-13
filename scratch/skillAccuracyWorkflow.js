export const meta = {
  name: 'skill-matching-accuracy-overhaul',
  description: 'Implement 5 fixes (C,B,A,E,D) to improve AI resume<->JD skill-matching accuracy and efficiency in the Syncro1 backend, then verify.',
  phases: [
    { title: 'Implement skillMatcher fuzzy (Fix C)' },
    { title: 'Implement aiService + compressor fixes (B,A,E,D)' },
    { title: 'Verify all fixes' },
  ],
};

const BK = '/run/media/yogesh/48baf8b0-8ae7-40cf-868c-a10a28da42ab/Syncro1/Syncro1_Backend';

// ── Agent 1: Fix C — Fuse.js fuzzy second-chance matching in skillMatcher.js ──
const c = await agent(
`You are improving skill-matching accuracy in a Node.js/Express backend (CommonJS). Edit ONLY the file below; do not touch scoring weights or skill-gate logic.

FILE: ${BK}/services/skillMatcher.js
Context: This file already has ALIAS_GROUPS (domain-aware synonym groups), normalizeSkill(), _matches() (exact/alias/word-boundary), and matchSkills(). fuse.js is already installed in node_modules. We are adding a FUZZY second-chance matcher so near-variants/typos not in ALIAS_GROUPS still match (e.g. "Postgre SQL" -> "postgresql", "NodeJS" -> "node.js").

STEPS:
1. Add at the very top (right after the header comment, before ALIAS_GROUPS):
   const Fuse = require('fuse.js');

2. Add a module-level constant and helper, placed immediately BEFORE the existing "function matchSkills(" definition:
   - const FUSE_THRESHOLD = 0.4;   // Fuse scores are in [0,1]; lower = stricter
   - function _fuzzyMatch(jdSkill, candidateSkills) that:
       * builds a normalized list from candidateSkills via normalizeSkill() and filters out empties;
       * if that list is empty, returns false;
       * creates a Fuse index over the list with options { includeScore: true, threshold: FUSE_THRESHOLD, ignoreLocation: true, minMatchCharLength: 3 };
       * searches using normalizeSkill(jdSkill);
       * returns true ONLY if there is at least one hit AND that hit's score <= FUSE_THRESHOLD AND the alphanumeric length of normalizeSkill(jdSkill) is >= 5. (The length gate prevents short tokens like "java" or "js" from fuzzy-matching longer words like "javascript".)

3. In the existing matchSkills() function, find the inner "classify" closure. It currently does something like:
       (_matches(norm, candNorm) ? matched : missing).push(skill);
   Change it so that:
       - if _matches(norm, candNorm) is true -> push skill to matched;
       - else if _fuzzyMatch(skill, candidateSkills) is true -> ALSO push skill to matched (second chance);
       - else -> push skill to missing.
   Note: candidateSkills (the function parameter) is already in scope inside classify.

Do NOT modify ALIAS_GROUPS, normalizeSkill, or _matches.

After editing, from the backend directory run:
   node --check services/skillMatcher.js
   node -e "const {matchSkills}=require('./services/skillMatcher'); const r=matchSkills(['PostgreSQL','Node.js','React'],{mustHave:['Postgre SQL','NodeJS','ReactJS'],shouldHave:[],niceToHave:[]}); console.log('MATCHED',JSON.stringify(r.mustHaveMatched)); console.log('MISSING',JSON.stringify(r.mustHaveMissing)); const neg=matchSkills(['JavaScript'],{mustHave:['Java']}); console.log('NEG_MISSING',JSON.stringify(neg.mustHaveMissing));"
Expected: MATCHED contains all three JD skills, MISSING is empty, NEG_MISSING contains 'Java' (no false match). Fix any syntax errors. Report exactly what you changed.`,
  { label: 'fix-c-skillmatcher', phase: 'Implement skillMatcher fuzzy (Fix C)' }
);

// ── Agent 2: Fixes B, A, E, D — aiService.js + resumeCompressor.js ──
const b = await agent(
`You are improving skill-matching accuracy + efficiency in a Node.js/Express backend (CommonJS). Edit ONLY the files below. Do NOT change scoring weights (0.30/0.20/...) or the skill-gate logic. Implement changes IN THIS ORDER, reading each file first.

FILE 1: ${BK}/services/aiService.js
It currently: requires './skillMatcher' (line ~6), has const AI_MAX_TOKENS = 4096 (line ~9), extracts resume text capped at 14000 chars, builds a prompt that truncates resume to 14000 via resumeText.substring(0, 14000), and has parseResume() which calls _applyDeterministicSkillMatch(aiResult, resolvedSkills).

=== CHANGE B (fix truncation) ===
B1. In _getResumeText, find "const MAX_CHARS = 14000;" and change to "const MAX_CHARS = 30000;".
B2. In _buildAdvancedPrompt, find the line ".replace('{{resumeText}}', resumeText.substring(0, 14000))" and change it to ".replace('{{resumeText}}', resumeText)" — send the full (already compressed) text, do NOT truncate again.
B3. In FILE 2 ${BK}/services/resumeCompressor.js, find BOTH occurrences of "resumeText.substring(0, 14000)" (they are in the fallback paths) and change each to "resumeText.substring(0, 30000)".

=== CHANGE A (deterministic skill sweep — guarantees recall) ===
A1. Change the import at line ~6 from:
       const { matchSkills } = require('./skillMatcher');
    to:
       const { matchSkills, normalizeSkill, ALIAS_GROUPS } = require('./skillMatcher');
A2. Add a new method _deterministicSkillSweep(text, formSkills) to the AIService class, placed IMMEDIATELY BEFORE the existing _applyDeterministicSkillMatch method. Behavior:
       - Build a flat array of every term from ALIAS_GROUPS (all groups, all aliases).
       - Lowercase the input text into a haystack string.
       - For each term (skip terms whose alphanumeric length < 2): escape regex special characters, then test for a whole-word / non-alphanumeric-boundary match in the haystack, case-insensitive. Collect matched terms into a Set.
       - Also add every entry of formSkills (partner-reported skills) after passing it through normalizeSkill().
       - Return Array.from(theSet).
A3. In parseResume, find the line "aiResult = this._applyDeterministicSkillMatch(aiResult, resolvedSkills);" (inside the try, after the parse/retry block). Insert BEFORE it a block that:
       - const swept = this._deterministicSkillSweep(resumeText, candidateFormData.skills);
       - const aiSkills = (aiResult.candidateProfile?.skills || []).filter(Boolean);
       - aiResult.candidateProfile = aiResult.candidateProfile || {};
       - aiResult.candidateProfile.skills = [...new Set([...aiSkills, ...swept])];
    This ensures the deterministic matcher sees skills the LLM may have omitted.

=== CHANGE E (caching for efficient AI use) ===
E1. Near the top of the file (after the existing requires/constants), add:
       const crypto = require('crypto');
       const WEIGHTS_VERSION = 2;
       const _scoreCache = new Map();
       const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    and a helper function:
       function _scoreCacheKey(resumeUrl, jobId, formSkills) {
         return crypto.createHash('sha256').update(resumeUrl + '|' + jobId + '|' + JSON.stringify(formSkills || []) + '|v' + WEIGHTS_VERSION).digest('hex');
       }
E2. In parseResume, AFTER the OpenAI availability check (the "if (!openai) { ... return this._getEmptyResumeData(); }" block, around line 35) and BEFORE building the prompt, add:
       const ck = _scoreCacheKey(resumeUrl, jobDescription?._id, candidateFormData.skills);
       const _cached = _scoreCache.get(ck);
       if (_cached && (Date.now() - _cached.ts) < CACHE_TTL_MS) {
         console.log('[AI] Cache hit — returning prior scoring result');
         return _cached.result;
       }
E3. In the success return block (the "return { success: true, data: structuredData, fullAnalysis: aiResult, confidence: this._buildConfidence(aiResult), provider: 'openai', model, tokensUsed }" near line 95), BEFORE the return statement, store:
       _scoreCache.set(ck, { ts: Date.now(), result: { success: true, data: structuredData, fullAnalysis: aiResult, confidence: this._buildConfidence(aiResult), provider: 'openai', model, tokensUsed } });
    Do NOT cache the error/empty (_getEmptyResumeData) path.

=== CHANGE D (output budget) ===
D1. At the top constants, change "const AI_MAX_TOKENS = 4096;" to "const AI_MAX_TOKENS = 8000;". (gpt-4o-mini supports larger output; prevents the big scoring JSON from truncating the skills/rankingSignals arrays.)

After all edits, from the backend directory run:
   node --check services/aiService.js && node --check services/resumeCompressor.js
Fix any syntax errors. Report exactly which lines/sections you changed.`,
  { label: 'fix-baed-aiservice', phase: 'Implement aiService + compressor fixes (B,A,E,D)' }
);

// ── Agent 3: Verifier ──
const v = await agent(
`You are verifying backend changes made by prior agents to improve AI resume<->JD skill-matching accuracy. READ-ONLY: do NOT edit any files. Run commands and report results.

WORKING DIR: ${BK}

Run from that directory and capture outputs:

1. Syntax check:
   node --check services/skillMatcher.js && node --check services/aiService.js && node --check services/resumeCompressor.js
   Confirm all three pass.

2. Fix C functional test (skillMatcher fuzzy):
   node -e "const {matchSkills}=require('./services/skillMatcher'); const r=matchSkills(['PostgreSQL','Node.js','React'],{mustHave:['Postgre SQL','NodeJS','ReactJS'],shouldHave:[],niceToHave:[]}); console.log('MATCHED',JSON.stringify(r.mustHaveMatched)); console.log('MISSING',JSON.stringify(r.mustHaveMissing)); const neg=matchSkills(['JavaScript'],{mustHave:['Java']}); console.log('NEG_MISSING',JSON.stringify(neg.mustHaveMissing));"
   Expected: MATCHED contains all three; MISSING empty; NEG_MISSING contains 'Java'.

3. Fix A functional test (aiService deterministic sweep + module load):
   node -e "const ai=require('./services/aiService'); console.log('sweepFn',typeof ai._deterministicSkillSweep); console.log('sweep',JSON.stringify(ai._deterministicSkillSweep('experienced with postgresql and nodejs and react',[])));"
   Expected: sweepFn === 'function'; sweep returns an array including 'postgresql' and 'node.js'.

4. Fix D: read services/aiService.js and confirm AI_MAX_TOKENS is 8000 (not 4096).

5. Fix B: confirm _getResumeText uses MAX_CHARS = 30000, _buildAdvancedPrompt uses resumeText (no .substring(0, 14000)), and resumeCompressor.js no longer uses substring(0, 14000) (should be 30000).

6. Fix E: confirm crypto is required, _scoreCache/CACHE_TTL_MS/WEIGHTS_VERSION exist, and parseResume has a cache lookup + store.

Report a concise PASS/FAIL checklist for Fixes C, B, A, E, D with actual observed outputs. If anything fails, state exactly what failed and the likely file:line.`,
  { label: 'verify-fixes', phase: 'Verify all fixes' }
);

return { c, b, v };
