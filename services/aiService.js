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
        // ✅ ADD THIS AT THE VERY START
        console.log('\n========================================');
        console.log('[AI] parseResume called with:');
        console.log('  - resumeUrl:', resumeUrl);
        console.log('  - fileName:', fileName);
        console.log('  - candidateFormData keys:', Object.keys(candidateFormData));
        console.log('  - jobDescription exists:', !!jobDescription);
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
1. Extract resume data
2. Score each component (0-100)
3. Calculate final weighted score
4. Apply risk penalties
5. Output JSON only

---

STRICT RULES:
- Output ONLY valid JSON - no text outside
- All scores are integers 0-100
- All calculations must be shown in output
- Round all decimals to nearest integer
- CRITICAL: Do NOT auto-zero, override, or force the weightedScore or finalAdjustedScore to 0 just because skillsMatch or experienceMatch is 0. You must calculate the weightedScore strictly using the mathematical formula: (skillsMatch * 0.30) + (experienceMatch * 0.20) + (domainMatch * 0.15) + (educationMatch * 0.10) + (salaryFit * 0.10) + (locationMatch * 0.05) + (noticePeriodFit * 0.05) + (stabilityScore * 0.05). If other components have positive scores, they MUST be counted in the final sum.

---

## COMPONENT SCORING (Each 0-100):

### 1. SKILLS MATCH (0-100):
- Count JD required skills matched in resume
- Matched / Total Required = Match%
- Match% × 100 = Score (max 100)
- If Match% < 70%: Cap at 50

Example:
JD requires: React, Node.js, MongoDB, Express (4 skills)
Resume has: React, Node.js, Express (3 skills)
Match: 3/4 = 75% → Score = 75

### 2. EXPERIENCE MATCH (0-100):
- Compare: Candidate Years vs JD Required Years
- If candidate >= required: Score = 100
- If candidate = required - 1-2: Score = 70
- If candidate = required - 2-3: Score = 40
- If candidate < required - 3: Score = 20

Example:
JD requires: 3-5 years
Candidate has: 5 years
5 >= 3 → Score = 100

### 3. DOMAIN MATCH (0-100):
- Is candidate domain same as JD domain?
- EXACT match: 100
- RELATED (similar field): 70
- UNRELATED (different): 20

Example:
JD: Software Engineering
Candidate: MERN Development
Related → Score = 70

### 4. EDUCATION MATCH (0-100):
- Does candidate meet minimum education?
- Exceeds requirement: 100
- Exact match: 90
- One level below: 70
- Two levels below: 30
- Below minimum: 0

Example:
JD requires: Bachelor's
Candidate has: Master's
Exceeds → Score = 100

### 5. SALARY FIT (0-100):
- Compare expected CTC vs job budget max
- If expected <= budget_max: Score = 100
- If expected = budget_max + 1-10%: Score = 80
- If expected = budget_max + 11-20%: Score = 60
- If expected = budget_max + 21-30%: Score = 40
- If expected > budget_max + 30%: Score = 0

Example:
Budget: ₹40L
Expected: ₹36L
36 < 40 → Score = 100

### 6. LOCATION MATCH (0-100):
- Same city OR Remote job: 100
- Same state/nearby: 80
- Different region but willing: 60
- Different region, unwilling: 20

Example:
Job: Bangalore (Remote OK)
Candidate: Mumbai
Remote job → Score = 100

### 7. NOTICE PERIOD FIT (0-100):
- Convert to days (Immediate=0, 15days=15, 1month=30, etc)
- If ≤ 15 days: 100
- If 16-30 days: 90
- If 31-45 days: 80
- If 46-60 days: 70
- If 61-90 days: 50
- If > 90 days: 30

Example:
Notice: 30 days
30 days → Score = 90

### 8. STABILITY SCORE (0-100):
- Calculate: Total months in all jobs / Number of jobs
- If >= 36 months per job: 100
- If 24-35 months per job: 80
- If 18-23 months per job: 60
- If 12-17 months per job: 40
- If 6-11 months per job: 20
- If < 6 months per job: 0

