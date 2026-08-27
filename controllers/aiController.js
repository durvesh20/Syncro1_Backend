// backend/controllers/aiController.js
const aiService = require('../services/aiService');

// @desc    Parse resume using AI (OpenAI)
// @route   POST /api/ai/parse-resume
// @access  Staffing Partner
exports.parseResume = async (req, res) => {
    try {
        const { resumeUrl, fileName,candidateFormData, jobDescription } = req.body;

        if (!resumeUrl) {
            return res.status(400).json({
                success: false,
                message: 'Resume URL is required'
            });
        }

        const { validateResumeUrl } = require('../utils/validators');
        const urlCheck = validateResumeUrl(resumeUrl);
        if (!urlCheck.valid) {
            return res.status(400).json({
                success: false,
                message: `Invalid resume URL: ${urlCheck.reason}`
            });
        }

        const result = await aiService.parseResume(resumeUrl, fileName, candidateFormData || {}, jobDescription || {} );

        res.json({
            success: true,
            message: result.success
                ? 'Resume parsed successfully'
                : 'AI parsing skipped — manual data available',
            data: result
        });

    } catch (error) {
        console.error('[AI Controller] Parse resume error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to parse resume',
            error: error.message
        });
    }
};

// @desc    Parse resume from file upload
// @route   POST /api/ai/parse-resume/upload
// @access  Staffing Partner
exports.parseResumeFromUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please upload a resume file'
            });
        }

        const resumeUrl = req.file.path;
        const fileName = req.file.originalname;

        const result = await aiService.parseResume(resumeUrl, fileName);

        res.json({
            success: true,
            message: result.success
                ? 'Resume uploaded and parsed successfully'
                : 'Resume uploaded — AI parsing skipped',
            data: {
                ...result,
                resume: {
                    url: resumeUrl,
                    fileName: fileName,
                    uploadedAt: new Date()
                }
            }
        });

    } catch (error) {
        console.error('[AI Controller] Parse resume upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to parse resume',
            error: error.message
        });
    }
};

// @desc    Batch parse up to 5 resumes against JD
// @route   POST /api/ai/parse-multiple-resumes
// @access  Staffing Partner, Admin, Sub-Admin
exports.parseMultipleResumes = async (req, res) => {
    try {
        const { candidates, jobDescription } = req.body;

        if (!Array.isArray(candidates) || candidates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Candidates array (1 to 5 candidates) is required'
            });
        }

        if (candidates.length > 5) {
            console.warn(`[AI Controller] Trimming candidates list from ${candidates.length} to 5`);
        }

        const result = await aiService.parseMultipleResumes(candidates.slice(0, 5), jobDescription || {});

        res.json({
            success: true,
            message: 'Batch resume scan complete',
            data: result
        });

    } catch (error) {
        console.error('[AI Controller] Batch parse resumes error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to batch parse resumes',
            error: error.message
        });
    }
};