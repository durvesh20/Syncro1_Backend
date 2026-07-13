// backend/services/aiService.js
const { getOpenAI, getModel } = require('../config/ai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { matchSkills, normalizeSkill, ALIAS_GROUPS, _ambiguousTokens } = require('./skillMatcher');

// ── Constants ──────────────────────────────────────────────────────────────
const AI_MAX_TOKENS = 8000;   // raised from 3000 to prevent truncation (D1: 4096 → 8000)

// ── Caching for efficient AI use (Change E) ─────────────────────────────────
const crypto = require('crypto');
const WEIGHTS_VERSION = 2;
const _scoreCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500; // hard memory bound: evict oldest when full

// Bounded insert — once we hit the cap, evict the oldest entry (Map preserves
// insertion order) so the cache can NEVER grow unbounded and exhaust memory.
// Each entry holds the full AI analysis (~10–50KB), so 500 ≈ ≤12MB max.
function _cacheSet(key, value) {
  if (_scoreCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = _scoreCache.keys().next().value;
    if (oldest !== undefined) _scoreCache.delete(oldest);
  }
  _scoreCache.set(key, value);
}

// Periodic sweep: drop expired entries so the Map doesn't accumulate dead
// weight. .unref() so this timer never keeps the Node process alive on its own.
const _cacheSweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _scoreCache) {
    if (now - v.ts > CACHE_TTL_MS) _scoreCache.delete(k);
  }
}, 30 * 60 * 1000);
if (_cacheSweep && typeof _cacheSweep.unref === 'function') _cacheSweep.unref();

function _scoreCacheKey(resumeUrl, jobId, formSkills) {
  return crypto.createHash('sha256')
    .update(resumeUrl + '|' + jobId + '|' + JSON.stringify(formSkills || []) + '|v' + WEIGHTS_VERSION)
    .digest('hex');
}

// ── Deterministic skill-sweep precompiled term list (Change A perf + safety) ──
// Built ONCE (module lifetime). Skips ambiguous short tokens (_ambiguousTokens)
// and terms with alphanumeric length < 2, so the sweep cannot add FALSE skills
// like "adobe illustrator" from a resume that merely says "AI", or "golang"
// from the word "go". The long canonical terms (e.g. "adobe illustrator",
// "golang") are still matched when the resume contains the full phrase.
let _sweepTerms = null;
function _buildSweepTerms() {
  const raw = [];
  for (const group of ALIAS_GROUPS) {
    if (Array.isArray(group)) raw.push(...group);
    else if (typeof group === 'string') raw.push(group);
  }
  _sweepTerms = raw
    .map((t) => String(t).trim().toLowerCase())
    .filter((tl) => tl.replace(/[^a-z0-9]/g, '').length >= 2 && !_ambiguousTokens.has(tl))
    .map((tl) => {
      const escaped = tl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return { term: tl, re: new RegExp('(^|[^a-z0-9])' + escaped + '($|[^a-z0-9])', 'i') };
    });
}