Example:
Job 1: 24 months
Job 2: 24 months
Average = 48/2 = 24 months per job → Score = 80

---

## SCORING WEIGHTS (8 COMPONENTS):

skillsMatch          = 30%
experienceMatch      = 20%
domainMatch          = 15%
educationMatch       = 10%
salaryFit            = 10%
locationMatch        = 5%
noticePeriodFit      = 5%
stabilityScore       = 5%
────────────────────────────
TOTAL               = 100%

---

## SCORE EACH COMPONENT (0-100):

### 1. SKILLS MATCH (Weight: 30%)
JD required skills: Count them
Resume has: Count matches
Score = (Matched / Total) × 100
If score < 70: Cap at 50

Example:
JD: React, Node, MongoDB, Express (4)
Resume: React, Node, Express (3)
Score = (3/4) × 100 = 75

### 2. EXPERIENCE MATCH (Weight: 20%)
JD requires: X-Y years
Candidate has: Z years

If Z >= Y: Score = 100
If Z = Y-1 to Y-2: Score = 70
If Z = Y-3: Score = 40
If Z < Y-3: Score = 20

Example:
JD: 1-2 years
Candidate: 1.5 years
1.5 is in range → Score = 100

### 3. DOMAIN MATCH (Weight: 15%)
JD domain: Software/Frontend/Backend/etc
Candidate domain: From resume

EXACT match: 100
RELATED (similar field): 70
UNRELATED (different): 20

Example:
JD: Frontend Development
Candidate: MERN Stack
Related → Score = 70

### 4. EDUCATION MATCH (Weight: 10%)
JD requires: Minimum degree
Candidate has: Actual degree

Exceeds requirement: 100
Exact match: 90
One level below: 70
Two levels below: 30
Below minimum: 0

Example:
JD: Bachelor's
Candidate: Master's
Exceeds → Score = 100

### 5. SALARY FIT (Weight: 10%)
JD budget max: ₹XXL
Candidate expected: ₹ZZL

If expected <= budget_max: 100
If expected 1-10% over: 80
If expected 11-20% over: 60
If expected 21-30% over: 40
If expected > 30% over: 0

Example:
Budget: ₹40L max
Expected: ₹36L
36 < 40 → Score = 100

### 6. LOCATION MATCH (Weight: 5%)
JD location: City
Candidate location: City

EXACT OR REMOTE: 100
NEARBY (<100km): 80
SAME STATE: 60
DIFFERENT REGION: 20

Example:
Job: Bangalore (Remote OK)
Candidate: Pune
Remote → Score = 100

### 7. NOTICE PERIOD FIT (Weight: 5%)
Convert to days: 15 days = 15, 1 month = 30

0-15 days: 100
16-30 days: 90
31-45 days: 80
46-60 days: 70
61-90 days: 50
90+ days: 30

Example:
Notice: 15 days
→ Score = 100

### 8. STABILITY SCORE (Weight: 5%)
Calculate average: Total months in all jobs / Number of jobs

36+ months per job: 100
24-35 months per job: 80
18-23 months per job: 60
12-17 months per job: 40
6-11 months per job: 20
<6 months per job: 0

Example:
Job 1: 12 months
Job 2: 12 months
Average = 24/2 = 12 months
→ Score = 40

---

## WEIGHTED SCORE CALCULATION:

weightedScore = 
  (skillsMatch × 0.30) +
  (experienceMatch × 0.20) +
  (domainMatch × 0.15) +
  (educationMatch × 0.10) +
  (salaryFit × 0.10) +
  (locationMatch × 0.05) +
  (noticePeriodFit × 0.05) +
  (stabilityScore × 0.05)

Round to nearest integer

Example:
= (75 × 0.30) + (100 × 0.20) + (70 × 0.15) + (100 × 0.10) + (100 × 0.10) + (100 × 0.05) + (100 × 0.05) + (40 × 0.05)
= 22.5 + 20 + 10.5 + 10 + 10 + 5 + 5 + 2
= 85

