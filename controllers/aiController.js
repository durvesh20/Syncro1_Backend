// backend/controllers/aiController.js
const aiService = require('../services/aiService');

// @desc    Parse resume using AI (OpenAI)
// @route   POST /api/ai/parse-resume
// @access  Staffing Partner
exports.parseResume = async (req, res) => {
    try {
        const { resumeUrl, fileName } = req.body;

        if (!resumeUrl) {
            return res.status(400).json({
                success: false,
                message: 'Resume URL is required'
            });
        }

        if (!resumeUrl.startsWith('http')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid resume URL'
            });
        }

        const result = await aiService.parseResume(resumeUrl, fileName);

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