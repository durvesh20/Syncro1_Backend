// backend/services/aiService.js
const { getOpenAI, getModel } = require('../config/ai');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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
            let resumeText = await this._extractTextFromUrl(resumeUrl);

            if (!resumeText || resumeText.trim().length < 30) {
                console.warn('[AI] Could not extract enough text from resume');
                return this._getEmptyResumeData();
            }

            console.log(`[AI] Extracted ${resumeText.length} characters from resume`);

            // Compress resume if it exceeds the maximum character threshold (14,000 characters)
            const MAX_CHARS = 14000;
            if (resumeText.length > MAX_CHARS) {
                const { compressResumeText } = require('./resumeCompressor');
                resumeText = await compressResumeText(resumeText);
            }

            // Step 2: Build the advanced prompt using JobPosition's parsedRequirements JSON
            const { getOrParseJobPosition } = require('./jobPositionParser');
            let jobDescriptionText = '';
            try {
                const jobPosition = await getOrParseJobPosition(jobDescription);
                if (jobPosition && jobPosition.parsedRequirements) {
                    console.log(`[AI] Consuming structured JobPosition requirements for job ${jobDescription?._id || jobDescription}`);
                    jobDescriptionText = JSON.stringify(jobPosition.parsedRequirements, null, 2);
                } else {
                    console.warn(`[AI] JobPosition not found or has no parsedRequirements, falling back to raw JD text`);
                    jobDescriptionText = this._buildJobDescriptionString(jobDescription);
                }
            } catch (err) {
                console.error(`[AI] Failed to fetch/parse JobPosition: ${err.message}. Falling back to raw JD text.`);
                jobDescriptionText = this._buildJobDescriptionString(jobDescription);
            }

            const prompt = this._buildAdvancedPrompt(
                candidateFormData,
                resumeText,
                jobDescriptionText
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

            // Log successful scoring run (TASK-011)
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

            // Log failed scoring run (TASK-011)
            const ScoringLog = require('../models/ScoringLog');
            await ScoringLog.create({
              logType: 'SCORING',
              applicationId: candidateFormData.candidateId || null,
              promptSent: typeof prompt !== 'undefined' ? prompt : 'Prompt building failed',
              rawResponse: typeof responseText !== 'undefined' ? responseText : null,
              success: false,
              error: error.message
            }).catch(err => console.error('[AI] Failed to write error scoring log:', err.message));

            return this._getEmptyResumeData();
        }
    }

    /**
     * Build the advanced Syncro1 AI prompt — TASK-004
     * Loads from prompts/scoring-prompt.txt (all 7 fixes applied)
     */
    _buildAdvancedPrompt(formData, resumeText, jobDescriptionText) {
        const jobDescription = jobDescriptionText;

        // Load upgraded prompt template from file
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
        const writeupString = formData.writeup || 'Not provided';

        // Fill in template variables
        return template
            .replace('{{firstName}}',         formData.firstName || 'Not provided')
            .replace('{{lastName}}',          formData.lastName || 'Not provided')
            .replace('{{email}}',             formData.email || 'Not provided')
            .replace('{{mobile}}',            formData.mobile || 'Not provided')
            .replace('{{location}}',          formData.location || 'Not provided')
            .replace('{{totalExperience}}',   formData.totalExperience || 'Not provided')
            .replace('{{relevantExperience}}',formData.relevantExperience || 'Not provided')
            .replace('{{noticePeriod}}',      formData.noticePeriod || 'Not provided')
            .replace('{{currentSalary}}',     formData.currentSalary ? '₹' + Number(formData.currentSalary).toLocaleString('en-IN') : 'Not provided')
            .replace('{{expectedSalary}}',    formData.expectedSalary ? '₹' + Number(formData.expectedSalary).toLocaleString('en-IN') : 'Not provided')
            .replace('{{partnerReportedSkills}}',        skillsString)
            .replace('{{partnerReportedEducation}}',     educationString)
            .replace('{{partnerReportedCertifications}}',  certificationsString)
            .replace('{{partnerReportedLanguages}}',     languagesString)
            .replace('{{candidateWriteup}}',             writeupString)
            .replace('{{resumeText}}',        resumeText.substring(0, 14000))
            .replace('{{jobDescription}}',    jobDescription);
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