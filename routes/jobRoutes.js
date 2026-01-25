// backend/routes/jobRoutes.js
const express = require('express');
const router = express.Router();
const Job = require('../models/Job');
const Company = require('../models/Company');

// @desc    Get public job by slug (shareable link)
// @route   GET /api/jobs/:slug
router.get('/:slug', async (req, res) => {
  try {
    const job = await Job.findOne({ 
      slug: req.params.slug, 
      status: 'ACTIVE' 
    }).populate('company', 'companyName kyc.logo kyc.industry kyc.companyType kyc.website kyc.description');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or no longer active'
      });
    }

    // Increment views
    job.metrics.views += 1;
    await job.save();

    // Return job without sensitive info
    const publicJob = {
      _id: job._id,
      title: job.title,
      slug: job.slug,
      description: job.description,
      requirements: job.requirements,
      responsibilities: job.responsibilities,
      category: job.category,
      employmentType: job.employmentType,
      experienceLevel: job.experienceLevel,
      experienceRange: job.experienceRange,
      salary: job.salary.isConfidential ? { isConfidential: true } : job.salary,
      location: job.location,
      skills: job.skills,
      education: job.education,
      vacancies: job.vacancies,
      applicationDeadline: job.applicationDeadline,
      isUrgent: job.isUrgent,
      isFeatured: job.isFeatured,
      company: {
        name: job.company?.companyName,
        logo: job.company?.kyc?.logo,
        industry: job.company?.kyc?.industry,
        type: job.company?.kyc?.companyType,
        website: job.company?.kyc?.website,
        description: job.company?.kyc?.description
      },
      createdAt: job.createdAt
    };

    res.json({
      success: true,
      data: publicJob
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job',
      error: error.message
    });
  }
});

// @desc    Get all public active jobs (for landing page if needed)
// @route   GET /api/jobs
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, location, experienceLevel } = req.query;

    const query = { status: 'ACTIVE' };
    if (category) query.category = category;
    if (location) query['location.city'] = new RegExp(location, 'i');
    if (experienceLevel) query.experienceLevel = experienceLevel;

    const jobs = await Job.find(query)
      .populate('company', 'companyName kyc.logo kyc.industry')
      .select('title slug category employmentType experienceLevel location salary isUrgent isFeatured createdAt')
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs',
      error: error.message
    });
  }
});

module.exports = router;