class AIService {
    constructor() {
        this.enabled = process.env.AI_ENABLED === 'true';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC — parseResume (orchestrator, signature unchanged)
    // ═══════════════════════════════════════════════════════════════════════
    async parseResume(resumeUrl, fileName = '', candidateFormData = {}, jobDescription = {}) {
        console.log('\n========================================');
        console.log('[AI] parseResume called with:');
        console.log('  - resumeUrl:', resumeUrl);
        console.log('  - fileName:', fileName);
        console.log('  - candidateFormData keys:', Object.keys(candidateFormData));
        console.log('  - jobDescription._id:', jobDescription?._id);
        console.log('  - AI enabled:', this.enabled);
        console.log('========================================\n');

        if (!this.enabled) {
            console.log('[AI] Resume parsing disabled');
            return this._getEmptyResumeData();
        }

        const openai = getOpenAI();
        if (!openai) {
            console.log('[AI] OpenAI not configured');
            return this._getEmptyResumeData();
        }

        const ck = _scoreCacheKey(resumeUrl, jobDescription?._id, candidateFormData.skills);
        const _cached = _scoreCache.get(ck);
        if (_cached && (Date.now() - _cached.ts) < CACHE_TTL_MS) {
            console.log('[AI] Cache hit — returning prior scoring result');
            return _cached.result;
        }

        let prompt;
        try {
            // ── Stage 1: resume text ──────────────────────────────────────
            const resumeText = await this._getResumeText(resumeUrl);
            if (!resumeText || resumeText.trim().length < 30) {
                console.warn('[AI] Could not extract enough text from resume');
                return this._getEmptyResumeData();
            }
            console.log(`[AI] Extracted ${resumeText.length} chars from resume`);

            // ── Stage 2: job description text + resolved skill tiers ─────
            const { text: jobDescriptionText, resolvedSkills } = await this._getJobDescriptionText(jobDescription);

            // ── Stage 3: build prompt ─────────────────────────────────────
            prompt = this._buildAdvancedPrompt(candidateFormData, resumeText, jobDescriptionText);

            // ── Stage 4: call AI (with truncation + parse retry) ──────────
            const { responseText, tokensUsed, model } = await this._callAI(prompt);

            // ── Stage 5: parse + validate ─────────────────────────────────
            let aiResult;
            try {
                aiResult = this._parseAndValidate(responseText);
            } catch (parseErr) {
                console.warn('[AI] First parse failed, retrying once…');
                const retry = await this._callAI(prompt);
                aiResult = this._parseAndValidate(retry.responseText);
            }

            // ── Stage 5b: deterministic skill sweep (guarantees recall) ──
            // Catch skills the LLM may have omitted (e.g. buried in resume text
            // or only reported by the partner form) before deterministic correction.
            const swept = this._deterministicSkillSweep(resumeText, candidateFormData.skills);
            const aiSkills = (aiResult.candidateProfile?.skills || []).filter(Boolean);
            aiResult.candidateProfile = aiResult.candidateProfile || {};
            aiResult.candidateProfile.skills = [...new Set([...aiSkills, ...swept])];

            // ── Stage 6: deterministic skill overwrite (skillMatcher) ─────
            // Pass resolvedSkills (same source used to build the prompt) so the
            // corrector always reads from the same skill tier arrays the AI saw.
            aiResult = this._applyDeterministicSkillMatch(aiResult, resolvedSkills);

            // ── Stage 7: structure result ─────────────────────────────────
            const structuredData = this._structureAIResult(aiResult, candidateFormData);

            // ── Stage 8: log success ──────────────────────────────────────
            const ScoringLog = require('../models/ScoringLog');
            await ScoringLog.create({
                logType: 'SCORING',
                applicationId: candidateFormData.candidateId || null,
                promptSent: prompt,
                rawResponse: responseText,
                parsedScore: aiResult.scoring?.finalAdjustedScore || 0,
                success: true
            }).catch(err => console.error('[AI] Failed to write success scoring log:', err.message));

            console.log(`[AI] ✅ Analysis complete!`);
            console.log(`   Candidate: ${candidateFormData.firstName} ${candidateFormData.lastName}`);
            console.log(`   Final Score: ${aiResult.scoring?.finalAdjustedScore}/100`);
            console.log(`   Match Level: ${aiResult.matchLevel}`);
            console.log(`   Decision: ${aiResult.recommendation?.decision}`);
            console.log(`   Skills Coverage: ${aiResult.scoring?.skillCoveragePercent}%`);

            const successResult = {
                success: true,
                data: structuredData,
                fullAnalysis: aiResult,
                confidence: this._buildConfidence(aiResult),
                provider: 'openai',
                model,
                tokensUsed
            };
            _cacheSet(ck, { ts: Date.now(), result: successResult });

            return successResult;

        } catch (error) {
            console.error(`[AI] ❌ Resume parsing failed: ${error.message}`);
            if (error.status === 429) console.error('[AI] Rate limit exceeded');
            else if (error.status === 401) console.error('[AI] Invalid API key');

            const ScoringLog = require('../models/ScoringLog');
            await ScoringLog.create({
                logType: 'SCORING',
                applicationId: candidateFormData.candidateId || null,
                promptSent: typeof prompt !== 'undefined' ? prompt : 'Prompt building failed',
                rawResponse: null,
                success: false,
                error: error.message
            }).catch(err => console.error('[AI] Failed to write error scoring log:', err.message));

            return this._getEmptyResumeData();
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE — sub-methods (independently testable)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Extract + compress resume text from URL.
     * No AI involved — pure text logic.
     */
    async _getResumeText(resumeUrl) {
        let text = await this._extractTextFromUrl(resumeUrl);
        const MAX_CHARS = 30000;
        if (text && text.length > MAX_CHARS) {
            const { compressResumeText } = require('./resumeCompressor');
            text = await compressResumeText(text);
        }
        return text;
    }

    /**
     * Build job description text AND return the resolved skill tier arrays.
     * Returns { text: string, resolvedSkills: { mustHave, shouldHave, niceToHave } }
     *
     * Priority:
     *   1. parsedRequirements from JobPosition (same source as the prompt)
     *   2. Raw job document skills arrays
     *   3. Empty arrays (no skills found — logged as a warning)
     */
    async _getJobDescriptionText(jobDescription) {
        const rawJobObj = jobDescription?.toObject ? jobDescription.toObject() : (jobDescription || {});

        try {
            const { getOrParseJobPosition } = require('./jobPositionParser');
            const jobPosition = await getOrParseJobPosition(jobDescription);
            if (jobPosition?.parsedRequirements) {
                console.log(`[AI] Using structured JobPosition for job ${rawJobObj._id}`);
                const pr = jobPosition.parsedRequirements;
                const resolvedSkills = {
                    mustHave:   Array.isArray(pr.skills?.mustHave)   ? pr.skills.mustHave   : [],
                    shouldHave: Array.isArray(pr.skills?.shouldHave) ? pr.skills.shouldHave : [],
                    niceToHave: Array.isArray(pr.skills?.niceToHave) ? pr.skills.niceToHave : [],
                };
                return {
                    text: JSON.stringify(pr, null, 2),
                    resolvedSkills,
                };
            }
        } catch (err) {
            console.error(`[AI] JobPosition fetch failed: ${err.message}. Falling back to raw JD.`);
        }

        // Fallback: read skills directly from the job document
        const resolvedSkills = {
            mustHave:   rawJobObj.skills?.required   || rawJobObj.skills?.mustHave   || [],
            shouldHave: rawJobObj.skills?.preferred  || rawJobObj.skills?.shouldHave || [],
            niceToHave: rawJobObj.skills?.niceToHave || [],
        };

        if (resolvedSkills.mustHave.length === 0 && resolvedSkills.shouldHave.length === 0) {
            console.warn('[AI] No JD skills found in either parsedRequirements or raw job doc — deterministic skill correction skipped, AI output unverified');
        }

        return {
            text: this._buildJobDescriptionString(jobDescription),
            resolvedSkills,
        };
    }

    /**
     * Call OpenAI with truncation detection + one retry on truncation or parse failure.
     * Returns { responseText, tokensUsed, model }.
     */
    async _callAI(prompt, attempt = 1) {
        const openai = getOpenAI();
        const model = getModel();

        console.log(`[AI] Calling OpenAI (attempt ${attempt}), model: ${model}`);

        const completion = await openai.chat.completions.create({
            model,
            messages: [
                {
                    role: 'system',
                    content: `You are Syncro1's advanced talent intelligence engine.
Your job is to analyze resumes against job descriptions and output ONLY valid JSON.
No explanations. No markdown. No text outside JSON.
Be deterministic, consistent and evidence-based in all scoring.`
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1,
            max_tokens: AI_MAX_TOKENS,
            response_format: { type: 'json_object' }
        });

        const finishReason = completion.choices[0]?.finish_reason;
        const responseText = completion.choices[0]?.message?.content;
        const tokensUsed = completion.usage?.total_tokens;

        console.log(`[AI] finish_reason=${finishReason}, tokens=${tokensUsed}`);

        // Handle truncation
        if (finishReason === 'length') {
            console.error('[AI] Response truncated, finish_reason=length');
            if (attempt < 2) {
                console.warn('[AI] Retrying once after truncation…');
                return this._callAI(prompt, 2);
            }
            // Write truncation failure to log
            const ScoringLog = require('../models/ScoringLog');
            await ScoringLog.create({
                logType: 'SCORING',
                promptSent: prompt,
                rawResponse: responseText,
                success: false,
                error: 'truncated_response'
            }).catch(() => {});
            throw new Error('AI response truncated after retry — falling back');
        }

        if (!responseText) throw new Error('Empty response from OpenAI');

        return { responseText, tokensUsed, model };
    }

    /**
     * Parse and validate the AI JSON response.
     * Throws on failure so the caller can retry.
     */
    _parseAndValidate(responseText) {
        try {
            return JSON.parse(responseText);
        } catch (err) {
            throw new Error(`JSON parse failed: ${err.message}`);
        }
    }

    /**
     * Overwrite aiResult rankingSignals AND re-derive all dependent scores
     * (skillsMatch → weightedScore → finalAdjustedScore → matchLevel → decision)
     * so every number downstream is internally consistent with the corrected skill lists.
     *
     * @param {object} aiResult       - Parsed AI JSON response (mutated in place)
     * @param {object} resolvedSkills - { mustHave, shouldHave, niceToHave } resolved by
     *                                  _getJobDescriptionText from the same source the
     *                                  prompt was built from.
     */
    /**
     * Deterministic skill sweep — guarantees recall by scanning the resume text
     * (and partner-reported form skills) against every known skill alias.
     * Returns the list of matched skill strings (deduped).
     *
     * @param {string} text            - Full (already-compressed) resume text
     * @param {string[]} formSkills    - Partner-reported skills from the form
     */
    _deterministicSkillSweep(text, formSkills) {
        if (!_sweepTerms) _buildSweepTerms();

        const matched = new Set();
        const haystack = (text || '').toLowerCase();

        // Single pass over precompiled regexes — no per-term regex compilation.
        for (const { term, re } of _sweepTerms) {
            if (re.test(haystack)) matched.add(term);
        }

        // Also include every partner-reported form skill (normalized)
        for (const fs of (formSkills || [])) {
            const norm = normalizeSkill(fs);
            if (norm) matched.add(norm);
        }

        return Array.from(matched);
    }

    _applyDeterministicSkillMatch(aiResult, resolvedSkills) {
        try {
            const candidateSkills = aiResult.candidateProfile?.skills || [];
            if (candidateSkills.length === 0) return aiResult;

            const jdSkills = resolvedSkills || {};
            const hasJdSkills = (jdSkills.mustHave?.length || 0) > 0 || (jdSkills.shouldHave?.length || 0) > 0;
            if (!hasJdSkills) {
                console.warn('[AI] No JD skills found in either parsedRequirements or raw job doc — deterministic skill correction skipped, AI output unverified');
                return aiResult;
            }

            // ── Step A: classify skills deterministically ─────────────────
            const result = matchSkills(candidateSkills, jdSkills);
            const coverage = result.mustHaveCoveragePercent; // 0–100

            console.log('[AI] skillMatcher deterministic overwrite:');
            console.log(`   mustHaveMatched: ${result.mustHaveMatched.length}/${jdSkills.mustHave.length}`);
            console.log(`   mustHaveMissing: ${result.mustHaveMissing.length}`);
            console.log(`   shouldHaveMatched: ${result.shouldHaveMatched.length}`);
            console.log(`   coverage: ${coverage}%`);

            // ── Step B: overwrite rankingSignals classification arrays ─────
            if (!aiResult.rankingSignals) aiResult.rankingSignals = {};
            aiResult.rankingSignals.mustHaveSkillsMatched      = result.mustHaveMatched;
            aiResult.rankingSignals.mustHaveSkillsMissing      = result.mustHaveMissing;
            aiResult.rankingSignals.mustHaveSkillsMatchedCount = result.mustHaveMatched.length;
            aiResult.rankingSignals.mustHaveSkillsTotal        = jdSkills.mustHave.length;
            aiResult.rankingSignals.shouldHaveSkillsMatched    = result.shouldHaveMatched;
            aiResult.rankingSignals.shouldHaveSkillsMissing    = result.shouldHaveMissing;
            aiResult.rankingSignals.niceToHaveSkillsMatched    = result.niceToHaveMatched;

            // ── Step C: recompute skillsMatch (same formula as scoring-prompt.txt) ──
            const mustTotal   = jdSkills.mustHave.length;
            const shouldTotal = jdSkills.shouldHave.length;
            const niceTotal   = jdSkills.niceToHave?.length || 0;

            let skillsMatch = (result.mustHaveMatched.length  / Math.max(mustTotal, 1)   * 70)
                            + (result.shouldHaveMatched.length / Math.max(shouldTotal, 1) * 25)
                            + (result.niceToHaveMatched.length / Math.max(niceTotal, 1)   * 5);
            if (coverage < 70) skillsMatch = Math.min(skillsMatch, 50);
            if (coverage < 30) skillsMatch = Math.min(skillsMatch, 15);
            skillsMatch = Math.round(skillsMatch);

            // ── Step D: recompute weightedScore (trust AI for other 7 components) ──
            if (!aiResult.scoring) aiResult.scoring = {};
            const s = aiResult.scoring;
            aiResult.scoring.skillsMatch          = skillsMatch;
            aiResult.scoring.skillCoveragePercent = coverage;

            const weightedScore = Math.round(
                skillsMatch                    * 0.30 +
                (s.experienceMatch    || 0)    * 0.20 +
                (s.locationMatch      || 0)    * 0.10 +
                (s.salaryFit          || 0)    * 0.10 +
                (s.noticePeriodFit    || 0)    * 0.10 +
                (s.stabilityScore     || 0)    * 0.10 +
                (s.domainMatch        || 0)    * 0.05 +
                (s.educationMatch     || 0)    * 0.05
            );
            aiResult.scoring.weightedScore = weightedScore;

            // ── Step E: recompute finalAdjustedScore + skill gate ─────────
            let finalAdjustedScore = Math.max(0, weightedScore - (s.riskPenalty || 0));
            const skillGate = coverage < 30;
            if (skillGate) finalAdjustedScore = Math.min(finalAdjustedScore, 25);
            aiResult.scoring.finalAdjustedScore = finalAdjustedScore;

            // ── Step F: recompute matchLevel and decision ─────────────────
            let matchLevel, decision;
            if      (finalAdjustedScore >= 80) matchLevel = 'STRONG';
            else if (finalAdjustedScore >= 65) matchLevel = 'GOOD';
            else if (finalAdjustedScore >= 50) matchLevel = 'PARTIAL';
            else                               matchLevel = 'WEAK';

            if      (finalAdjustedScore >= 70) decision = 'SHORTLIST';
            else if (finalAdjustedScore >= 50) decision = 'HOLD';
            else                               decision = 'REJECT';

            // Skill gate forces worst-case outcome regardless of other scores
            if (skillGate) { matchLevel = 'WEAK'; decision = 'REJECT'; }

            aiResult.matchLevel = matchLevel;
            if (!aiResult.recommendation) aiResult.recommendation = {};
            aiResult.recommendation.decision  = decision;
            aiResult.recommendation.skillGate = skillGate;

            // ── Step G: recompute priorityScore (same formula as scoring-prompt.txt) ──
            const withinBudget = aiResult.rankingSignals?.salaryWithinBudget ?? true;
            const noticeFit    = s.noticePeriodFit || 0;
            const priorityScore = Math.round(
                (result.mustHaveMatched.length / Math.max(mustTotal, 1)) * 40 +
                finalAdjustedScore * 0.40 +
                noticeFit * 0.10 +
                (withinBudget ? 10 : 0)
            );
            aiResult.rankingSignals.priorityScore = priorityScore;
            if (aiResult.recommendation) aiResult.recommendation.priorityScore = priorityScore;

            console.log(`[AI] Re-derived scores: skillsMatch=${skillsMatch}, weighted=${weightedScore}, final=${finalAdjustedScore}, ${matchLevel}/${decision}${skillGate ? ' [SKILL_GATE]' : ''}`);

        } catch (err) {
            // Non-fatal — if matcher fails, keep AI output as-is
            console.error('[AI] skillMatcher overwrite failed (non-fatal):', err.message);
        }

        return aiResult;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UNCHANGED from original — prompt builder, structuring, helpers
    // ═══════════════════════════════════════════════════════════════════════

    _buildAdvancedPrompt(formData, resumeText, jobDescriptionText) {
        const promptPath = path.join(__dirname, '../prompts/scoring-prompt.txt');
        let template;
        try {
            template = fs.readFileSync(promptPath, 'utf-8');
        } catch (err) {
            console.error('[AI] Could not load scoring prompt file:', err.message);
            template = 'Score the candidate. Output JSON only.';
        }

        const skillsString = Array.isArray(formData.skills) && formData.skills.length > 0
            ? formData.skills.join(', ')
            : 'Not provided';
        const educationString = Array.isArray(formData.education) && formData.education.length > 0
            ? formData.education.map(e => `${e.degree || ''} from ${e.institution || ''} (${e.year || ''})`).join('; ')
            : 'Not provided';
        const certificationsString = Array.isArray(formData.certifications) && formData.certifications.length > 0
            ? formData.certifications.join(', ')
            : 'Not provided';
        const languagesString = Array.isArray(formData.languages) && formData.languages.length > 0
            ? formData.languages.join(', ')
            : 'Not provided';

        return template
            .replace('{{firstName}}',                  formData.firstName || 'Not provided')
            .replace('{{lastName}}',                   formData.lastName || 'Not provided')
            .replace('{{email}}',                      formData.email || 'Not provided')
            .replace('{{mobile}}',                     formData.mobile || 'Not provided')
            .replace('{{location}}',                   formData.location || 'Not provided')
            .replace('{{willingToRelocate}}',           formData.willingToRelocate === true ? 'Yes' : formData.willingToRelocate === false ? 'No' : 'Not specified')
            .replace('{{totalExperience}}',            formData.totalExperience || 'Not provided')
            .replace('{{relevantExperience}}',         formData.relevantExperience || 'Not provided')
            .replace('{{noticePeriod}}',               formData.noticePeriod || 'Not provided')
            .replace('{{currentSalary}}',              formData.currentSalary ? '₹' + Number(formData.currentSalary).toLocaleString('en-IN') : 'Not provided')
            .replace('{{expectedSalary}}',             formData.expectedSalary ? '₹' + Number(formData.expectedSalary).toLocaleString('en-IN') : 'Not provided')
            .replace('{{partnerReportedSkills}}',      skillsString)
            .replace('{{partnerReportedEducation}}',   educationString)
            .replace('{{partnerReportedCertifications}}', certificationsString)
            .replace('{{partnerReportedLanguages}}',   languagesString)
            .replace('{{candidateWriteup}}',           formData.writeup || 'Not provided')
            .replace('{{resumeText}}',                 resumeText)
            .replace('{{jobDescription}}',             jobDescriptionText);
    }

    _buildJobDescriptionString(job) {
        const jobObj = job?.toObject ? job.toObject() : job;

        console.log('\n[AI] Building Job Description String:');
        console.log('  - Job ID:', jobObj?._id);
        console.log('  - Job title:', jobObj?.title);
        console.log('  - Required skills:', jobObj?.skills?.required?.length || 0);

        if (!jobObj || typeof jobObj !== 'object') {
            console.warn('[AI] Job description not available or invalid');
            return 'Job description not available';
        }

        const lines = [];
        if (jobObj.title)          lines.push(`Title: ${jobObj.title}`);
        if (jobObj.category)       lines.push(`Category: ${jobObj.category}`);
        if (jobObj.employmentType) lines.push(`Employment Type: ${jobObj.employmentType}`);
        if (jobObj.experienceLevel) lines.push(`Experience Level: ${jobObj.experienceLevel}`);
        if (jobObj.experienceRange) lines.push(`Experience Required: ${jobObj.experienceRange.min} to ${jobObj.experienceRange.max} years`);

        if (jobObj.salary) {
            const min = jobObj.salary.min ? `₹${jobObj.salary.min.toLocaleString('en-IN')}` : 'Not specified';
            const max = jobObj.salary.max ? `₹${jobObj.salary.max.toLocaleString('en-IN')}` : 'Not specified';
            lines.push(`Salary Budget: ${min} to ${max} per annum`);
        }

        if (jobObj.location) {
            const loc = [];
            if (jobObj.location.city)     loc.push(jobObj.location.city);
            if (jobObj.location.state)    loc.push(jobObj.location.state);
            if (jobObj.location.isRemote) loc.push('Remote OK');
            if (jobObj.location.isHybrid) loc.push('Hybrid');
            lines.push(`Location: ${loc.join(', ')}`);
        }

        if (jobObj.skills?.required?.length > 0)   lines.push(`MUST-HAVE Skills: ${jobObj.skills.required.join(', ')}`);
        if (jobObj.skills?.preferred?.length > 0)  lines.push(`PREFERRED Skills: ${jobObj.skills.preferred.join(', ')}`);
        if (jobObj.description)    lines.push(`\nJob Description:\n${jobObj.description.substring(0, 1000)}`);
        if (jobObj.requirements?.length > 0) lines.push(`\nRequirements:\n${jobObj.requirements.map(r => `- ${r}`).join('\n')}`);
        if (jobObj.responsibilities?.length > 0) lines.push(`\nResponsibilities:\n${jobObj.responsibilities.map(r => `- ${r}`).join('\n')}`);

        const finalString = lines.join('\n');
        console.log('[AI] Job Description String Length:', finalString.length);
        return finalString;
    }

    _structureAIResult(aiResult, formData) {
        const profile = aiResult.candidateProfile || {};
        const scoring = aiResult.scoring || {};

        return {
            firstName: formData.firstName || this._cleanString(profile.extractedName?.split(' ')[0]),
            lastName:  formData.lastName  || this._cleanString(profile.extractedName?.split(' ').slice(1).join(' ')),
            email:     formData.email     || this._cleanEmail(profile.extractedEmail),
            mobile:    formData.mobile    || this._cleanMobile(profile.extractedMobile),

            profile: {
                currentCompany:      this._cleanString(profile.currentCompany),
                currentDesignation:  this._cleanString(profile.currentDesignation),
                totalExperience:     formData.totalExperience || null,
                relevantExperience:  formData.relevantExperience || null,
                currentLocation:     this._cleanString(profile.standardizedLocation) || formData.location,
                skills:              Array.isArray(profile.skills) ? profile.skills.filter(Boolean) : [],
                education:           Array.isArray(profile.education) ? profile.education : [],
                languages:           Array.isArray(profile.languages) ? profile.languages : [],
                certifications:      Array.isArray(profile.certifications) ? profile.certifications : [],
                noticePeriod:        formData.noticePeriod || null,
                currentSalary:       formData.currentSalary || null,
                expectedSalary:      formData.expectedSalary || null,
            },

            summary: aiResult.recommendation?.justification || null
        };
    }

    _buildConfidence(aiResult) {
        const score = aiResult.scoring?.finalAdjustedScore || 0;
        const dataQuality = aiResult.validation?.dataQuality || 'LOW';

        return {
            score,
            level: score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW',
            dataQuality,
            fieldsExtracted: Object.values(aiResult.candidateProfile || {})
                .filter(v => v && v !== 'Not Found' && (Array.isArray(v) ? v.length > 0 : true)).length,
            totalFields: 9
        };
    }

    _getEmptyResumeData() {
        return {
            success: false,
            data: null,
            fullAnalysis: null,
            confidence: { score: 0, level: 'NONE', fieldsExtracted: 0, totalFields: 9 },
            mock: true,
            message: 'AI parsing skipped — manual review required'
        };
    }

    // ── Resume extraction (unchanged) ──────────────────────────────────────

    async _extractTextFromUrl(url) {
        try {
            const fileName = url.toLowerCase();
            if (fileName.includes('.docx') || fileName.includes('.doc')) return await this._extractFromDoc(url);
            if (fileName.includes('.pdf') || url.includes('/raw/'))       return await this._extractFromPdf(url);

            const response = await axios.get(url, { responseType: 'text', timeout: 30000 });
            return response.data;
        } catch (error) {
            console.error(`[AI] URL extraction error: ${error.message}`);
            throw new Error(`Could not download resume: ${error.message}`);
        }
    }

    async _extractFromPdf(url) {
        try {
            console.log('[AI] Extracting text from PDF…');
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 10 * 1024 * 1024 });
            const buffer = Buffer.from(response.data);

            try {
                const pdfParse = require('pdf-parse');
                const data = await pdfParse(buffer);
                if (data.text && data.text.trim().length > 50) {
                    console.log(`[AI] ✅ PDF parsed: ${data.text.length} chars, ${data.numpages} pages`);
                    return data.text;
                }
            } catch (pdfError) {
                console.log('[AI] pdf-parse error:', pdfError.message);
            }

            const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
            if (text.length > 100) { console.log(`[AI] PDF fallback: ${text.length} chars`); return text; }
            return `Resume file: ${url}`;
        } catch (error) {
            throw new Error(`PDF extraction failed: ${error.message}`);
        }
    }

    async _extractFromDoc(url) {
        try {
            console.log('[AI] Extracting text from DOC/DOCX…');
            const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 10 * 1024 * 1024 });
            const buffer = Buffer.from(response.data);

            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                if (result.value && result.value.trim().length > 50) {
                    console.log(`[AI] ✅ DOCX extracted: ${result.value.length} chars`);
                    return result.value;
                }
            } catch (mammothError) {
                console.log('[AI] mammoth error:', mammothError.message);
            }

            const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
            if (text.length > 100) { console.log(`[AI] DOC fallback: ${text.length} chars`); return text; }
            return `Resume file: ${url}`;
        } catch (error) {
            throw new Error(`DOC extraction failed: ${error.message}`);
        }
    }

    // ── String cleaners (unchanged) ────────────────────────────────────────

    _cleanString(value) {
        if (!value || typeof value !== 'string') return null;
        if (value === 'Not Found') return null;
        const cleaned = value.trim();
        return cleaned.length > 0 ? cleaned : null;
    }

    _cleanEmail(value) {
        if (!value || value === 'Not Found') return null;
        const email = String(value).toLowerCase().trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
    }

    _cleanMobile(value) {
        if (!value || value === 'Not Found') return null;
        const cleaned = String(value).replace(/\D/g, '').slice(-10);
        return cleaned.length === 10 ? cleaned : null;
    }
}

module.exports = new AIService();