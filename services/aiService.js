// backend/services/aiService.js
const { getOpenAI, getModel } = require('../config/ai');
const axios = require('axios');

class AIService {
    constructor() {
        this.enabled = process.env.AI_ENABLED === 'true';
    }

    /**
     * Parse AND Score resume against Job Description
     * Called after candidate consent confirmed
     */
    async parseResume(resumeUrl, fileName = '', candidateFormData = {}, jobDescription = {}) {
        if (!this.enabled) {
            console.log('[AI] Resume parsing disabled');
            return this._getEmptyResumeData();
        }

        const openai = getOpenAI();
        if (!openai) {
            console.log('[AI] OpenAI not configured');
            return this._getEmptyResumeData();
        }

        try {
            console.log(`[AI] Parsing resume: ${fileName || resumeUrl}`);

            // Step 1: Extract text from resume PDF
            const resumeText = await this._extractTextFromUrl(resumeUrl);

            if (!resumeText || resumeText.trim().length < 30) {
                console.warn('[AI] Could not extract enough text from resume');
                return this._getEmptyResumeData();
            }

            console.log(`[AI] Extracted ${resumeText.length} characters from resume`);

            // Step 2: Build the advanced prompt
            const prompt = this._buildAdvancedPrompt(
                candidateFormData,
                resumeText,
                jobDescription
            );

            // Step 3: Call OpenAI
            const model = getModel();
            console.log(`[AI] Sending to OpenAI model: ${model}`);

            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `You are Syncro1's advanced talent intelligence engine.
Your job is to analyze resumes against job descriptions and output ONLY valid JSON.
No explanations. No markdown. No text outside JSON.
Be deterministic, consistent and evidence-based in all scoring.`
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.1,
                max_tokens: 3000,
                response_format: { type: 'json_object' }
            });

            const responseText = completion.choices[0]?.message?.content;

            if (!responseText) {
                console.error('[AI] Empty response from OpenAI');
                return this._getEmptyResumeData();
            }

            console.log(`[AI] OpenAI response received. Tokens used: ${completion.usage?.total_tokens}`);

            // Step 4: Parse JSON response
            let aiResult;
            try {
                aiResult = JSON.parse(responseText);
            } catch (parseError) {
                console.error('[AI] Failed to parse JSON response:', parseError.message);
                return this._getEmptyResumeData();
            }

            // Step 5: Extract and structure the data
            const structuredData = this._structureAIResult(aiResult, candidateFormData);

            console.log(`[AI] ✅ Analysis complete!`);
            console.log(`   Candidate: ${candidateFormData.firstName} ${candidateFormData.lastName}`);
            console.log(`   Final Score: ${aiResult.scoring?.finalAdjustedScore}/100`);
            console.log(`   Match Level: ${aiResult.matchLevel}`);
            console.log(`   Decision: ${aiResult.recommendation?.decision}`);
            console.log(`   Skills Coverage: ${aiResult.scoring?.skillCoveragePercent}%`);