---

## RISK PENALTY (0-25):

Deduct for:
- Career gap > 6mo: -5
- Job hopper (avg < 1yr): -8
- Domain mismatch: -10
- Experience gap > 3yrs: -7
- Salary > 30% over: -5

Sum penalties (max -25)
riskPenalty = total

Example: -10

---

## FINAL SCORE:

finalAdjustedScore = weightedScore - riskPenalty
Minimum: 0
Maximum: 100

Example: 85 - 10 = 75

---

## MATCH LEVEL:

80-100: STRONG
65-79: GOOD
50-64: PARTIAL
0-49: WEAK

Example: 75 → GOOD

---

## DECISION:

>= 70: SHORTLIST
50-69: HOLD
< 50: REJECT

Example: 75 → SHORTLIST

---

### Candidate Form Data:
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

### Resume Text:
${resumeText.substring(0, 8000)}

### Job Description:
${jobDescription}

---

### REQUIRED OUTPUT (JSON ONLY - NO OTHER TEXT):

{
  "candidateProfile": {
    "extractedName": "name or Not Found",
    "extractedEmail": "email or Not Found",
    "extractedMobile": "mobile or Not Found",
    "currentCompany": "company or Not Found",
    "currentDesignation": "title or Not Found",
    "skills": ["skill1", "skill2"],
    "domain": "primary domain",
    "actualTotalExperience": "X years",
    "averageJobTenureYears": 0.0,
    "standardizedLocation": "City, State",
    "education": [
      {
        "degree": "degree",
        "institution": "college",
        "year": 2020,
        "isMinimumMet": true
      }
    ],
    "languages": [],
    "certifications": [],
    "careerGaps": [],
    "jobHistory": [
      {
        "company": "company",
        "designation": "title",
        "fromYear": 2023,
        "toYear": 2024,
        "durationMonths": 12,
        "domain": "domain"
      }
    ]
  },

  "screening": {
    "experienceRange": {
      "required": "X-Y years",
      "actual": "X years",
      "status": "MEETS / BELOW / EXCEEDS"
    },
    "salaryFit": {
      "budget": "₹XXL-₹YYL",
      "expected": "₹ZZL",
      "deltaPercent": 0,
      "status": "WITHIN / SLIGHTLY_OVER / OVER"
    },
    "locationFit": {
      "jobLocation": "city",
      "candidateLocation": "city",
      "status": "EXACT / NEARBY / DIFFERENT",
      "relocationWilling": false
    },
    "noticePeriod": {
      "required": "days",
      "actual": "days",
      "status": "IMMEDIATE / ACCEPTABLE / LONG"
    },
    "keywordsFound": [],
    "keywordsMissing": [],
    "careerGapAnalysis": {
      "hasGaps": false,
      "totalGapMonths": 0,
      "longestGapMonths": 0,
      "gapRisk": "LOW / MEDIUM / HIGH"
    },
    "stabilityAnalysis": {
      "averageTenureYears": 0.0,
      "isJobHopper": false,
      "stabilityRisk": "LOW / MEDIUM / HIGH",
      "detail": "explanation"
    },
    "domainMatch": {
      "jobDomain": "domain",
      "candidateDomain": "domain",
      "status": "EXACT / RELATED / UNRELATED"
    },
    "educationMatch": {
      "minimumRequired": "degree",
      "candidateEducation": "degree",
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
    "greenFlags": [],
    "inconsistencies": [],
    "dataQuality": "HIGH / MEDIUM / LOW"
  },

  "matchLevel": "STRONG / GOOD / PARTIAL / WEAK",

  "recommendation": {
    "decision": "SHORTLIST / HOLD / REJECT",
    "priorityScore": 0,
    "justification": "explanation",
    "suggestedActions": [],
    "interviewFocusAreas": []
  }
}`;
    }
    /**
     * Build Job Description string from Job document
     */
    _buildJobDescriptionString(job) {
        // ✅ Convert Mongoose document to plain object
        const jobObj = job?.toObject ? job.toObject() : job;

        console.log('\n[AI] Building Job Description String:');
        console.log('  - Job exists:', !!jobObj);
        console.log('  - Job ID:', jobObj?._id);
        console.log('  - Job title:', jobObj?.title);
        console.log('  - Has required skills:', jobObj?.skills?.required?.length || 0);
        console.log('  - Required skills:', jobObj?.skills?.required);

        if (!jobObj || typeof jobObj !== 'object') {
            console.warn('[AI] Job description not available or invalid');
            return 'Job description not available';
        }

        const lines = [];

        if (jobObj.title) lines.push(`Title: ${jobObj.title}`);
        if (jobObj.category) lines.push(`Category: ${jobObj.category}`);
        if (jobObj.employmentType) lines.push(`Employment Type: ${jobObj.employmentType}`);
        if (jobObj.experienceLevel) lines.push(`Experience Level: ${jobObj.experienceLevel}`);

        if (jobObj.experienceRange) {
            lines.push(`Experience Required: ${jobObj.experienceRange.min} to ${jobObj.experienceRange.max} years`);
        }

        if (jobObj.salary) {
            const min = jobObj.salary.min ? `₹${jobObj.salary.min.toLocaleString('en-IN')}` : 'Not specified';
            const max = jobObj.salary.max ? `₹${jobObj.salary.max.toLocaleString('en-IN')}` : 'Not specified';
            lines.push(`Salary Budget: ${min} to ${max} per annum`);
        }

        if (jobObj.location) {
            const loc = [];
            if (jobObj.location.city) loc.push(jobObj.location.city);
            if (jobObj.location.state) loc.push(jobObj.location.state);
            if (jobObj.location.isRemote) loc.push('Remote OK');
            if (jobObj.location.isHybrid) loc.push('Hybrid');
            lines.push(`Location: ${loc.join(', ')}`);
        }

        if (jobObj.skills?.required?.length > 0) {
            lines.push(`MUST-HAVE Skills: ${jobObj.skills.required.join(', ')}`);
        }

        if (jobObj.skills?.preferred?.length > 0) {
            lines.push(`PREFERRED Skills: ${jobObj.skills.preferred.join(', ')}`);
        }

        if (jobObj.description) {
            lines.push(`\nJob Description:\n${jobObj.description.substring(0, 1000)}`);
        }

        if (jobObj.requirements?.length > 0) {
            lines.push(`\nRequirements:\n${jobObj.requirements.map(r => `- ${r}`).join('\n')}`);
        }

        if (jobObj.responsibilities?.length > 0) {
            lines.push(`\nResponsibilities:\n${jobObj.responsibilities.map(r => `- ${r}`).join('\n')}`);
        }

        const finalString = lines.join('\n');
        console.log('[AI] Job Description String Length:', finalString.length);

        return finalString;
    }

    /**
     * Structure AI result into our Candidate model format
     */
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
                languages: Array.isArray(profile.languages) ? profile.languages : [],
                certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
                noticePeriod: formData.noticePeriod || null,
                currentSalary: formData.currentSalary || null,
                expectedSalary: formData.expectedSalary || null
            },

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
            const fileName = url.toLowerCase();

            // Check file type
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
     * Extract text from PDF
     */
    async _extractFromPdf(url) {
        try {
            console.log('[AI] Extracting text from PDF...');

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 10 * 1024 * 1024
            });

            const buffer = Buffer.from(response.data);

            // Try pdf-parse first
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

            // Fallback to buffer extraction
            const text = buffer
                .toString('utf-8')
                .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (text.length > 100) {
                console.log(`[AI] PDF fallback extraction: ${text.length} chars`);
                return text;
            }

            return `Resume file: ${url}`;

        } catch (error) {
            throw new Error(`PDF extraction failed: ${error.message}`);
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