// backend/controllers/aiController.js
const aiService = require('../services/aiService');

// @desc    Parse resume using AI
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

        // Validate URL is a Cloudinary URL or valid URL
        if (!resumeUrl.startsWith('http')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid resume URL'
            });
        }

        const result = await aiService.parseResume(resumeUrl, fileName);

        res.json({
            success: true,
            message: 'Resume parsed successfully',
            data: result
        });
    } catch (error) {
        console.error('[AI] Parse resume error:', error);
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

        // File is already uploaded to Cloudinary by middleware
        const resumeUrl = req.file.path;
        const fileName = req.file.originalname;

        const result = await aiService.parseResume(resumeUrl, fileName);

        res.json({
            success: true,
            message: 'Resume uploaded and parsed successfully',
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
        console.error('[AI] Parse resume upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to parse resume',
            error: error.message
        });
    }
};