            return {
                success: true,
                data: structuredData,
                fullAnalysis: aiResult,
                confidence: this._buildConfidence(aiResult),
                provider: 'openai',
                model,
                tokensUsed: completion.usage?.total_tokens
            };

        } catch (error) {
            console.error(`[AI] ❌ Resume parsing failed: ${error.message}`);

            if (error.status === 429) {
                console.error('[AI] Rate limit exceeded');
            } else if (error.status === 401) {
                console.error('[AI] Invalid API key');
            }

            return this._getEmptyResumeData();
        }
    }

    /**
     * Build the advanced Syncro1 AI prompt
     */
    _buildAdvancedPrompt(formData, resumeText, job) {
        // Build job description string
        const jobDescription = this._buildJobDescriptionString(job);

        return `You are Syncro1's advanced talent intelligence engine.

Your responsibilities:
1. Extract and normalize resume data.
2. Validate candidate inputs vs resume.
3. Evaluate against JD using deterministic scoring.
4. Generate structured, numeric, and comparable outputs.
5. Enable ranking across multiple candidates.

---

STRICT RULES:
- Output ONLY valid JSON.
- No explanations outside JSON.
- No hallucination. Missing data → use "Not Found".
- Scores must be consistent, reproducible, and evidence-based.

---

SCORING MODEL (MANDATORY):
skillsMatchWeight = 40
experienceMatchWeight = 25
salaryFitWeight = 10
locationMatchWeight = 10
noticePeriodWeight = 15

---

CALCULATION:
weightedScore =
(skillsMatch * 0.40) +
(experienceMatch * 0.25) +
(salaryFit * 0.10) +
(locationMatch * 0.10) +
(noticePeriodFit * 0.15)

Round to nearest integer.

---

NORMALIZATION RULES:
- All scores must be between 0–100
- Use integers only (no decimals)
- Penalize missing MUST-HAVE skills heavily
- Cap total score at 50 if critical JD skills missing

---

MATCH LEVEL:
STRONG → 80–100
GOOD → 65–79
PARTIAL → 50–64
WEAK → below 50

---

RANKING LOGIC:
Also compute:
- skillCoveragePercent = percentage of JD must-have skills matched
- experienceRelevancePercent
- riskPenalty (0–20 deduction based on red flags)

FinalAdjustedScore = weightedScore - riskPenalty (minimum 0)

---

CONSISTENCY CHECK:
- High score + high risk → reduce finalAdjustedScore
- Recommendation must align with FinalAdjustedScore
- SHORTLIST only if FinalAdjustedScore >= 65
- HOLD if FinalAdjustedScore >= 45
- REJECT if FinalAdjustedScore < 45

---

### Candidate Form Data (entered by recruiter):
firstName: ${formData.firstName || 'Not provided'}
lastName: ${formData.lastName || 'Not provided'}
email: ${formData.email || 'Not provided'}
mobile: ${formData.mobile || 'Not provided'}
location: ${formData.location || 'Not provided'}
totalExperience: ${formData.totalExperience || 'Not provided'} years
relevantExperience: ${formData.relevantExperience || 'Not provided'} years
noticePeriod: ${formData.noticePeriod || 'Not provided'}
currentSalary: ${formData.currentSalary || 'Not provided'} INR per annum
expectedSalary: ${formData.expectedSalary || 'Not provided'} INR per annum
writeup: ${formData.writeup || 'Not provided'}

### Resume Text (extracted from PDF):
${resumeText.substring(0, 6000)}

### Job Description:
${jobDescription}

---

### REQUIRED OUTPUT (STRICT JSON — no other text):

{
  "candidateProfile": {
    "extractedName": "full name from resume",
    "extractedEmail": "email from resume or Not Found",
    "extractedMobile": "mobile from resume or Not Found",
    "currentCompany": "company name or Not Found",
    "currentDesignation": "designation or Not Found",
    "skills": ["skill1", "skill2"],
    "actualTotalExperience": "X years from resume",
    "standardizedLocation": "City, State from resume",
    "education": [{"degree": "", "institution": "", "year": 0}],
    "languages": [],
    "certifications": []
  },

  "scoring": {
    "skillsMatch": 0,
    "experienceMatch": 0,
    "salaryFit": 0,
    "locationMatch": 0,
    "noticePeriodFit": 0,
    "skillCoveragePercent": 0,
    "experienceRelevancePercent": 0,
    "weightedScore": 0,
    "riskPenalty": 0,
    "finalAdjustedScore": 0
  },

  "rankingSignals": {
    "mustHaveSkillsMatchedCount": 0,
    "mustHaveSkillsTotal": 0,
    "mustHaveSkillsMatched": [],
    "mustHaveSkillsMissing": [],
    "preferredSkillsMatched": [],
    "relevantExperienceYears": 0,
    "noticePeriodDays": 0,
    "salaryDeltaPercent": 0,
    "salaryWithinBudget": true
  },

  "validation": {
    "experienceDiscrepancy": "MATCH or MINOR_DIFF or MAJOR_DIFF",
    "experienceDiscrepancyDetail": "explanation",
    "locationMatch": "EXACT or NEARBY or DIFFERENT",
    "redFlags": [],
    "inconsistencies": [],
    "dataQuality": "HIGH or MEDIUM or LOW"
  },

  "matchLevel": "STRONG or GOOD or PARTIAL or WEAK",

  "recommendation": {
    "decision": "SHORTLIST or HOLD or REJECT",
    "priorityScore": 0,
    "justification": "clear explanation for admin",
    "suggestedActions": []
  }
}`;
    }

    /**
     * Build Job Description string from Job document
     */
    _buildJobDescriptionString(job) {
        if (!job || typeof job !== 'object') {
            return 'Job description not available';
        }

        const lines = [];

        if (job.title) lines.push(`Title: ${job.title}`);
        if (job.category) lines.push(`Category: ${job.category}`);
        if (job.employmentType) lines.push(`Employment Type: ${job.employmentType}`);
        if (job.experienceLevel) lines.push(`Experience Level: ${job.experienceLevel}`);

        if (job.experienceRange) {
            lines.push(`Experience Required: ${job.experienceRange.min} to ${job.experienceRange.max} years`);
        }

        if (job.salary) {
            const min = job.salary.min ? `₹${job.salary.min.toLocaleString('en-IN')}` : 'Not specified';
            const max = job.salary.max ? `₹${job.salary.max.toLocaleString('en-IN')}` : 'Not specified';
            lines.push(`Salary Budget: ${min} to ${max} per annum`);
        }

        if (job.location) {
            const loc = [];
            if (job.location.city) loc.push(job.location.city);
            if (job.location.state) loc.push(job.location.state);
            if (job.location.isRemote) loc.push('Remote OK');
            if (job.location.isHybrid) loc.push('Hybrid');
            lines.push(`Location: ${loc.join(', ')}`);
        }

        if (job.skills?.required?.length > 0) {
            lines.push(`MUST-HAVE Skills: ${job.skills.required.join(', ')}`);
        }

        if (job.skills?.preferred?.length > 0) {
            lines.push(`PREFERRED Skills: ${job.skills.preferred.join(', ')}`);
        }

        if (job.description) {
            lines.push(`\nJob Description:\n${job.description.substring(0, 1000)}`);
        }

        if (job.requirements?.length > 0) {
            lines.push(`\nRequirements:\n${job.requirements.map(r => `- ${r}`).join('\n')}`);
        }

        if (job.responsibilities?.length > 0) {
            lines.push(`\nResponsibilities:\n${job.responsibilities.map(r => `- ${r}`).join('\n')}`);
        }

        return lines.join('\n');
    }

    /**
     * Structure AI result into our Candidate model format
     */
    _structureAIResult(aiResult, formData) {
        const profile = aiResult.candidateProfile || {};
        const scoring = aiResult.scoring || {};

        return {
            // Personal info — prefer form data, fallback to AI extracted
            firstName: formData.firstName || this._cleanString(profile.extractedName?.split(' ')[0]),
            lastName: formData.lastName || this._cleanString(profile.extractedName?.split(' ').slice(1).join(' ')),
            email: formData.email || this._cleanEmail(profile.extractedEmail),
            mobile: formData.mobile || this._cleanMobile(profile.extractedMobile),

            // Profile from AI
            profile: {
                currentCompany: this._cleanString(profile.currentCompany),
                currentDesignation: this._cleanString(profile.currentDesignation),
                totalExperience: formData.totalExperience || null,
                relevantExperience: formData.relevantExperience || null,
                currentLocation: this._cleanString(profile.standardizedLocation) || formData.location,
                skills: Array.isArray(profile.skills) ? profile.skills.filter(Boolean) : [],
                education: Array.isArray(profile.education) ? profile.education : [],
                noticePeriod: formData.noticePeriod || null,
                currentSalary: formData.currentSalary || null,
                expectedSalary: formData.expectedSalary || null,
                languages: Array.isArray(profile.languages) ? profile.languages : [],
                certifications: Array.isArray(profile.certifications) ? profile.certifications : []
            },

            // Summary from recommendation
            summary: aiResult.recommendation?.justification || null
        };
    }

    /**
     * Build confidence object from AI scoring
     */
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

    /**
     * Extract text from resume URL
     */
    async _extractTextFromUrl(url) {
        try {
            const isPdf =
                url.toLowerCase().includes('.pdf') ||
                url.includes('/raw/');

            if (isPdf) {
                return await this._extractFromPdf(url);
            }

            const response = await axios.get(url, {
                responseType: 'text',
                timeout: 30000
            });

            return response.data;

        } catch (error) {
            console.error(`[AI] URL extraction error: ${error.message}`);
            throw new Error(`Could not download resume: ${error.message}`);
        }
    }

    /**
     * Extract text from PDF
     */
    async _extractFromPdf(url) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 10 * 1024 * 1024
            });

            const buffer = Buffer.from(response.data);

            // ✅ Fixed pdf-parse call
            try {
                const pdfParse = require('pdf-parse');
                const data = await pdfParse(buffer);

                if (data.text && data.text.trim().length > 50) {
                    console.log(`[AI] ✅ PDF parsed properly: ${data.text.length} chars, ${data.numpages} pages`);
                    return data.text;
                }
            } catch (pdfError) {
                console.log('[AI] pdf-parse error:', pdfError.message);
            }

            // ✅ Fallback — still works, just less clean
            const text = buffer
                .toString('utf-8')
                .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (text.length > 100) {
                console.log(`[AI] Fallback text extraction: ${text.length} chars`);
                return text;
            }

            return `Resume file: ${url}`;

        } catch (error) {
            throw new Error(`PDF extraction failed: ${error.message}`);
        }
    }

    /**
     * Empty data when AI disabled or fails
     */
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

    // ==================== HELPERS ====================

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