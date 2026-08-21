const { getOpenAI, getModel } = require('../config/ai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { matchSkills, normalizeSkill, ALIAS_GROUPS, _ambiguousTokens } = require('./skillMatcher');
const { matchCandidateCityToJobCities } = require('./cityNormalizer');
const { EDU_LEVELS, getEduLevel } = require('./educationUtils');


// ── Constants ──────────────────────────────────────────────────────────────
const AI_MAX_TOKENS = 20000;

// ── Caching for efficient AI use (Change E) ─────────────────────────────────
const crypto = require('crypto');
const WEIGHTS_VERSION = 2;
// Bump this to invalidate all persistent DB cache entries on algorithm changes
const PERSISTENT_CACHE_VERSION = 2;
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

function _scoreCacheKey(resumeUrl, candidateFormData = {}, jobDescription = {}) {
    const candidateId = candidateFormData?.candidateId || candidateFormData?._id || candidateFormData?.email || '';
    const rawJob = jobDescription?.toObject ? jobDescription.toObject() : (jobDescription || {});
    const jobId = rawJob._id || rawJob.id || '';
    const jobUpdatedAt = rawJob.updatedAt ? new Date(rawJob.updatedAt).getTime() : '';

    const candidatePayload = JSON.stringify({
        skills: candidateFormData?.skills || [],
        exp: candidateFormData?.totalExperience ?? candidateFormData?.relevantExperience ?? '',
        salary: candidateFormData?.expectedSalary ?? '',
        loc: candidateFormData?.location ?? '',
        notice: candidateFormData?.noticePeriod ?? '',
        relocate: candidateFormData?.willingToRelocate ?? null
    });

    return crypto.createHash('sha256')
        .update(`${resumeUrl}|${candidateId}|${jobId}|${jobUpdatedAt}|${candidatePayload}|v${WEIGHTS_VERSION}`)
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

function logTokenUsage(contextName, model, usage = {}, finishReason = 'stop', attempt = 1, durationMs = 0) {
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
    const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    let inputRate = 0.0000025;
    let outputRate = 0.0000100;
    const m = (model || '').toLowerCase();
    if (m.includes('gpt-4o-mini') || m.includes('mini')) {
        inputRate = 0.00000015;
        outputRate = 0.00000060;
    } else if (m.includes('gpt-3.5')) {
        inputRate = 0.00000050;
        outputRate = 0.00000150;
    } else if (m.includes('o1') || m.includes('o3')) {
        inputRate = 0.0000150;
        outputRate = 0.0000600;
    }

    const estimatedCost = (promptTokens * inputRate) + (completionTokens * outputRate);

    console.log(`\n┌──────────────────────────────────────────────────────────┐`);
    console.log(`│ 📊 AI TOKEN USAGE REPORT                                 │`);
    console.log(`├──────────────────────────────────────────────────────────┤`);
    console.log(`│ Context:          ${contextName.padEnd(38)}│`);
    console.log(`│ Model:            ${model.padEnd(38)}│`);
    console.log(`│ Finish Reason:    ${finishReason.padEnd(38)}│`);
    console.log(`│ Attempt:          ${String(attempt).padEnd(38)}│`);
    console.log(`├──────────────────────────────────────────────────────────┤`);
    console.log(`│ 📥 Prompt (Input) Tokens:      ${String(promptTokens.toLocaleString()).padEnd(25)}│`);
    if (cachedTokens > 0) {
        console.log(`│    └─ Cached Input Tokens:     ${String(cachedTokens.toLocaleString()).padEnd(25)}│`);
    }
    console.log(`│ 📤 Completion (Output) Tokens: ${String(completionTokens.toLocaleString()).padEnd(25)}│`);
    if (reasoningTokens > 0) {
        console.log(`│    └─ Reasoning Tokens:        ${String(reasoningTokens.toLocaleString()).padEnd(25)}│`);
    }
    console.log(`│ 🔢 Total Tokens Used:          ${String(totalTokens.toLocaleString()).padEnd(25)}│`);
    if (durationMs > 0) {
        console.log(`│ ⏱️  Response Time:              ${(durationMs + ' ms').padEnd(25)}│`);
    }
    console.log(`│ 💵 Estimated Cost:             ${('$' + estimatedCost.toFixed(5) + ' USD').padEnd(25)}│`);
    console.log(`└──────────────────────────────────────────────────────────┘\n`);
}

class AIService {
    constructor() {
        this.enabled = process.env.AI_ENABLED === 'true';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC — parseResume (orchestrator, signature unchanged)
    // ═══════════════════════════════════════════════════════════════════════
    async parseResume(resumeUrl, fileName = '', candidateFormData = {}, jobDescription = {}, options = {}) {
        console.log('\n========================================');
        console.log('[AI] parseResume called with:');
        console.log('  - resumeUrl:', resumeUrl);
        console.log('  - fileName:', fileName);
        console.log('  - candidateFormData keys:', Object.keys(candidateFormData));
        console.log('  - jobDescription._id:', jobDescription?._id);
        console.log('  - AI enabled:', this.enabled);
        console.log('========================================\n');

        console.log(`🚀 [AI MATCHING ENGINE STARTED] Processing candidate: ${candidateFormData.firstName || ''} ${candidateFormData.lastName || ''}`);

        if (!this.enabled) {
            console.log('⏹️ [AI MATCHING ENGINE STOPPED] Resume parsing disabled');
            return this._getEmptyResumeData();
        }

        const { validateResumeUrl } = require('../utils/validators');
        const urlCheck = validateResumeUrl(resumeUrl);
        if (!urlCheck.valid) {
            console.error(`[AI] Invalid/unsafe resume URL (${resumeUrl}): ${urlCheck.reason}`);
            console.log('⏹️ [AI MATCHING ENGINE STOPPED] Unsafe resume URL');
            return this._getEmptyResumeData();
        }

        const openai = getOpenAI();
        if (!openai) {
            console.log('⏹️ [AI MATCHING ENGINE STOPPED] OpenAI not configured');
            return this._getEmptyResumeData();
        }

        const ck = _scoreCacheKey(resumeUrl, candidateFormData, jobDescription);
        const _cached = _scoreCache.get(ck);
        if (_cached && (Date.now() - _cached.ts) < CACHE_TTL_MS) {
            console.log('⚡ [AI MATCHING ENGINE COMPLETED] Cache hit — returned prior score for:', candidateFormData.firstName, candidateFormData.lastName);
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
            const { text: jobDescriptionText, resolvedSkills } = options.prefetchedJD || await this._getJobDescriptionText(jobDescription);

            // ── Stage 3: build prompt ─────────────────────────────────────
            prompt = this._buildAdvancedPrompt(candidateFormData, resumeText, jobDescriptionText);

            // ── Stage 4: call AI (with truncation + parse retry) ──────────
            const aiTokenUsage = await this._callAI(prompt);
            const { responseText, tokensUsed, model } = aiTokenUsage;

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
            const expRange = jobDescription?.experienceRange || {};

            // ── Stage 6b: deterministic experience recompute ─────────────
            // Overwrite the LLM's hand-summed totals with an exact calculation
            // from jobHistory: overlapping/concurrent roles merged (counted once),
            // gaps excluded, inclusive +1 month rule, ongoing roles → today.
            // Runs BEFORE _applyDeterministicSkillMatch so its _scoreExperience
            // fallback reads the corrected actualTotalMonths.
            try {
                const { calculateFromResume, buildExperienceEntries } = require('./experienceCalculator');
                aiResult.candidateProfile = aiResult.candidateProfile || {};
                if (!Array.isArray(aiResult.candidateProfile.jobHistory) || aiResult.candidateProfile.jobHistory.length === 0) {
                    if (Array.isArray(aiResult.jobHistory) && aiResult.jobHistory.length > 0) {
                        aiResult.candidateProfile.jobHistory = aiResult.jobHistory;
                    } else if (Array.isArray(aiResult.candidateProfile.experience) && aiResult.candidateProfile.experience.length > 0) {
                        aiResult.candidateProfile.jobHistory = aiResult.candidateProfile.experience;
                    }
                }
                const calc = calculateFromResume(aiResult.candidateProfile.jobHistory || [], new Date());
                if (calc.roles.length > 0) {
                    aiResult.candidateProfile.actualTotalMonths = calc.totalMonths;
                    aiResult.candidateProfile.actualTotalExperience = calc.totalExperience;
                    aiResult.candidateProfile.actualExperienceBreakdown = calc.roles;
                    // ✅ Structured experience records for storage in candidate.profile
                    aiResult.candidateProfile.experience = buildExperienceEntries(aiResult.candidateProfile.jobHistory || [], new Date());
                    // ✅ Update jobHistory with corrected durationMonths so logs and storage show accurate values
                    if (Array.isArray(aiResult.candidateProfile.jobHistory)) {
                        aiResult.candidateProfile.jobHistory.forEach((job, idx) => {
                            const corrected = calc.roles[idx];
                            if (corrected) job.durationMonths = corrected.duration_months;
                        });
                    }
                    if (!aiResult.screening) aiResult.screening = {};
                    if (!aiResult.screening.experienceRange) aiResult.screening.experienceRange = {};
                    aiResult.screening.experienceRange.actual = `${calc.totalExperience}`;

                    // Overwrite LLM's hallucinated discrepancy detail with clean exact deterministic text
                    if (candidateFormData && candidateFormData.totalExperience != null) {
                        const formExp = Number(candidateFormData.totalExperience);
                        const diff = Math.abs(formExp - calc.yearsDecimal);
                        if (!aiResult.validation) aiResult.validation = {};
                        if (diff >= 1) {
                            aiResult.validation.experienceDiscrepancyDetail = `Form reported ${formExp} years but resume calculation shows ${calc.totalExperience}.`;
                        } else {
                            aiResult.validation.experienceDiscrepancyDetail = `Form reported ${formExp} years matching resume calculation of ${calc.totalExperience}.`;
                        }
                    }

                    console.log(`[AI] Deterministic experience: ${calc.totalExperience} (${calc.totalMonths}mo) from ${calc.roles.length} role(s)`);
                }
            } catch (expErr) {
                console.error('[AI] Deterministic experience recompute failed (non-fatal):', expErr.message);
            }

            aiResult = this._applyDeterministicSkillMatch(aiResult, resolvedSkills, expRange, jobDescription?.salary, candidateFormData, jobDescription);

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
            console.log(`🏁 [AI MATCHING ENGINE COMPLETED & STOPPED] Candidate: ${candidateFormData.firstName} ${candidateFormData.lastName} | Score: ${aiResult.scoring?.finalAdjustedScore}/100`);

            const successResult = {
                success: true,
                data: structuredData,
                fullAnalysis: aiResult,
                confidence: this._buildConfidence(aiResult),
                provider: 'openai',
                model,
                tokensUsed,
                tokenUsage: {
                    promptTokens: aiTokenUsage.promptTokens || 0,
                    completionTokens: aiTokenUsage.completionTokens || 0,
                    cachedTokens: aiTokenUsage.cachedTokens || 0,
                    totalTokens: tokensUsed
                }
            };
            _cacheSet(ck, { ts: Date.now(), result: successResult });

            // Also persist to DB cache so batch lookups can find this score
            const _jobId = jobDescription?._id || jobDescription?.id;
            const _candId = candidateFormData?.candidateId || candidateFormData?._id;
            const _jobUpdatedAt = jobDescription?.updatedAt ? new Date(jobDescription.updatedAt) : null;
            await this._setPersistentCache(_candId, _jobId, _jobUpdatedAt, successResult, 'single');

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
    // PUBLIC — parseMultipleResumes
    //   True batch: ONE AI call for all N candidates + JD, not N parallel calls.
    //   Also checks/writes persistent MongoDB cache (AiScoreCache) so repeat
    //   evaluations of the same (candidate, JD) pair cost zero tokens.
    // ═══════════════════════════════════════════════════════════════════════
    /**
     * Batch parse up to 5 candidate resumes against a single Job Description.
     *
     * Token strategy:
     *   1. Check persistent DB cache per candidate → skip AI for cached ones.
     *   2. For uncached candidates: ONE AI call with all resumes + JD in one prompt
     *      (JD sent once, not N times → ~68-78% token reduction vs parallel calls).
     *   3. Run deterministic post-processing on every result (skills, exp, salary…).
     *   4. Persist results to AiScoreCache (7-day TTL).
     *
     * @param {Array<Object>} candidatesList - Array of { resumeUrl, fileName, candidateFormData, candidateId }
     * @param {Object} jobDescription - Target Job Description object
     * @returns {Object} Batch results + comparative ranking matrix
     */
    async parseMultipleResumes(candidatesList = [], jobDescription = {}) {
        console.log('\n========================================');
        console.log(`[AI] parseMultipleResumes called for ${candidatesList.length} candidate(s) against JD:`, jobDescription?._id || jobDescription?.title);
        console.log('========================================\n');

        if (!Array.isArray(candidatesList) || candidatesList.length === 0) {
            return {
                success: false,
                message: 'No candidates provided for batch matching',
                results: [],
                comparativeRanking: []
            };
        }

        const MAX_BATCH = 5;
        const candidatesToProcess = candidatesList.slice(0, MAX_BATCH);
        if (candidatesList.length > MAX_BATCH) {
            console.warn(`[AI] Batch scan capped at ${MAX_BATCH} candidates (received ${candidatesList.length})`);
        }

        const jobId = jobDescription?._id || jobDescription?.id;
        const jobUpdatedAt = jobDescription?.updatedAt ? new Date(jobDescription.updatedAt) : null;

        // ── Phase 1: Prefetch JD + check in-memory cache per candidate ──────
        const prefetchedJD = await this._getJobDescriptionText(jobDescription);

        // Normalise each entry and check both in-memory + DB cache
        const normalized = candidatesToProcess.map(cand => {
            const resumeUrl = cand.resumeUrl || cand.resume?.url || '';
            const fileName = cand.fileName || cand.resume?.fileName || '';
            const formData = cand.candidateFormData || cand.formData || cand;
            const candidateId = cand.candidateId || formData.candidateId || formData._id || cand._id;
            const name = `${formData.firstName || cand.firstName || ''} ${formData.lastName || cand.lastName || ''}`.trim() || 'Candidate';
            // In-memory cache key (same key as parseResume uses)
            const memCacheKey = _scoreCacheKey(resumeUrl, formData, jobDescription);
            const memCached = _scoreCache.get(memCacheKey);
            const memHit = memCached && (Date.now() - memCached.ts) < CACHE_TTL_MS;
            return { resumeUrl, fileName, formData, candidateId, name, memCacheKey, memHit, memResult: memHit ? memCached.result : null };
        });

        // ── Phase 2: DB cache lookup for candidates that missed in-memory cache
        const needDbCheck = normalized.filter(c => !c.memHit && jobId);
        const dbCacheMap = new Map(); // candidateId.toString() → cached result

        if (needDbCheck.length > 0) {
            try {
                const AiScoreCache = require('../models/AiScoreCache');
                const dbHits = await AiScoreCache.find({
                    candidateId: { $in: needDbCheck.map(c => c.candidateId).filter(Boolean) },
                    jobId,
                    scoreVersion: PERSISTENT_CACHE_VERSION,
                }).lean();

                for (const hit of dbHits) {
                    // Invalidate if the job was updated after the score was computed
                    if (jobUpdatedAt && hit.computedAt && new Date(hit.computedAt) < jobUpdatedAt) {
                        console.log(`[AI] DB cache stale for candidate ${hit.candidateId} (job updated after score)`);
                        continue;
                    }
                    if (hit.fullResult) {
                        dbCacheMap.set(String(hit.candidateId), hit.fullResult);
                        console.log(`⚡ [AI] DB cache hit for candidate ${hit.candidateId}`);
                    }
                }
            } catch (dbErr) {
                console.warn('[AI] DB cache lookup failed (non-fatal):', dbErr.message);
            }
        }

        // ── Phase 3: Determine which candidates actually need AI ─────────────
        const cached = [];    // { candidateId, name, result, fromCache: 'memory'|'db' }
        const needAI = [];    // normalized entries that need AI scoring

        for (const c of normalized) {
            if (c.memHit) {
                cached.push({ candidateId: c.candidateId, name: c.name, result: c.memResult, fromCache: 'memory' });
            } else if (dbCacheMap.has(String(c.candidateId))) {
                const res = dbCacheMap.get(String(c.candidateId));
                // Also warm in-memory cache
                _cacheSet(c.memCacheKey, { ts: Date.now(), result: res });
                cached.push({ candidateId: c.candidateId, name: c.name, result: res, fromCache: 'db' });
            } else {
                needAI.push(c);
            }
        }

        console.log(`[AI] Batch cache summary: ${cached.length} cached (${cached.filter(c => c.fromCache === 'memory').length} memory, ${cached.filter(c => c.fromCache === 'db').length} db), ${needAI.length} need AI`);

        // ── Phase 4: True batch AI call (ONE prompt for all uncached candidates)
        const aiResults = []; // { candidateId, name, result }
        let batchTokenUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 };

        if (needAI.length > 0) {
            if (needAI.length === 1) {
                // Single candidate — use normal parseResume (no batch overhead)
                const c = needAI[0];
                console.log(`[AI] Single uncached candidate — using standard parseResume for ${c.name}`);
                try {
                    const res = await this.parseResume(c.resumeUrl, c.fileName, c.formData, jobDescription, { prefetchedJD });
                    aiResults.push({ candidateId: c.candidateId, name: c.name, result: res });
                    const tu = res.tokenUsage || {};
                    batchTokenUsage.promptTokens += tu.promptTokens || 0;
                    batchTokenUsage.completionTokens += tu.completionTokens || 0;
                    batchTokenUsage.cachedTokens += tu.cachedTokens || 0;
                    batchTokenUsage.totalTokens += tu.totalTokens || (res.tokensUsed || 0);
                    // Persist to DB
                    await this._setPersistentCache(c.candidateId, jobId, jobUpdatedAt, res, 'single');
                } catch (err) {
                    console.error(`[AI] Single parse failed for ${c.name}:`, err.message);
                    aiResults.push({ candidateId: c.candidateId, name: c.name, result: this._getEmptyResumeData() });
                }
            } else {
                // TRUE BATCH — extract resumes in parallel then ONE AI call
                console.log(`[AI] 🚀 True batch AI call for ${needAI.length} candidates (JD sent once)...`);
                try {
                    // Step A: Extract resume texts in parallel (no AI — pure file download)
                    const resumeTexts = await Promise.all(needAI.map(async c => {
                        try {
                            const raw = await this._getResumeText(c.resumeUrl);
                            return raw && raw.trim().length > 30 ? raw : null;
                        } catch (e) {
                            console.warn(`[AI] Resume extraction failed for ${c.name}:`, e.message);
                            return null;
                        }
                    }));

                    // Step B: Build single batch prompt (JD once + all candidates)
                    const batchPrompt = this._buildBatchPrompt(
                        needAI.map((c, i) => ({ formData: c.formData, resumeText: resumeTexts[i] || '' })),
                        prefetchedJD.text
                    );

                    // Step C: ONE AI call → JSON array
                    const batchAI = await this._batchCallAI(batchPrompt, needAI.length);
                    batchTokenUsage = {
                        promptTokens: batchAI.promptTokens,
                        completionTokens: batchAI.completionTokens,
                        cachedTokens: batchAI.cachedTokens,
                        totalTokens: batchAI.tokensUsed
                    };

                    // Step D: Post-process each result deterministically
                    for (let i = 0; i < needAI.length; i++) {
                        const c = needAI[i];
                        const rawAI = batchAI.resultsArray[i];

                        if (!rawAI) {
                            console.warn(`[AI] No batch result for candidate index ${i} (${c.name}) — using empty`);
                            aiResults.push({ candidateId: c.candidateId, name: c.name, result: this._getEmptyResumeData() });
                            continue;
                        }

                        try {
                            let aiResult = rawAI;

                            // Deterministic skill sweep (same as parseResume)
                            const swept = this._deterministicSkillSweep(resumeTexts[i] || '', c.formData.skills);
                            const aiSkills = (aiResult.candidateProfile?.skills || []).filter(Boolean);
                            aiResult.candidateProfile = aiResult.candidateProfile || {};
                            aiResult.candidateProfile.skills = [...new Set([...aiSkills, ...swept])];

                            // Deterministic experience recompute
                            try {
                                const { calculateFromResume, buildExperienceEntries } = require('./experienceCalculator');
                                aiResult.candidateProfile = aiResult.candidateProfile || {};
                                if (!Array.isArray(aiResult.candidateProfile.jobHistory) || aiResult.candidateProfile.jobHistory.length === 0) {
                                    if (Array.isArray(aiResult.jobHistory) && aiResult.jobHistory.length > 0) {
                                        aiResult.candidateProfile.jobHistory = aiResult.jobHistory;
                                    } else if (Array.isArray(aiResult.candidateProfile.experience) && aiResult.candidateProfile.experience.length > 0) {
                                        aiResult.candidateProfile.jobHistory = aiResult.candidateProfile.experience;
                                    }
                                }
                                const calc = calculateFromResume(aiResult.candidateProfile.jobHistory || [], new Date());
                                if (calc.roles.length > 0) {
                                    aiResult.candidateProfile.actualTotalMonths = calc.totalMonths;
                                    aiResult.candidateProfile.actualTotalExperience = calc.totalExperience;
                                    aiResult.candidateProfile.actualExperienceBreakdown = calc.roles;
                                    aiResult.candidateProfile.experience = buildExperienceEntries(aiResult.candidateProfile.jobHistory || [], new Date());
                                    if (Array.isArray(aiResult.candidateProfile.jobHistory)) {
                                        aiResult.candidateProfile.jobHistory.forEach((job, idx) => {
                                            const corrected = calc.roles[idx];
                                            if (corrected) job.durationMonths = corrected.duration_months;
                                        });
                                    }
                                    if (!aiResult.screening) aiResult.screening = {};
                                    if (!aiResult.screening.experienceRange) aiResult.screening.experienceRange = {};
                                    aiResult.screening.experienceRange.actual = `${calc.totalExperience}`;
                                    if (c.formData && c.formData.totalExperience != null) {
                                        const formExp = Number(c.formData.totalExperience);
                                        const diff = Math.abs(formExp - calc.yearsDecimal);
                                        if (!aiResult.validation) aiResult.validation = {};
                                        aiResult.validation.experienceDiscrepancyDetail = diff >= 1
                                            ? `Form reported ${formExp} years but resume calculation shows ${calc.totalExperience}.`
                                            : `Form reported ${formExp} years matching resume calculation of ${calc.totalExperience}.`;
                                    }
                                }
                            } catch (expErr) {
                                console.error('[AI] Batch exp recompute failed (non-fatal):', expErr.message);
                            }

                            // Deterministic skill/score overwrite
                            const expRange = jobDescription?.experienceRange || {};
                            aiResult = this._applyDeterministicSkillMatch(
                                aiResult,
                                prefetchedJD.resolvedSkills,
                                expRange,
                                jobDescription?.salary,
                                c.formData,
                                jobDescription
                            );

                            const structuredData = this._structureAIResult(aiResult, c.formData);
                            const fullResult = {
                                success: true,
                                data: structuredData,
                                fullAnalysis: aiResult,
                                confidence: this._buildConfidence(aiResult),
                                provider: 'openai',
                                model: batchAI.model,
                                tokensUsed: 0, // allocated at batch level
                                tokenUsage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 }
                            };

                            // Warm in-memory cache
                            _cacheSet(c.memCacheKey, { ts: Date.now(), result: fullResult });
                            // Persist to DB
                            await this._setPersistentCache(c.candidateId, jobId, jobUpdatedAt, fullResult, 'batch');

                            aiResults.push({ candidateId: c.candidateId, name: c.name, result: fullResult });

                            console.log(`[AI] ✅ Batch result [${i}] ${c.name}: score=${aiResult.scoring?.finalAdjustedScore}/100 (${aiResult.matchLevel})`);
                        } catch (postErr) {
                            console.error(`[AI] Post-processing failed for ${c.name} [${i}]:`, postErr.message);
                            aiResults.push({ candidateId: c.candidateId, name: c.name, result: this._getEmptyResumeData() });
                        }
                    }
                } catch (batchErr) {
                    // Batch call failed — fall back to individual parseResume calls
                    console.error('[AI] ⚠️ Batch AI call failed, falling back to individual calls:', batchErr.message);
                    const fallbackPromises = needAI.map(c =>
                        this.parseResume(c.resumeUrl, c.fileName, c.formData, jobDescription, { prefetchedJD })
                            .then(res => {
                                batchTokenUsage.totalTokens += res.tokenUsage?.totalTokens || 0;
                                return { candidateId: c.candidateId, name: c.name, result: res };
                            })
                            .catch(err => ({ candidateId: c.candidateId, name: c.name, result: this._getEmptyResumeData() }))
                    );
                    const fallbackResults = await Promise.all(fallbackPromises);
                    aiResults.push(...fallbackResults);
                }
            }
        }

        // ── Phase 5: Merge cached + AI results, preserving original order ────
        const allResultsMap = new Map();
        for (const r of cached) allResultsMap.set(String(r.candidateId), { candidateId: r.candidateId, candidateName: r.name, result: r.result, fromCache: r.fromCache });
        for (const r of aiResults) allResultsMap.set(String(r.candidateId), { candidateId: r.candidateId, candidateName: r.name, result: r.result, fromCache: null });

        const rawResults = normalized.map(c => allResultsMap.get(String(c.candidateId)) || { candidateId: c.candidateId, candidateName: c.name, result: this._getEmptyResumeData(), fromCache: null });

        // ── Phase 6: Build comparative ranking matrix ────────────────────────
        const rankedCandidates = rawResults
            .map(item => {
                const fa = item.result?.fullAnalysis || {};
                const score = fa.scoring?.finalAdjustedScore || 0;
                const priorityScore = fa.rankingSignals?.priorityScore || fa.recommendation?.priorityScore || score;
                const matchLevel = fa.matchLevel || 'UNKNOWN';
                const decision = fa.recommendation?.decision || 'HOLD';
                const skillCoverage = fa.scoring?.skillCoveragePercent || 0;

                return {
                    candidateId: item.candidateId,
                    candidateName: item.candidateName,
                    score,
                    priorityScore,
                    matchLevel,
                    decision,
                    skillCoverage,
                    matchedSkillsCount: fa.rankingSignals?.mustHaveSkillsMatchedCount || 0,
                    totalMustSkills: fa.rankingSignals?.mustHaveSkillsTotal || 0,
                    keyMissingSkills: fa.rankingSignals?.mustHaveSkillsMissing || [],
                    fullAnalysis: fa,
                    singleResult: item.result,
                    fromCache: item.fromCache
                };
            })
            .sort((a, b) => b.score - a.score || b.priorityScore - a.priorityScore);

        rankedCandidates.forEach((cand, idx) => { cand.rank = idx + 1; });

        const topCandidate = rankedCandidates[0] || null;

        // ── Phase 7: Log token efficiency ────────────────────────────────────
        const dbCacheHits = cached.filter(c => c.fromCache === 'db').length;
        const memCacheHits = cached.filter(c => c.fromCache === 'memory').length;
        const totalCandidates = candidatesToProcess.length;
        const savedTokenEstimate = cached.length * 5000; // ~5000 tokens per saved individual call

        console.log(`\n┌──────────────────────────────────────────────────────────────┐`);
        console.log(`│ 📊 BATCH AI MATCHING — TOKEN EFFICIENCY REPORT               │`);
        console.log(`├──────────────────────────────────────────────────────────────┤`);
        console.log(`│ Total Candidates:          ${String(totalCandidates).padEnd(35)}│`);
        console.log(`│ ⚡ Memory Cache Hits:       ${String(memCacheHits).padEnd(35)}│`);
        console.log(`│ 🗄️  DB Cache Hits:          ${String(dbCacheHits).padEnd(35)}│`);
        console.log(`│ 🤖 AI Calls (batch=1):      ${String(needAI.length > 1 ? '1 batch call' : needAI.length === 1 ? '1 single call' : '0 (all cached)').padEnd(35)}│`);
        console.log(`├──────────────────────────────────────────────────────────────┤`);
        console.log(`│ 📥 Prompt Tokens Used:      ${String(batchTokenUsage.promptTokens.toLocaleString()).padEnd(35)}│`);
        console.log(`│ 📤 Completion Tokens Used:  ${String(batchTokenUsage.completionTokens.toLocaleString()).padEnd(35)}│`);
        console.log(`│ 🔢 Total Tokens Used:       ${String(batchTokenUsage.totalTokens.toLocaleString()).padEnd(35)}│`);
        console.log(`│ 💰 Est. Tokens Saved:       ${String('~' + savedTokenEstimate.toLocaleString() + ' (vs N×single)').padEnd(35)}│`);
        console.log(`└──────────────────────────────────────────────────────────────┘\n`);

        console.log(`[AI] ✅ Batch complete: ${rankedCandidates.length} candidate(s) ranked.`);
        if (topCandidate) console.log(`   🏆 Top: ${topCandidate.candidateName} (Score: ${topCandidate.score}/100)`);

        return {
            success: true,
            jobId,
            jobTitle: jobDescription?.title || 'Job Description',
            totalProcessed: rankedCandidates.length,
            batchTokenEfficiency: {
                totalPromptTokens: batchTokenUsage.promptTokens,
                totalCachedTokens: batchTokenUsage.cachedTokens,
                totalCompletionTokens: batchTokenUsage.completionTokens,
                totalTokens: batchTokenUsage.totalTokens,
                memoryCacheHits: memCacheHits,
                dbCacheHits,
                aiCandidatesProcessed: needAI.length,
                estimatedTokensSaved: savedTokenEstimate,
                batchMode: needAI.length > 1 ? 'true_batch' : needAI.length === 1 ? 'single' : 'all_cached'
            },
            topCandidate: topCandidate ? {
                candidateId: topCandidate.candidateId,
                candidateName: topCandidate.candidateName,
                score: topCandidate.score,
                matchLevel: topCandidate.matchLevel,
                decision: topCandidate.decision
            } : null,
            comparativeRanking: rankedCandidates,
            results: rawResults
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE — Persistent DB cache helpers
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Persist a scoring result to MongoDB AiScoreCache.
     * Upserts so re-runs overwrite stale entries cleanly.
     */
    async _setPersistentCache(candidateId, jobId, jobUpdatedAt, result, source = 'single') {
        if (!candidateId || !jobId) return;
        try {
            const AiScoreCache = require('../models/AiScoreCache');
            const fa = result?.fullAnalysis || {};
            await AiScoreCache.findOneAndUpdate(
                { candidateId, jobId, scoreVersion: PERSISTENT_CACHE_VERSION },
                {
                    $set: {
                        jobUpdatedAt: jobUpdatedAt || null,
                        score: fa.scoring?.finalAdjustedScore || 0,
                        matchLevel: fa.matchLevel || 'UNKNOWN',
                        decision: fa.recommendation?.decision || 'HOLD',
                        skillCoveragePercent: fa.scoring?.skillCoveragePercent || 0,
                        tokensUsed: result.tokensUsed || 0,
                        fullResult: result,
                        source,
                        computedAt: new Date()
                    }
                },
                { upsert: true, new: true }
            );
            console.log(`[AI] 🗄️  Persisted score to DB cache: candidate=${candidateId}, job=${jobId}`);
        } catch (err) {
            console.warn('[AI] DB cache write failed (non-fatal):', err.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE — True batch prompt builder
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Build a single prompt containing N candidate blocks + ONE JD.
     * Uses batch-scoring-prompt.txt template.
     *
     * @param {Array<{formData, resumeText}>} candidates
     * @param {string} jdText - Pre-fetched job description text
     * @returns {string} Full prompt string
     */
    _buildBatchPrompt(candidates, jdText) {
        const promptPath = path.join(__dirname, '../prompts/batch-scoring-prompt.txt');
        let template;
        try {
            template = fs.readFileSync(promptPath, 'utf-8');
        } catch (err) {
            console.error('[AI] Could not load batch scoring prompt:', err.message);
            template = 'Score all candidates against the JD. Output JSON array only.';
        }

        // Build candidate blocks
        const candidateBlocks = candidates.map((c, i) => {
            const fd = c.formData || {};
            const skillsStr = Array.isArray(fd.skills) && fd.skills.length > 0 ? fd.skills.join(', ') : 'Not provided';
            const eduStr = Array.isArray(fd.education) && fd.education.length > 0
                ? fd.education.map(e => `${e.degree || ''} from ${e.institution || ''} (${e.year || ''})`).join('; ')
                : 'Not provided';
            const certStr = Array.isArray(fd.certifications) && fd.certifications.length > 0 ? fd.certifications.join(', ') : 'Not provided';
            const langStr = Array.isArray(fd.languages) && fd.languages.length > 0 ? fd.languages.join(', ') : 'Not provided';

            return [
                `--- CANDIDATE [${i}] ---`,
                `name: ${fd.firstName || ''} ${fd.lastName || ''} | email: ${fd.email || 'N/A'} | mobile: ${fd.mobile || 'N/A'}`,
                `location: ${fd.location || 'N/A'} | relocate: ${fd.willingToRelocate === true ? 'Yes' : fd.willingToRelocate === false ? 'No' : 'Not specified'}`,
                `totalExp: ${fd.totalExperience || 'N/A'}yr | relevantExp: ${fd.relevantExperience || 'N/A'}yr | notice: ${fd.noticePeriod || 'N/A'}`,
                `currentSalary: ${this._formatSalaryForPrompt(fd.currentSalary)} | expectedSalary: ${this._formatSalaryForPrompt(fd.expectedSalary)}`,
                `skills: ${skillsStr}`,
                `education: ${eduStr}`,
                `certifications: ${certStr}`,
                `languages: ${langStr}`,
                `writeup: ${fd.writeup || 'Not provided'}`,
                `# Resume:\n${c.resumeText || 'Resume text not available'}`,
                `--- END CANDIDATE [${i}] ---`
            ].join('\n');
        }).join('\n\n');

        return template
            .replace('{{jobDescription}}', jdText)
            .replace('{{candidateBlocks}}', candidateBlocks)
            .replace(/\{\{candidateCount\}\}/g, String(candidates.length))
            .replace('{{candidateCountMinus1}}', String(candidates.length - 1));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE — Single AI call for batch, returns array of full analyses
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Send one AI call with a batch prompt; parse and return JSON array.
     * Falls back to empty array on parse failure so caller can degrade gracefully.
     *
     * @param {string} prompt - Full batch prompt
     * @param {number} expectedCount - Number of candidates expected in response
     * @returns {{ resultsArray, tokensUsed, model, promptTokens, completionTokens, cachedTokens }}
     */
    async _batchCallAI(prompt, expectedCount, attempt = 1) {
        const openai = getOpenAI();
        const model = getModel();
        const startTime = Date.now();

        // Scale max tokens by number of candidates (each full analysis ≈ 3000–4000 tokens)
        const baseTokens = 4000;
        const maxTokens = Math.min(Math.max(baseTokens * expectedCount, AI_MAX_TOKENS), 60000);

        console.log(`[AI] 🚀 Batch AI call (attempt ${attempt}): model=${model}, candidates=${expectedCount}, max_tokens=${maxTokens}`);

        let actualPrompt = prompt;
        if (attempt > 1 && prompt.length > 40000) {
            console.warn(`[AI] Batch retry: trimming prompt (${prompt.length} chars)`);
            actualPrompt = prompt.slice(0, 40000) + '\n\n[Some resume text was truncated for retry]';
        }

        const params = {
            model,
            messages: [
                {
                    role: 'system',
                    content: `You are Syncro1's advanced talent intelligence engine. Your job is to analyze multiple resumes against a single job description and output ONLY a valid JSON array. Each array element is the full analysis for one candidate. No explanations. No markdown. Terse, deterministic, consistent and evidence-based.`
                },
                { role: 'user', content: actualPrompt }
            ],
            max_completion_tokens: maxTokens,
            response_format: { type: 'json_object' }
        };

        if (model.includes('gpt-5') || model.includes('o1') || model.includes('o3')) {
            params.reasoning_effort = 'low';
        } else {
            params.temperature = 0.1;
        }

        const completion = await openai.chat.completions.create(params);
        const durationMs = Date.now() - startTime;
        const finishReason = completion.choices[0]?.finish_reason;
        const responseText = completion.choices[0]?.message?.content;
        const usage = completion.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
        const totalTokens = usage.total_tokens || 0;

        logTokenUsage(`Batch Resume Matching (${expectedCount} candidates)`, model, usage, finishReason, attempt, durationMs);

        if (finishReason === 'length' && attempt < 2) {
            console.warn('[AI] Batch response truncated — retrying with trimmed prompt...');
            return this._batchCallAI(prompt, expectedCount, 2);
        }

        if (!responseText) throw new Error('Empty batch response from OpenAI');

        // Parse the JSON object wrapper (response_format:json_object prevents a raw array)
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Batch JSON parse failed: ${e.message}`);
        }

        // ── Robust array extraction ────────────────────────────────────────────
        // response_format:json_object means the model wraps the candidates array
        // in an outer object. We must find that array reliably.
        // BUG FIXED: the old code used Object.values().find(Array.isArray) which
        // picked the FIRST array — often skills[] or jobHistory[] from candidate 0,
        // not the top-level candidates array. Now we:
        //   1. Check well-known wrapper keys the model typically uses
        //   2. Pick the largest array whose first element looks like a candidate
        //   3. Fall back to wrapping the whole object as a single candidate
        let resultsArray;

        if (Array.isArray(parsed)) {
            resultsArray = parsed;
        } else {
            // Step 1: check well-known wrapper keys
            const knownKeys = ['candidates', 'results', 'analyses', 'data', 'output', 'evaluations', 'assessments'];
            let found = null;
            for (const k of knownKeys) {
                if (Array.isArray(parsed[k]) && parsed[k].length > 0) {
                    found = parsed[k];
                    break;
                }
            }

            if (found) {
                resultsArray = found;
            } else {
                // Step 2: pick the largest top-level array whose items look like candidate analyses
                let best = null;
                let bestLen = 0;
                for (const v of Object.values(parsed)) {
                    if (Array.isArray(v) && v.length > bestLen) {
                        const first = v[0];
                        const looksLikeCandidate = first && typeof first === 'object' && (
                            first.candidateProfile != null || first.candidateIndex != null ||
                            first.scoring != null || first.recommendation != null || first.rankingSignals != null
                        );
                        if (looksLikeCandidate) {
                            best = v;
                            bestLen = v.length;
                        }
                    }
                }

                if (best) {
                    resultsArray = best;
                } else {
                    // Step 3: whole object is a single candidate
                    console.warn('[AI] Batch: could not find candidates array — treating response as single candidate');
                    resultsArray = [parsed];
                }
            }
        }

        console.log(`[AI] Batch extraction: ${resultsArray.length} result(s) found (expected ${expectedCount}). Top-level keys: [${Object.keys(parsed).join(', ')}]`);

        // Sort by candidateIndex so results align with input order
        resultsArray.sort((a, b) => (a.candidateIndex ?? 0) - (b.candidateIndex ?? 0));

        if (resultsArray.length !== expectedCount) {
            console.warn(`[AI] Batch: expected ${expectedCount} results, got ${resultsArray.length}`);
        }

        return { resultsArray, tokensUsed: totalTokens, model, promptTokens, completionTokens, cachedTokens };
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
        const jobId = rawJobObj._id || rawJobObj.id;

        // Fast non-blocking lookup: check if structured JobPosition already exists in MongoDB (no LLM delay)
        try {
            if (jobId) {
                const JobPosition = require('../models/JobPosition');
                const jobPosition = await JobPosition.findOne({ jobId, parseStatus: 'SUCCESS' }).lean();
                if (jobPosition?.parsedRequirements) {
                    console.log(`[AI] Using pre-parsed JobPosition for job ${jobId}`);
                    const pr = jobPosition.parsedRequirements;
                    const resolvedSkills = {
                        mustHave: Array.isArray(pr.skills?.mustHave) ? pr.skills.mustHave : [],
                        shouldHave: Array.isArray(pr.skills?.shouldHave) ? pr.skills.shouldHave : [],
                        niceToHave: Array.isArray(pr.skills?.niceToHave) ? pr.skills.niceToHave : [],
                    };
                    return {
                        text: JSON.stringify(pr, null, 2),
                        resolvedSkills,
                    };
                }
            }
        } catch (err) {
            console.warn(`[AI] JobPosition fast lookup skipped: ${err.message}.`);
        }

        // Fast zero-latency fallback: construct JD text directly from job document fields
        const resolvedSkills = {
            mustHave: rawJobObj.skills?.required || rawJobObj.skills?.mustHave || (Array.isArray(rawJobObj.skills) ? rawJobObj.skills : []),
            shouldHave: rawJobObj.skills?.preferred || rawJobObj.skills?.shouldHave || [],
            niceToHave: rawJobObj.skills?.niceToHave || [],
        };

        if (resolvedSkills.mustHave.length === 0 && resolvedSkills.shouldHave.length === 0) {
            console.warn('[AI] No JD skills found in job doc — deterministic skill correction will run on resume text');
        }

        return {
            text: this._buildJobDescriptionString(jobDescription),
            resolvedSkills,
        };
    }

    /**
     * Call OpenAI with truncation detection + one retry on truncation or parse failure.
     * Returns { responseText, tokensUsed, model, promptTokens, completionTokens, reasoningTokens }.
     */
    async _callAI(prompt, attempt = 1) {
        const openai = getOpenAI();
        const model = getModel();
        const startTime = Date.now();

        const maxTokens = attempt === 1 ? AI_MAX_TOKENS : 24000;
        console.log(`[AI] Calling OpenAI (attempt ${attempt}), model: ${model}, max_completion_tokens: ${maxTokens}`);

        let actualPrompt = prompt;
        if (attempt > 1 && prompt && prompt.length > 18000) {
            console.warn(`[AI] Retry attempt ${attempt}: Trimming prompt (${prompt.length} -> 18000 chars) to free completion token budget`);
            actualPrompt = prompt.slice(0, 18000) + '\n\n[Resume text summarized for retry execution]';
        }

        const params = {
            model,
            messages: [
                {
                    role: 'system',
                    content: `You are Syncro1's advanced talent intelligence engine. Your job is to analyze resumes against job descriptions and output ONLY valid JSON matching the scoring schema. No explanations. No markdown. Terse, deterministic, consistent and evidence-based.`
                },
                { role: 'user', content: actualPrompt }
            ],
            max_completion_tokens: maxTokens,
            response_format: { type: 'json_object' }
        };

        if (model.includes('gpt-5') || model.includes('gpt-5-mini') || model.includes('o1') || model.includes('o3')) {
            params.reasoning_effort = "low";
            params.verbosity = "low";
        } else {
            params.temperature = 0.1;
        }

        const completion = await openai.chat.completions.create(params);
        const durationMs = Date.now() - startTime;

        const finishReason = completion.choices[0]?.finish_reason;
        const responseText = completion.choices[0]?.message?.content;
        const usage = completion.usage || {};
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
        const totalTokens = usage.total_tokens || 0;

        logTokenUsage('Candidate Resume Matching', model, usage, finishReason, attempt, durationMs);

        // Handle truncation
        if (finishReason === 'length') {
            console.error(`[AI] ⚠️ Response truncated (finish_reason=length, completion_tokens=${completionTokens}, reasoning_tokens=${reasoningTokens})`);
            if (attempt < 2) {
                console.warn('[AI] Retrying with expanded token budget (24000 max_completion_tokens) & trimmed prompt input…');
                return this._callAI(prompt, 2);
            }
            // Write truncation failure to log
            const ScoringLog = require('../models/ScoringLog');
            await ScoringLog.create({
                logType: 'SCORING',
                promptSent: prompt,
                rawResponse: responseText,
                success: false,
                error: `truncated_response (completion_tokens=${completionTokens}, reasoning_tokens=${reasoningTokens})`
            }).catch(() => { });
            throw new Error('AI response truncated after retry — falling back');
        }

        if (!responseText) throw new Error('Empty response from OpenAI');

        const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;
        return { responseText, tokensUsed: totalTokens, model, promptTokens, completionTokens, reasoningTokens, cachedTokens };
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

    /**
 * Score a candidate's experience (years) against a job's required range.
 * Mirror of candidateScoringService._scoreExperience — kept here so the
 * deterministic overwrite can recompute experienceMatch without a circular import.
 * @param {number} expUsed - years to score (relevantExperience if present, else actual)
 * @param {number} min - job required minimum
 * @param {number} max - job required maximum
 * @returns {number} 0-100
 */
    _scoreExperience(expUsed, min, max) {
        if (expUsed >= min && expUsed <= max) return 100;
        if (expUsed < min) {
            const gap = min - expUsed;
            if (gap <= 1) return 70;
            if (gap <= 3) return 40;
            return 20;
        }
        const excess = expUsed - max;
        if (excess <= 2) return 70;
        if (excess <= 4) return 50;
        return 30;
    }

    _applyDeterministicSkillMatch(aiResult, resolvedSkills, experienceRange, jobSalary, candidateFormData, jobDescription) {
        try {
            const candidateSkills = aiResult.candidateProfile?.skills || [];
            const jdSkills = resolvedSkills || {};
            const hasJdSkills = (jdSkills.mustHave?.length || 0) > 0 || (jdSkills.shouldHave?.length || 0) > 0;

            let coverage = 0;
            let skillsMatch = 0;
            let mustTotal = jdSkills.mustHave?.length || 0;
            let shouldTotal = jdSkills.shouldHave?.length || 0;
            let niceTotal = jdSkills.niceToHave?.length || 0;

            let mustHaveMatched = [];
            let mustHaveMissing = [];
            let shouldHaveMatched = [];

            if (candidateSkills.length > 0 && hasJdSkills) {
                const { matchSkills } = require('./skillMatcher');
                // ── Step A: classify skills deterministically ─────────────────
                const result = matchSkills(candidateSkills, jdSkills);
                coverage = result.mustHaveCoveragePercent; // 0–100

                mustHaveMatched = result.mustHaveMatched;
                mustHaveMissing = result.mustHaveMissing;
                shouldHaveMatched = result.shouldHaveMatched;

                console.log('[AI] skillMatcher deterministic overwrite:');
                console.log(`   mustHaveMatched: ${result.mustHaveMatched.length}/${jdSkills.mustHave.length}`);
                console.log(`   mustHaveMissing: ${result.mustHaveMissing.length}`);
                console.log(`   shouldHaveMatched: ${result.shouldHaveMatched.length}`);
                console.log(`   coverage: ${coverage}%`);

                // ── Step B: overwrite rankingSignals classification arrays ─────
                if (!aiResult.rankingSignals) aiResult.rankingSignals = {};
                aiResult.rankingSignals.mustHaveSkillsMatched = result.mustHaveMatched;
                aiResult.rankingSignals.mustHaveSkillsMissing = result.mustHaveMissing;
                aiResult.rankingSignals.mustHaveSkillsMatchedCount = result.mustHaveMatched.length;
                aiResult.rankingSignals.mustHaveSkillsTotal = jdSkills.mustHave.length;
                aiResult.rankingSignals.shouldHaveSkillsMatched = result.shouldHaveMatched;
                aiResult.rankingSignals.shouldHaveSkillsMissing = result.shouldHaveMissing;
                aiResult.rankingSignals.niceToHaveSkillsMatched = result.niceToHaveMatched;

                // ── Step C: recompute skillsMatch (100% required / 0% preferred / 0% optional) ──
                skillsMatch = (result.mustHaveMatched.length / Math.max(mustTotal, 1)) * 100;
                if (coverage < 30) skillsMatch = Math.min(skillsMatch, 15);
                skillsMatch = Math.round(skillsMatch);
            } else {
                skillsMatch = aiResult.scoring?.skillsMatch || 0;
                coverage = aiResult.scoring?.skillCoveragePercent || 0;

                if (aiResult.rankingSignals) {
                    mustHaveMatched = aiResult.rankingSignals.mustHaveSkillsMatched || [];
                    mustHaveMissing = aiResult.rankingSignals.mustHaveSkillsMissing || [];
                    shouldHaveMatched = aiResult.rankingSignals.shouldHaveSkillsMatched || [];
                }
            }

            // ── Step D: recompute weightedScore (trust AI for other 6 components, overwrite exp & salary) ──
            if (!aiResult.scoring) aiResult.scoring = {};
            const s = aiResult.scoring;

            // ── Step D2: recompute experienceMatch deterministically ───────
            // Strictly resume-only: only use actualTotalMonths parsed from the resume.
            // No formData fallback — if resume has no jobHistory, score stays as-is from AI.
            const expRange = experienceRange || {};
            const { min: expMin, max: expMax } = expRange;
            let experienceMatch = s.experienceMatch || 0;
            if (expMin != null && expMax != null) {
                const actualYears = aiResult.candidateProfile?.actualTotalMonths
                    ? Math.round((aiResult.candidateProfile.actualTotalMonths / 12) * 10) / 10
                    : null;
                if (actualYears != null && actualYears >= 0) {
                    experienceMatch = this._scoreExperience(actualYears, expMin, expMax);
                    console.log(`[AI] 📊 Experience scored: ${actualYears} yrs vs JD [${expMin}–${expMax}] → ${experienceMatch}`);
                } else {
                    console.warn(`[AI] ⚠️ Experience score not recomputed — resume had no parsed jobHistory (actualTotalMonths=null)`);
                }
            }
            aiResult.scoring.experienceMatch = experienceMatch;

            // ── Step D3: recompute salaryFit deterministically ─────────────
            // Resolve job salary: handles { min, max } or { minimum, maximum } or jobDescription.salary
            const resolvedJobSalary = jobSalary || jobDescription?.salary || jobDescription?.compensation || {};
            const jobMaxRaw = resolvedJobSalary.max ?? resolvedJobSalary.maximum ?? null;
            const jobMinRaw = resolvedJobSalary.min ?? resolvedJobSalary.minimum ?? 0;

            // Resolve candidate salary: candidateFormData.expectedSalary -> candidateProfile.expectedSalary -> currentSalary
            const rawCandExpected = candidateFormData?.expectedSalary
                ?? aiResult.candidateProfile?.expectedSalary
                ?? null;

            const rawCandCurrent = candidateFormData?.currentSalary
                ?? aiResult.candidateProfile?.currentSalary
                ?? null;

            const candExpectedLPA = this._normalizeSalaryToLPA(rawCandExpected);
            const candCurrentLPA = this._normalizeSalaryToLPA(rawCandCurrent);
            const effectiveCandSalaryLPA = candExpectedLPA > 0 ? candExpectedLPA : candCurrentLPA;

            const jobMaxLPA = this._normalizeSalaryToLPA(jobMaxRaw);
            const jobMinLPA = this._normalizeSalaryToLPA(jobMinRaw);

            if (!aiResult.screening) aiResult.screening = {};
            if (!aiResult.validation) aiResult.validation = {};
            if (!aiResult.rankingSignals) aiResult.rankingSignals = {};

            if (effectiveCandSalaryLPA > 0 && jobMaxLPA > 0) {
                const salaryResult = this._scoreSalary(effectiveCandSalaryLPA, { min: jobMinLPA, max: jobMaxLPA });
                aiResult.scoring.salaryFit = salaryResult.score;
                aiResult.screening.salaryFit = {
                    budget: jobMinLPA > 0 ? `${jobMinLPA} - ${jobMaxLPA} LPA` : `<= ${jobMaxLPA} LPA`,
                    expected: `${effectiveCandSalaryLPA} LPA`,
                    deltaPercent: salaryResult.deltaPercent,
                    status: salaryResult.status
                };
                aiResult.validation.salaryStatus = salaryResult.status;
                aiResult.validation.salaryDeltaPercent = salaryResult.deltaPercent;
                aiResult.rankingSignals.salaryWithinBudget = salaryResult.withinBudget;
                console.log(`[AI] 💰 Salary scored: ${effectiveCandSalaryLPA} LPA vs JD [${jobMinLPA}–${jobMaxLPA} LPA] → ${salaryResult.score} (${salaryResult.status})`);
            } else if (jobMaxLPA > 0) {
                // Job has salary range, but candidate provided neither expected nor current salary
                aiResult.scoring.salaryFit = 70;
                aiResult.screening.salaryFit = {
                    budget: jobMinLPA > 0 ? `${jobMinLPA} - ${jobMaxLPA} LPA` : `<= ${jobMaxLPA} LPA`,
                    expected: 'Not provided',
                    deltaPercent: 0,
                    status: 'UNKNOWN'
                };
                aiResult.validation.salaryStatus = 'UNKNOWN';
                aiResult.rankingSignals.salaryWithinBudget = true;
                console.log(`[AI] 💰 Salary: Candidate salary not provided — using default score 70`);
            } else if (effectiveCandSalaryLPA > 0) {
                // Candidate provided salary, but JD has no budget specified
                aiResult.scoring.salaryFit = 80;
                aiResult.screening.salaryFit = {
                    budget: 'Not specified',
                    expected: `${effectiveCandSalaryLPA} LPA`,
                    deltaPercent: 0,
                    status: 'UNKNOWN'
                };
                aiResult.validation.salaryStatus = 'UNKNOWN';
                aiResult.rankingSignals.salaryWithinBudget = true;
                console.log(`[AI] 💰 Salary: JD has no budget — using score 80 for candidate salary ${effectiveCandSalaryLPA} LPA`);
            } else {
                // Neither candidate nor JD salary specified
                aiResult.scoring.salaryFit = 70;
                aiResult.screening.salaryFit = {
                    budget: 'Not specified',
                    expected: 'Not provided',
                    deltaPercent: 0,
                    status: 'UNKNOWN'
                };
                aiResult.validation.salaryStatus = 'UNKNOWN';
                aiResult.rankingSignals.salaryWithinBudget = true;
                console.log(`[AI] 💰 Salary: Neither candidate nor JD salary specified — default score 70`);
            }

            // ── Step D4: recompute educationMatch deterministically ──────────
            if (jobDescription) {
                const candidateEdu = aiResult.candidateProfile?.education || [];
                const eduResult = this._scoreEducation(candidateEdu, jobDescription);

                aiResult.scoring.educationMatch = eduResult.score;

                if (!aiResult.screening) aiResult.screening = {};
                let detailedRequired = 'Not specified';
                if (jobDescription.education) {
                    if (jobDescription.education.minimum) {
                        detailedRequired = jobDescription.education.minimum;
                    } else if (jobDescription.educationRequirement) {
                        detailedRequired = jobDescription.educationRequirement;
                    }

                    if (Array.isArray(jobDescription.education.preferred) && jobDescription.education.preferred.length > 0) {
                        const filteredPref = jobDescription.education.preferred.filter(p => p && p.trim() !== '');
                        if (filteredPref.length > 0) {
                            detailedRequired += ` (Preferred: ${filteredPref.join(', ')})`;
                        }
                    }
                } else if (jobDescription.educationRequirement) {
                    detailedRequired = jobDescription.educationRequirement;
                }

                aiResult.screening.educationMatch = {
                    minimumRequired: detailedRequired,
                    candidateEducation: eduResult.candidateEducation || 'Not provided',
                    status: eduResult.status
                };

                if (!aiResult.validation) aiResult.validation = {};
                aiResult.validation.educationStatus = eduResult.status;
            }

            // ── Step D5: recompute locationMatch deterministically ──────────
            if (jobDescription) {
                const candLoc = candidateFormData?.location || '';
                const willingToRelocate = candidateFormData?.willingToRelocate !== undefined
                    ? candidateFormData.willingToRelocate
                    : aiResult.candidateProfile?.willingToRelocate;
                const preferredLocations = candidateFormData?.preferredLocations || aiResult.candidateProfile?.preferredLocations || [];

                const locResult = this._scoreLocation(
                    candLoc,
                    preferredLocations,
                    willingToRelocate,
                    jobDescription.location
                );

                aiResult.scoring.locationMatch = locResult.score;

                if (!aiResult.screening) aiResult.screening = {};
                const parsedRelocate = (willingToRelocate === true || willingToRelocate === 'true') ? true : (willingToRelocate === false || willingToRelocate === 'false') ? false : null;
                aiResult.screening.locationFit = {
                    jobLocation: jobDescription.location?.city ? (Array.isArray(jobDescription.location.city) ? jobDescription.location.city.join(', ') : jobDescription.location.city) : 'Not specified',
                    candidateLocation: candLoc || 'Not specified',
                    status: locResult.status,
                    willingToRelocate: parsedRelocate
                };

                if (!aiResult.validation) aiResult.validation = {};
                aiResult.validation.locationMatch = locResult.status;
            }

            aiResult.scoring.skillsMatch = skillsMatch;
            aiResult.scoring.skillCoveragePercent = coverage;

            // ── Step D6: deterministic stability recompute ──────────────────────
            // Uses the AI-extracted jobHistory (reliable dates) rather than AI's
            // hand-summed stability score, which is often wrong.
            try {
                const scoringService = require('./candidateScoringService');
                const rawJobHistory = (Array.isArray(aiResult.candidateProfile?.jobHistory) && aiResult.candidateProfile.jobHistory.length > 0)
                    ? aiResult.candidateProfile.jobHistory
                    : ((Array.isArray(aiResult.aiData?.profile?.jobHistory) && aiResult.aiData.profile.jobHistory.length > 0)
                        ? aiResult.aiData.profile.jobHistory
                        : ((Array.isArray(candidateFormData?.jobHistory) && candidateFormData.jobHistory.length > 0)
                            ? candidateFormData.jobHistory
                            : (Array.isArray(candidateFormData?.experience) ? candidateFormData.experience : (Array.isArray(aiResult.candidateProfile?.experience) ? aiResult.candidateProfile.experience : []))));

                const stabProfile = {
                    jobHistory: rawJobHistory,
                    experience: aiResult.candidateProfile?.experience || candidateFormData?.experience || [],
                };
                const stabResult = scoringService._scoreStability(stabProfile);
                aiResult.scoring.stabilityScore = stabResult.score;
                if (!aiResult.screening) aiResult.screening = {};
                aiResult.screening.stabilityAnalysis = {
                    totalAverageTenureYears: stabResult.totalAverageTenureYears,
                    last5YearAverageTenureYears: stabResult.last5YearAverageTenureYears,
                    isJobHopper: stabResult.isJobHopper,
                    stabilityRisk: stabResult.risk,
                    scoredOn: 'last5Years',
                    detail: stabResult.detail,
                };
            } catch (stabErr) {
                console.error('[AI] Stability recompute failed (non-fatal):', stabErr.message);
            }

            const weightedScore = Math.round(
                skillsMatch * 0.30 +
                (s.experienceMatch || 0) * 0.20 +
                (s.locationMatch || 0) * 0.10 +
                (s.salaryFit || 0) * 0.10 +
                (s.noticePeriodFit || 0) * 0.10 +
                (aiResult.scoring.stabilityScore ?? s.stabilityScore ?? 0) * 0.10 +
                (aiResult.scoring.domainMatch ?? s.domainMatch ?? 0) * 0.05 +
                (s.educationMatch || 0) * 0.05
            );
            aiResult.scoring.weightedScore = weightedScore;

            // ── Step E: recompute finalAdjustedScore + preferred bonus + skill gate ─────────
            const prefTotal = (resolvedSkills?.shouldHave || jdSkills?.shouldHave || []).length;
            const shouldMatchedCount = (shouldHaveMatched || []).length;
            const preferredBonus = (prefTotal > 0 && (shouldMatchedCount / prefTotal) >= 0.5) ? 5 : 0;

            let finalAdjustedScore = Math.min(100, Math.max(0, weightedScore - (s.riskPenalty || 0)) + preferredBonus);
            const skillGate = coverage < 30;
            if (skillGate) finalAdjustedScore = Math.min(finalAdjustedScore, 25);
            aiResult.scoring.preferredBonus = preferredBonus;
            aiResult.scoring.finalAdjustedScore = finalAdjustedScore;

            // ── Step F: recompute matchLevel and decision ─────────────────
            let matchLevel, decision;
            if (finalAdjustedScore >= 80) matchLevel = 'STRONG';
            else if (finalAdjustedScore >= 65) matchLevel = 'GOOD';
            else if (finalAdjustedScore >= 50) matchLevel = 'PARTIAL';
            else matchLevel = 'WEAK';

            if (finalAdjustedScore >= 70) decision = 'SHORTLIST';
            else if (finalAdjustedScore >= 50) decision = 'HOLD';
            else decision = 'REJECT';

            // Skill gate forces worst-case outcome regardless of other scores
            if (skillGate) { matchLevel = 'WEAK'; decision = 'REJECT'; }

            aiResult.matchLevel = matchLevel;
            if (!aiResult.recommendation) aiResult.recommendation = {};
            aiResult.recommendation.decision = decision;
            aiResult.recommendation.skillGate = skillGate;

            // ── Step G: recompute priorityScore (same formula as scoring-prompt.txt) ──
            const withinBudget = aiResult.rankingSignals?.salaryWithinBudget ?? true;
            const noticeFit = s.noticePeriodFit || 0;
            const priorityScore = Math.round(
                (mustHaveMatched.length / Math.max(mustTotal, 1)) * 40 +
                finalAdjustedScore * 0.40 +
                noticeFit * 0.10 +
                (withinBudget ? 10 : 0)
            );
            aiResult.rankingSignals.priorityScore = priorityScore;
            if (aiResult.recommendation) aiResult.recommendation.priorityScore = priorityScore;

            console.log(`[AI] Re-derived scores: skillsMatch=${skillsMatch}, weighted=${weightedScore}, final=${finalAdjustedScore}, ${matchLevel}/${decision}${skillGate ? ' [SKILL_GATE]' : ''}`);

        } catch (err) {
            // Non-fatal — if matcher fails, keep AI output as-is
            console.error('[AI] skillMatcher overwrite failed (non-fatal):', err.stack || err.message);
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
            .replace('{{firstName}}', formData.firstName || 'Not provided')
            .replace('{{lastName}}', formData.lastName || 'Not provided')
            .replace('{{email}}', formData.email || 'Not provided')
            .replace('{{mobile}}', formData.mobile || 'Not provided')
            .replace('{{location}}', formData.location || 'Not provided')
            .replace('{{willingToRelocate}}', formData.willingToRelocate === true ? 'Yes' : formData.willingToRelocate === false ? 'No' : 'Not specified')
            .replace('{{totalExperience}}', formData.totalExperience || 'Not provided')
            .replace('{{relevantExperience}}', formData.relevantExperience || 'Not provided')
            .replace('{{noticePeriod}}', formData.noticePeriod || 'Not provided')
            .replace('{{currentSalary}}', this._formatSalaryForPrompt(formData.currentSalary))
            .replace('{{expectedSalary}}', this._formatSalaryForPrompt(formData.expectedSalary))
            .replace('{{partnerReportedSkills}}', skillsString)
            .replace('{{partnerReportedEducation}}', educationString)
            .replace('{{partnerReportedCertifications}}', certificationsString)
            .replace('{{partnerReportedLanguages}}', languagesString)
            .replace('{{candidateWriteup}}', formData.writeup || 'Not provided')
            .replace('{{resumeText}}', resumeText)
            .replace('{{jobDescription}}', jobDescriptionText);
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
        if (jobObj.title) lines.push(`Title: ${jobObj.title}`);
        if (jobObj.category) lines.push(`Category: ${jobObj.category}`);
        if (jobObj.employmentType) lines.push(`Employment Type: ${jobObj.employmentType}`);
        if (jobObj.experienceLevel) lines.push(`Experience Level: ${jobObj.experienceLevel}`);
        if (jobObj.experienceRange) lines.push(`Experience Required: ${jobObj.experienceRange.min} to ${jobObj.experienceRange.max} years`);

        if (jobObj.salary) {
            const minStr = this._formatSalaryForPrompt(jobObj.salary.min);
            const maxStr = this._formatSalaryForPrompt(jobObj.salary.max);
            lines.push(`Salary Budget: ${minStr} to ${maxStr}`);
        }

        if (jobObj.location) {
            const loc = [];
            if (jobObj.location.city) loc.push(jobObj.location.city);
            if (jobObj.location.state) loc.push(jobObj.location.state);
            if (jobObj.location.isRemote) loc.push('Remote OK');
            if (jobObj.location.isHybrid) loc.push('Hybrid');
            lines.push(`Location: ${loc.join(', ')}`);
        }

        if (jobObj.skills?.required?.length > 0) lines.push(`MUST-HAVE Skills: ${jobObj.skills.required.join(', ')}`);
        if (jobObj.skills?.preferred?.length > 0) lines.push(`PREFERRED Skills: ${jobObj.skills.preferred.join(', ')}`);
        if (jobObj.description) lines.push(`\nJob Description:\n${jobObj.description.substring(0, 1000)}`);
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
            lastName: formData.lastName || this._cleanString(profile.extractedName?.split(' ').slice(1).join(' ')),
            email: formData.email || this._cleanEmail(profile.extractedEmail),
            mobile: formData.mobile || this._cleanMobile(profile.extractedMobile),

            profile: {
                currentCompany: this._cleanString(profile.currentCompany),
                currentDesignation: this._cleanString(profile.currentDesignation),
                totalExperience: formData.totalExperience || null,
                relevantExperience: formData.relevantExperience || null,
                currentLocation: this._cleanString(profile.standardizedLocation) || formData.location,
                skills: Array.isArray(profile.skills) ? profile.skills.filter(Boolean) : [],
                education: Array.isArray(profile.education) ? profile.education : [],
                // Preserve AI-calculated experience data
                totalExperienceMonths: profile.actualTotalMonths || null,
                experienceYears: profile.actualTotalMonths ? Math.round((profile.actualTotalMonths / 12) * 10) / 10 : null,
                experience: Array.isArray(profile.experience) ? profile.experience : [],
                jobHistory: Array.isArray(profile.jobHistory) && profile.jobHistory.length > 0 ? profile.jobHistory : (Array.isArray(profile.experience) ? profile.experience : []),
                languages: Array.isArray(profile.languages) ? profile.languages : [],
                certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
                noticePeriod: formData.noticePeriod || null,
                currentSalary: formData.currentSalary || null,
                expectedSalary: formData.expectedSalary || null,
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

    _detectFileType(buffer, contentType = '', url = '') {
        if (!buffer || buffer.length < 4) return 'unknown';

        // 1. Magic bytes check (100% reliable content detection)
        // PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
        if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
            return 'pdf';
        }
        // DOCX magic bytes (ZIP archive): PK\x03\x04 (0x50 0x4B 0x03 0x04)
        if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
            return 'docx';
        }
        // Legacy DOC magic bytes (OLE2 compound doc): 0xD0 0xCF 0x11 0xE0
        if (buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0) {
            return 'doc';
        }

        // 2. Content-Type header fallback
        const ct = (contentType || '').toLowerCase();
        if (ct.includes('pdf')) return 'pdf';
        if (ct.includes('wordprocessingml') || ct.includes('docx')) return 'docx';
        if (ct.includes('msword') || ct.includes('doc')) return 'doc';

        // 3. URL extension fallback
        const u = (url || '').toLowerCase().split('?')[0];
        if (u.endsWith('.docx') || u.includes('.docx')) return 'docx';
        if (u.endsWith('.doc') || u.includes('.doc')) return 'doc';
        if (u.endsWith('.pdf') || u.includes('.pdf')) return 'pdf';

        return 'unknown';
    }

    async _extractTextFromUrl(url) {
        try {
            if (!url || typeof url !== 'string') {
                throw new Error('Resume URL is required');
            }

            console.log(`[AI] Downloading resume from URL: ${url}`);
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 15 * 1024 * 1024,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const buffer = Buffer.from(response.data);
            const contentType = response.headers['content-type'] || '';
            const detectedType = this._detectFileType(buffer, contentType, url);

            console.log(`[AI] File type detected via magic bytes: [${detectedType.toUpperCase()}] for URL: ${url}`);

            if (detectedType === 'pdf') {
                return await this._extractFromPdfBuffer(buffer, url);
            }

            if (detectedType === 'docx' || detectedType === 'doc') {
                return await this._extractFromDocBuffer(buffer, url);
            }

            // Unknown file type fallback: try DOCX/DOC first, then PDF
            try {
                return await this._extractFromDocBuffer(buffer, url);
            } catch (docErr) {
                try {
                    return await this._extractFromPdfBuffer(buffer, url);
                } catch (pdfErr) {
                    const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
                    return text.length > 50 ? text : `Resume file (${url})`;
                }
            }
        } catch (error) {
            console.error(`[AI] URL extraction error for (${url}): ${error.message}`);
            throw new Error(`Could not download resume: ${error.message}`);
        }
    }

    async _extractFromPdfBuffer(buffer, url = '') {
        try {
            const pdfParse = require('pdf-parse');
            const data = await pdfParse(buffer);
            if (data.text && data.text.trim().length > 30) {
                console.log(`[AI] ✅ PDF parsed via pdf-parse: ${data.text.length} chars, ${data.numpages} pages`);
                return data.text.trim();
            }
        } catch (pdfError) {
            console.warn('[AI] pdf-parse error (non-fatal, trying string fallback):', pdfError.message);
        }

        const text = buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 50) {
            console.log(`[AI] ✅ PDF extracted via string fallback: ${text.length} chars`);
            return text;
        }
        return `Resume PDF file (${url})`;
    }

    async _extractFromDocBuffer(buffer, url = '') {
        // 1. Try mammoth first for DOCX files
        try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            if (result.value && result.value.trim().length > 30) {
                console.log(`[AI] ✅ DOCX extracted via Mammoth: ${result.value.length} chars`);
                return result.value.trim();
            }
        } catch (mammothError) {
            console.log('[AI] mammoth error (non-fatal, proceeding to DOC fallback):', mammothError.message);
        }

        // 2. Dual-encoding binary stream text extractor for legacy .doc & non-standard DOCX
        console.log('[AI] Running binary stream text extractor for DOC/DOCX...');

        const utf16Str = buffer.toString('utf16le');
        const utf16Matches = utf16Str.match(/[\x20-\x7E\n\r\t]{3,}/g) || [];
        const utf16Text = utf16Matches.map(s => s.trim()).filter(s => s.length > 2).join(' ');

        const latin1Str = buffer.toString('latin1');
        const latin1Matches = latin1Str.match(/[\x20-\x7E\n\r\t]{3,}/g) || [];
        const latin1Text = latin1Matches.map(s => s.trim()).filter(s => s.length > 2).join(' ');

        const bestText = utf16Text.length >= latin1Text.length ? utf16Text : latin1Text;
        const cleanedText = bestText
            .replace(/<[^>]+>/g, ' ')
            .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanedText.length > 50) {
            console.log(`[AI] ✅ DOC/DOCX extracted via binary stream fallback: ${cleanedText.length} chars`);
            return cleanedText;
        }

        console.warn('[AI] ⚠️ DOC/DOCX extraction produced sparse text');
        return `Resume document file (${url})`;
    }

    async _extractFromPdf(url) {
        return await this._extractTextFromUrl(url);
    }

    async _extractFromDoc(url) {
        return await this._extractTextFromUrl(url);
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

    _scoreEducation(education, job) {
        const candidateDegrees = (Array.isArray(education) ? education : [])
            .map(e => e?.degree)
            .filter(d => d && typeof d === 'string');

        const primaryDegree = candidateDegrees[0] || (typeof education === 'string' ? education : null);
        if (!primaryDegree && candidateDegrees.length === 0) {
            return { score: 50, status: 'UNKNOWN', candidateEducation: 'Not provided' };
        }



        const preferredList = (job?.education && Array.isArray(job.education.preferred))
            ? job.education.preferred.filter(p => p && p.trim() !== '')
            : [];
        const minEdu = job?.education?.minimum || job?.educationRequirement || '';

        const degreesToCheck = candidateDegrees.length > 0 ? candidateDegrees : [primaryDegree];
        const candHighestLevel = Math.max(...degreesToCheck.map(d => getEduLevel(d)));

        // Step 1 — Check preferred first
        if (preferredList.length > 0) {
            const prefHighestLevel = Math.max(...preferredList.map(p => getEduLevel(p)));
            if (prefHighestLevel !== -1 && candHighestLevel >= prefHighestLevel) {
                return { score: 100, status: 'EXCEEDS', candidateEducation: primaryDegree };
            }
        }

        // Step 2 — Check minimum
        if (minEdu) {
            const minLevel = getEduLevel(minEdu);
            if (minLevel === -1) {
                return { score: 75, status: 'MEETS', candidateEducation: primaryDegree };
            }
            if (candHighestLevel >= minLevel) {
                return { score: 100, status: 'MEETS', candidateEducation: primaryDegree };
            }
            const diff = minLevel - candHighestLevel;
            if (diff === 1) return { score: 60, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
            if (diff === 2) return { score: 30, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
            return { score: 0, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
        }

        // No requirements specified
        return { score: 100, status: 'MEETS', candidateEducation: primaryDegree };
    }

    _scoreLocation(current, preferred, willingToRelocate, jobLoc) {
        if (!jobLoc?.city) return { score: 50, status: 'UNKNOWN', detail: 'Job location not specified' };

        const jobCities = Array.isArray(jobLoc.city) ? jobLoc.city : [jobLoc.city];
        const displayCities = jobCities.join(', ');

        // Remote jobs — no location constraint
        if (jobLoc.isRemote || matchCandidateCityToJobCities('remote', jobCities)) {
            return { score: 100, status: 'EXACT', detail: 'Remote — no location constraint' };
        }

        // Exact city match with alias normalization (Bengaluru == Bangalore, Bombay == Mumbai…)
        if (current && matchCandidateCityToJobCities(current, jobCities)) {
            return { score: 100, status: 'EXACT', detail: `Already in ${displayCities}` };
        }

        // Preferred locations match
        const prefMatch = (preferred || []).some(pref => matchCandidateCityToJobCities(pref, jobCities));
        if (prefMatch) {
            return { score: 80, status: 'NEARBY', detail: `${displayCities} is a preferred location` };
        }

        if (jobLoc.isHybrid && willingToRelocate) {
            return { score: 60, status: 'NEARBY', detail: 'Hybrid role — willing to relocate' };
        }
        if (willingToRelocate) {
            return { score: 60, status: 'DIFFERENT', detail: 'Different city — willing to relocate' };
        }
        return { score: 20, status: 'DIFFERENT', detail: `In ${current || 'unknown city'} — relocation not confirmed` };
    }

    _normalizeSalaryToLPA(val) {
        if (val == null || val === '') return 0;
        if (typeof val === 'number') {
            if (val <= 0 || isNaN(val)) return 0;
            if (val < 100) return Number(val.toFixed(2)); // e.g. 12 or 15.5 LPA
            return Number((val / 100000).toFixed(2));    // e.g. 1200000 -> 12 LPA
        }
        const str = String(val).replace(/,/g, '').trim();
        if (!str) return 0;
        const match = str.match(/(\d+(?:\.\d+)?)/);
        if (!match) return 0;
        const num = parseFloat(match[1]);
        if (isNaN(num) || num <= 0) return 0;
        if (num < 100) return Number(num.toFixed(2));
        return Number((num / 100000).toFixed(2));
    }

    _scoreSalary(expected, jobSalary) {
        const normExpected = this._normalizeSalaryToLPA(expected);
        const normMax = this._normalizeSalaryToLPA(jobSalary?.max ?? jobSalary?.maximum);
        const normMin = this._normalizeSalaryToLPA(jobSalary?.min ?? jobSalary?.minimum);

        if (normExpected <= 0 || normMax <= 0) {
            return { score: 70, status: 'UNKNOWN', detail: 'Salary data not fully available', deltaPercent: 0, withinBudget: true };
        }

        const deltaPercent = Math.round(((normExpected / normMax) - 1) * 100);

        if (normMin > 0 && normExpected < normMin) {
            return { score: 100, status: 'BELOW_BUDGET', detail: 'Below budget minimum', deltaPercent, withinBudget: true };
        }
        if (normExpected <= normMax) {
            return { score: 100, status: 'WITHIN', detail: 'Within budget', deltaPercent, withinBudget: true };
        }
        if (normExpected <= normMax * 1.10) {
            return { score: 80, status: 'SLIGHTLY_OVER', detail: `${deltaPercent}% above — may be negotiable`, deltaPercent, withinBudget: false };
        }
        if (normExpected <= normMax * 1.20) {
            return { score: 60, status: 'OVER', detail: `${deltaPercent}% above budget`, deltaPercent, withinBudget: false };
        }
        if (normExpected <= normMax * 1.30) {
            return { score: 40, status: 'OVER', detail: `${deltaPercent}% above budget`, deltaPercent, withinBudget: false };
        }
        return { score: 20, status: 'OVER', detail: `${deltaPercent}% above — unlikely to fit`, deltaPercent, withinBudget: false };
    }

    _formatSalaryForPrompt(val) {
        if (val == null || val === '') return 'Not specified';
        const num = Number(String(val).replace(/,/g, ''));
        if (isNaN(num)) return val;
        let rupees = num;
        if (num < 100) {
            rupees = num * 100000;
        }
        const lpa = Number((rupees / 100000).toFixed(2));
        return `₹${rupees.toLocaleString('en-IN')} per annum (${lpa} LPA)`;
    }
}

const instance = new AIService();
instance.logTokenUsage = logTokenUsage;
module.exports = instance;