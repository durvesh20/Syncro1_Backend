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
        const jobDescription = this._buildJobDescriptionString(job);

        return `You are Syncro1's advanced talent intelligence engine.

Your responsibilities:
1. Extract and normalize resume data
2. Validate candidate inputs vs resume
3. Evaluate against JD using deterministic scoring
4. Detect career gaps, job-hopping, domain mismatch
5. Generate structured outputs for ranking and filtering

---

STRICT RULES:
- Output ONLY valid JSON
- No explanations outside JSON
- No hallucination — missing data = "Not Found"
- Scores must be consistent, reproducible, evidence-based
- All scores: integers 0-100 only

---

SCORING WEIGHTS:
skillsMatch          = 30%
experienceMatch      = 20%
domainMatch          = 15%
educationMatch       = 10%
salaryFit            = 10%
locationMatch        = 5%
noticePeriodFit      = 5%
stabilityScore       = 5%  (penalize frequent job changes)

---

CALCULATION:
weightedScore =
(skillsMatch * 0.30) +
(experienceMatch * 0.20) +
(domainMatch * 0.15) +
(educationMatch * 0.10) +
(salaryFit * 0.10) +
(locationMatch * 0.05) +
(noticePeriodFit * 0.05) +
(stabilityScore * 0.05)

Round to nearest integer.

---

NORMALIZATION RULES:
- Cap total score at 45 if critical must-have skills missing
- Penalize heavily for career gaps > 6 months
- Penalize for average job tenure < 1 year (job hopper)
- Penalize for domain completely unrelated to JD

---

MATCH LEVELS:
STRONG  → 80-100
GOOD    → 65-79
PARTIAL → 50-64
WEAK    → below 50

---

RISK PENALTY (0-25 deduction):
- Career gap > 6 months: -5
- Career gap > 12 months: -10
- Average job tenure < 1 year: -8
- Domain completely unrelated: -10
- Major experience discrepancy: -7
- Salary expectation > 30% over budget: -5

FinalAdjustedScore = weightedScore - totalRiskPenalty (min 0)

---

DECISION THRESHOLDS:
SHORTLIST → FinalAdjustedScore >= 70
HOLD      → FinalAdjustedScore >= 50
REJECT    → FinalAdjustedScore < 50

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
currentSalary: ${formData.currentSalary ? '₹' + Number(formData.currentSalary).toLocaleString('en-IN') : 'Not provided'} per annum
expectedSalary: ${formData.expectedSalary ? '₹' + Number(formData.expectedSalary).toLocaleString('en-IN') : 'Not provided'} per annum
writeup: ${formData.writeup || 'Not provided'}

### Resume Text (extracted from PDF/DOC):
${resumeText.substring(0, 6000)}

### Job Description:
${jobDescription}

---

### REQUIRED OUTPUT (STRICT JSON — no other text):

{
  "candidateProfile": {
    "extractedName": "full name from resume or Not Found",
    "extractedEmail": "email from resume or Not Found",
    "extractedMobile": "10-digit mobile or Not Found",
    "currentCompany": "current employer or Not Found",
    "currentDesignation": "current title or Not Found",
    "skills": ["skill1", "skill2"],
    "domain": "primary domain e.g. Software Engineering, Civil Engineering, Finance",
    "actualTotalExperience": "X years from resume",
    "averageJobTenureYears": 0.0,
    "standardizedLocation": "City, State",
    "education": [
      {
        "degree": "degree name",
        "institution": "college name",
        "year": 2020,
        "isMinimumMet": true
      }
    ],
    "languages": ["English", "Hindi"],
    "certifications": ["cert1"],
    "careerGaps": [
      {
        "fromYear": 2022,
        "toYear": 2023,
        "durationMonths": 6,
        "reason": "if mentioned or Unknown"
      }
    ],
    "jobHistory": [
      {
        "company": "company name",
        "designation": "title",
        "fromYear": 2020,
        "toYear": 2022,
        "durationMonths": 24,
        "domain": "domain of work"
      }
    ]
  },

  "screening": {
    "experienceRange": {
      "required": "5-10 years",
      "actual": "6 years",
      "status": "MEETS / BELOW / EXCEEDS"
    },
    "salaryFit": {
      "budget": "₹20L-₹40L",
      "expected": "₹20L",
      "deltaPercent": 0,
      "status": "WITHIN / SLIGHTLY_OVER / OVER"
    },
    "locationFit": {
      "jobLocation": "Bangalore",
      "candidateLocation": "Mumbai",
      "status": "EXACT / NEARBY / DIFFERENT",
      "relocationWilling": false
    },
    "noticePeriod": {
      "required": "0-30 days",
      "actual": "30 days",
      "status": "IMMEDIATE / ACCEPTABLE / LONG"
    },
    "keywordsFound": ["React.js", "Node.js"],
    "keywordsMissing": ["MongoDB", "JavaScript"],
    "careerGapAnalysis": {
      "hasGaps": false,
      "totalGapMonths": 0,
      "longestGapMonths": 0,
      "gapRisk": "LOW / MEDIUM / HIGH"
    },
    "stabilityAnalysis": {
      "averageTenureYears": 0,
      "isJobHopper": false,
      "stabilityRisk": "LOW / MEDIUM / HIGH",
      "detail": "explanation"
    },
    "domainMatch": {
      "jobDomain": "Software Engineering",
      "candidateDomain": "Software Engineering",
      "status": "EXACT / RELATED / UNRELATED"
    },
    "educationMatch": {
      "minimumRequired": "B.Tech/B.E.",
      "candidateEducation": "B.Tech in Computer Science",
      "status": "MEETS / BELOW / EXCEEDS"
    }
  },

  "scoring": {
    "skillsMatch": 0,
    "experienceMatch": 0,
    "domainMatch": 0,
    "educationMatch": 0,
    "salaryFit": 0,
    "locationMatch": 0,
    "noticePeriodFit": 0,
    "stabilityScore": 0,
    "skillCoveragePercent": 0,
    "weightedScore": 0,
    "riskPenalty": 0,
    "riskBreakdown": {
      "careerGapPenalty": 0,
      "jobHopperPenalty": 0,
      "domainMismatchPenalty": 0,
      "experienceDiscrepancyPenalty": 0,
      "salaryOverBudgetPenalty": 0
    },
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
    "salaryWithinBudget": true,
    "priorityRank": 0
  },

  "validation": {
    "experienceDiscrepancy": "MATCH / MINOR_DIFF / MAJOR_DIFF",
    "experienceDiscrepancyDetail": "explanation",
    "locationMatch": "EXACT / NEARBY / DIFFERENT",
    "redFlags": [],
    "inconsistencies": [],
    "dataQuality": "HIGH / MEDIUM / LOW"
  },

  "matchLevel": "STRONG / GOOD / PARTIAL / WEAK",

  "recommendation": {
    "decision": "SHORTLIST / HOLD / REJECT",
    "priorityScore": 0,
    "justification": "clear 2-3 line explanation for admin",
    "suggestedActions": [
      "Action 1 for admin or interviewer",
      "Action 2"
    ],
    "interviewFocusAreas": [
      "Area to probe in interview"
    ]
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
    async _extractTextFromUrl(url) {
        try {
            const fileName = url.toLowerCase();

            // ✅ Check file type
            if (fileName.includes('.docx') || fileName.includes('.doc')) {
                return await this._extractFromDoc(url);
            }

            // PDF or raw Cloudinary upload
            if (fileName.includes('.pdf') || url.includes('/raw/')) {
                return await this._extractFromPdf(url);
            }

            // Default: try as text
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
     * Extract text from DOC/DOCX file
     */
    async _extractFromDoc(url) {
        try {
            console.log('[AI] Extracting text from DOC/DOCX...');

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 10 * 1024 * 1024
            });

            const buffer = Buffer.from(response.data);

            // Try mammoth for DOCX
            try {
                const mammoth = require('mammoth');
                const result = await mammoth.extractRawText({ buffer });
                if (result.value && result.value.trim().length > 50) {
                    console.log(`[AI] ✅ DOCX extracted: ${result.value.length} chars`);
                    return result.value;
                }
            } catch (mammothError) {
                console.log('[AI] mammoth not available:', mammothError.message);
            }

            // Fallback to raw text
            const text = buffer
                .toString('utf-8')
                .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (text.length > 100) {
                console.log(`[AI] DOC fallback text: ${text.length} chars`);
                return text;
            }

            return `Resume file: ${url}`;

        } catch (error) {
            throw new Error(`DOC extraction failed: ${error.message}`);
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