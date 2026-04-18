// backend/services/aiService.js
const { getGemini, getModel } = require('../config/ai');
const axios = require('axios');

class AIService {
    constructor() {
        this.enabled = process.env.AI_ENABLED === 'true';
    }

    /**
     * Parse resume from Cloudinary URL using Google Gemini (Free)
     */
    async parseResume(resumeUrl, fileName = '') {
        if (!this.enabled) {
            console.log('[AI] Resume parsing disabled — returning empty data');
            return this._getEmptyResumeData();
        }

        const gemini = getGemini();
        if (!gemini) {
            throw new Error(
                'AI not configured. Add GEMINI_API_KEY to .env and set AI_ENABLED=true'
            );
        }

        try {
            console.log(`[AI] Parsing resume: ${fileName || resumeUrl}`);

            // Step 1: Extract text from resume
            const resumeText = await this._extractTextFromUrl(resumeUrl);

            if (!resumeText || resumeText.trim().length < 30) {
                throw new Error(
                    'Could not extract text from resume. File may be scanned/image-based.'
                );
            }

            // Step 2: Send to Gemini for parsing
            const model = gemini.getGenerativeModel({
                model: getModel(),
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 2048,
                    responseMimeType: 'application/json'
                }
            });

            const prompt = this._buildResumeParsingPrompt(resumeText);

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();

            if (!responseText) {
                throw new Error('No response from Gemini AI');
            }

            // Step 3: Parse JSON response
            let parsedData;
            try {
                parsedData = JSON.parse(responseText);
            } catch (parseError) {
                // Try to extract JSON from response if it has extra text
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsedData = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('AI returned invalid JSON response');
                }
            }

            // Step 4: Clean and validate
            const cleanedData = this._cleanResumeData(parsedData);
            const confidence = this._calculateConfidence(cleanedData);

            console.log(
                `[AI] ✅ Resume parsed: ${cleanedData.firstName || 'Unknown'} ${cleanedData.lastName || ''} — Confidence: ${confidence.level} (${confidence.score}%)`
            );

            return {
                success: true,
                data: cleanedData,
                confidence,
                provider: 'gemini',
                model: getModel()
            };
        } catch (error) {
            console.error(`[AI] ❌ Resume parsing failed: ${error.message}`);
            throw error;
        }
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

            // For doc/docx — download as text
            const response = await axios.get(url, {
                responseType: 'text',
                timeout: 30000
            });

            return response.data;
        } catch (error) {
            console.error(`[AI] Text extraction error: ${error.message}`);
            throw new Error(
                `Could not download resume from URL: ${error.message}`
            );
        }
    }

    /**
     * Extract text from PDF
     */
    async _extractFromPdf(url) {
        try {
            // Download PDF buffer
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 10 * 1024 * 1024
            });

            // Try pdf-parse first
            try {
                const pdfParse = require('pdf-parse');
                const data = await pdfParse(response.data);
                if (data.text && data.text.length > 50) {
                    console.log(
                        `[AI] PDF text extracted: ${data.text.length} characters`
                    );
                    return data.text;
                }
            } catch (pdfError) {
                console.log('[AI] pdf-parse not available, using fallback');
            }

            // Fallback: basic buffer to text
            const text = Buffer.from(response.data)
                .toString('utf-8')
                .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            return text;
        } catch (error) {
            throw new Error(`PDF extraction failed: ${error.message}`);
        }
    }

    /**
     * Build resume parsing prompt for Gemini
     */
    _buildResumeParsingPrompt(resumeText) {
        return `
You are an expert resume parser for an Indian recruitment platform.

Parse the resume text below and return ONLY a valid JSON object.

Required JSON structure:
{
  "firstName": "string or null",
  "lastName": "string or null",
  "email": "string or null",
  "mobile": "10-digit mobile number string or null",
  "currentCompany": "string or null",
  "currentDesignation": "string or null",
  "totalExperience": "number in years or null",
  "relevantExperience": "number in years or null",
  "currentLocation": "city name string or null",
  "preferredLocations": ["array of city strings"],
  "currentSalary": "annual salary in INR as number or null",
  "expectedSalary": "annual salary in INR as number or null",
  "noticePeriod": "one of: Immediate, 15 days, 30 days, 60 days, 90 days or null",
  "canRelocate": "true or false or null",
  "skills": ["array of skill strings"],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "year": "graduation year as number or null"
    }
  ],
  "linkedinProfile": "full URL string or null",
  "portfolioUrl": "full URL string or null",
  "summary": "2-3 line professional summary string",
  "languages": ["array of language strings"],
  "certifications": ["array of certification name strings"]
}

Important rules:
1. Return ONLY the JSON object — no other text
2. If information is not found, use null for strings and numbers, [] for arrays
3. For salary: convert LPA to INR (e.g. 5 LPA = 500000)
4. For mobile: extract 10-digit Indian number only
5. For experience: return as decimal number (e.g. 6.5 for 6 years 6 months)
6. List skills as individual items not combined strings

Resume text to parse:
---
${resumeText.substring(0, 8000)}
---
    `.trim();
    }

    /**
     * Clean and validate parsed resume data
     */
    _cleanResumeData(data) {
        return {
            firstName: this._cleanString(data.firstName),
            lastName: this._cleanString(data.lastName),
            email: this._cleanEmail(data.email),
            mobile: this._cleanMobile(data.mobile),
            profile: {
                currentCompany: this._cleanString(data.currentCompany),
                currentDesignation: this._cleanString(data.currentDesignation),
                totalExperience: this._cleanNumber(data.totalExperience),
                relevantExperience: this._cleanNumber(data.relevantExperience),
                currentLocation: this._cleanString(data.currentLocation),
                preferredLocations: Array.isArray(data.preferredLocations)
                    ? data.preferredLocations.filter(Boolean)
                    : [],
                currentSalary: this._cleanNumber(data.currentSalary),
                expectedSalary: this._cleanNumber(data.expectedSalary),
                noticePeriod: this._cleanString(data.noticePeriod),
                canRelocate:
                    typeof data.canRelocate === 'boolean'
                        ? data.canRelocate
                        : null,
                skills: Array.isArray(data.skills)
                    ? data.skills.filter(Boolean)
                    : [],
                education: Array.isArray(data.education)
                    ? data.education.map(edu => ({
                        degree: this._cleanString(edu.degree),
                        institution: this._cleanString(edu.institution),
                        year: this._cleanNumber(edu.year)
                    }))
                    : [],
                linkedinProfile: this._cleanUrl(data.linkedinProfile),
                portfolioUrl: this._cleanUrl(data.portfolioUrl)
            },
            summary: this._cleanString(data.summary),
            languages: Array.isArray(data.languages) ? data.languages : [],
            certifications: Array.isArray(data.certifications)
                ? data.certifications
                : []
        };
    }

    /**
     * Calculate confidence score
     */
    _calculateConfidence(data) {
        const checks = [
            !!data.firstName,
            !!data.lastName,
            !!data.email,
            !!data.mobile,
            !!data.profile?.currentCompany,
            !!data.profile?.totalExperience,
            !!data.profile?.currentLocation,
            data.profile?.skills?.length > 0,
            data.profile?.education?.length > 0
        ];

        const filled = checks.filter(Boolean).length;
        const score = Math.round((filled / checks.length) * 100);

        return {
            score,
            level: score >= 80 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW',
            fieldsExtracted: filled,
            totalFields: checks.length
        };
    }

    /**
     * Return empty data structure
     */
    _getEmptyResumeData() {
        return {
            success: false,
            data: null,
            confidence: { score: 0, level: 'NONE' },
            mock: true,
            message: 'AI is disabled. Set AI_ENABLED=true and add GEMINI_API_KEY in .env'
        };
    }

    // ==================== HELPERS ====================

    _cleanString(value) {
        if (!value || typeof value !== 'string') return null;
        const cleaned = value.trim();
        return cleaned.length > 0 ? cleaned : null;
    }

    _cleanEmail(value) {
        if (!value) return null;
        const email = String(value).toLowerCase().trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
    }

    _cleanMobile(value) {
        if (!value) return null;
        const cleaned = String(value).replace(/\D/g, '').slice(-10);
        return cleaned.length === 10 ? cleaned : null;
    }

    _cleanNumber(value) {
        if (value === null || value === undefined) return null;
        const num = Number(value);
        return isNaN(num) ? null : num;
    }

    _cleanUrl(value) {
        if (!value || typeof value !== 'string') return null;
        const url = value.trim();
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.includes('linkedin.com') || url.includes('github.com')) {
            return `https://${url}`;
        }
        return null;
    }
}

module.exports = new AIService();