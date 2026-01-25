// backend/controllers/staffingPartnerController.js
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

// @desc    Get Staffing Partner Profile
// @route   GET /api/staffing-partners/profile
exports.getProfile = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id })
      .populate('user', 'email mobile status');

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      data: partner
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
};

// @desc    Update Basic Info
// @route   PUT /api/staffing-partners/profile/basic-info
exports.updateBasicInfo = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { firstName, lastName, firmName, designation, linkedinProfile, city, state } = req.body;

    if (firstName) partner.firstName = firstName;
    if (lastName) partner.lastName = lastName;
    if (firmName) partner.firmName = firmName;
    if (designation) partner.designation = designation;
    if (linkedinProfile) partner.linkedinProfile = linkedinProfile;
    if (city) partner.city = city;
    if (state) partner.state = state;

    partner.profileCompletion.basicInfo = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Basic info updated',
      data: partner
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Firm Details
// @route   PUT /api/staffing-partners/profile/firm-details
exports.updateFirmDetails = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    partner.firmDetails = { ...partner.firmDetails, ...req.body };
    partner.profileCompletion.firmDetails = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Firm details updated',
      data: partner.firmDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Syncro1 Competency
// @route   PUT /api/staffing-partners/profile/Syncro1-competency
exports.updateSyncro1Competency = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    partner.Syncro1Competency = { ...partner.Syncro1Competency, ...req.body };
    partner.profileCompletion.Syncro1Competency = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Syncro1 competency updated',
      data: partner.Syncro1Competency
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Geographic Reach
// @route   PUT /api/staffing-partners/profile/geographic-reach
exports.updateGeographicReach = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    partner.geographicReach = { ...partner.geographicReach, ...req.body };
    partner.profileCompletion.geographicReach = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Geographic reach updated',
      data: partner.geographicReach
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Compliance & Sign Agreement
// @route   PUT /api/staffing-partners/profile/compliance
exports.updateCompliance = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { digitalSignature, termsAccepted, ndaSigned } = req.body;

    partner.compliance = {
      ...partner.compliance,
      termsAccepted,
      ndaSigned,
      digitalSignature,
      agreementSigned: termsAccepted && ndaSigned,
      agreementSignedAt: new Date()
    };
    partner.profileCompletion.compliance = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Compliance updated',
      data: partner.compliance
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Finance Details
// @route   PUT /api/staffing-partners/profile/finance
exports.updateFinanceDetails = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    partner.financeDetails = { ...partner.financeDetails, ...req.body };
    partner.profileCompletion.financeDetails = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Finance details updated',
      data: partner.financeDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Upload Documents
// @route   PUT /api/staffing-partners/profile/documents
exports.uploadDocuments = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    partner.documents = { ...partner.documents, ...req.body };
    await partner.save();

    res.json({
      success: true,
      message: 'Documents uploaded',
      data: partner.documents
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
};

// @desc    Get Profile Completion Status
// @route   GET /api/staffing-partners/profile/completion
exports.getProfileCompletion = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const completion = partner.profileCompletion;
    const total = Object.keys(completion).length;
    const completed = Object.values(completion).filter(Boolean).length;
    const percentage = Math.round((completed / total) * 100);

    res.json({
      success: true,
      data: {
        completion,
        percentage,
        completed,
        total,
        canSubmit: completion.basicInfo && completion.firmDetails && 
                   completion.Syncro1Competency && completion.geographicReach && 
                   completion.compliance
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch completion status',
      error: error.message
    });
  }
};

// @desc    Submit Profile for Verification
// @route   POST /api/staffing-partners/profile/submit
exports.submitProfile = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const user = await User.findById(req.user._id);

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Check if required sections are complete
    const { basicInfo, firmDetails, Syncro1Competency, geographicReach, compliance } = partner.profileCompletion;
    
    if (!basicInfo || !firmDetails || !Syncro1Competency || !geographicReach || !compliance) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required sections before submitting',
        data: partner.profileCompletion
      });
    }

    partner.verificationStatus = 'UNDER_REVIEW';
    user.status = 'UNDER_VERIFICATION';
    
    await partner.save();
    await user.save();

    res.json({
      success: true,
      message: 'Profile submitted for verification',
      data: {
        verificationStatus: partner.verificationStatus,
        userStatus: user.status
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Submission failed',
      error: error.message
    });
  }
};

// @desc    Get Available Jobs
// @route   GET /api/staffing-partners/jobs
exports.getAvailableJobs = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { page = 1, limit = 10, category, location, experienceLevel, search } = req.query;

    const query = {
      status: 'ACTIVE',
      eligiblePlans: partner.subscription?.plan || 'FREE'
    };

    if (category) query.category = category;
    if (location) query['location.city'] = new RegExp(location, 'i');
    if (experienceLevel) query.experienceLevel = experienceLevel;
    if (search) {
      query.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ];
    }

    const jobs = await Job.find(query)
      .populate('company', 'companyName kyc.logo kyc.industry')
      .sort({ createdAt: -1 })
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
};

// @desc    Get Job Details with Shareable Link
// @route   GET /api/staffing-partners/jobs/:id
exports.getJobDetails = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('company', 'companyName kyc.logo kyc.industry kyc.companyType kyc.website');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Increment view count
    job.metrics.views += 1;
    await job.save();

    res.json({
      success: true,
      data: {
        job,
        shareableLink: job.shareableLink
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job',
      error: error.message
    });
  }
};

// @desc    Submit Candidate for a Job
// @route   POST /api/staffing-partners/jobs/:jobId/candidates
exports.submitCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const job = await Job.findById(req.params.jobId);

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner profile not found'
      });
    }

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'This job is no longer accepting applications'
      });
    }

    const {
      firstName, lastName, email, mobile,
      consent, profile
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !mobile) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required candidate information'
      });
    }

    if (!consent) {
      return res.status(400).json({
        success: false,
        message: 'Candidate consent is required'
      });
    }

    // Check for duplicate submission
    const existingSubmission = await Candidate.findOne({
      job: job._id,
      email: email.toLowerCase()
    });

    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: 'This candidate has already been submitted for this job'
      });
    }

    // Create candidate
    const candidate = await Candidate.create({
      submittedBy: partner._id,
      job: job._id,
      company: job.company,
      firstName,
      lastName,
      email: email.toLowerCase(),
      mobile,
      consent: {
        given: consent,
        givenAt: new Date()
      },
      profile: profile || {},
      status: 'SUBMITTED',
      statusHistory: [{
        status: 'SUBMITTED',
        changedBy: req.user._id,
        notes: 'Initial submission'
      }]
    });

    // Update metrics
    job.metrics.applications += 1;
    partner.metrics.totalSubmissions += 1;
    
    await job.save();
    await partner.save();

    res.status(201).json({
      success: true,
      message: 'Candidate submitted successfully',
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Submission failed',
      error: error.message
    });
  }
};

// @desc    Upload Resume for Candidate
// @route   POST /api/staffing-partners/candidates/:id/resume
exports.uploadResume = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a file'
      });
    }

    candidate.resume = {
      url: req.file.path,
      fileName: req.file.originalname,
      uploadedAt: new Date()
    };

    await candidate.save();

    res.json({
      success: true,
      message: 'Resume uploaded successfully',
      data: candidate.resume
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
};

// @desc    Get My Submissions
// @route   GET /api/staffing-partners/submissions
exports.getMySubmissions = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { page = 1, limit = 10, status } = req.query;

    const query = { submittedBy: partner._id };
    if (status) query.status = status;

    const submissions = await Candidate.find(query)
      .populate('job', 'title company commission')
      .populate('company', 'companyName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Candidate.countDocuments(query);

    res.json({
      success: true,
      data: {
        submissions,
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
      message: 'Failed to fetch submissions',
      error: error.message
    });
  }
};

// @desc    Get Single Submission
// @route   GET /api/staffing-partners/submissions/:id
exports.getSubmission = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    const submission = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    })
      .populate('job', 'title company commission')
      .populate('company', 'companyName');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submission',
      error: error.message
    });
  }
};

// @desc    Get Dashboard Stats
// @route   GET /api/staffing-partners/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Get recent submissions
    const recentSubmissions = await Candidate.find({ submittedBy: partner._id })
      .populate('job', 'title')
      .populate('company', 'companyName')
      .sort({ createdAt: -1 })
      .limit(5);

    // Get status breakdown
    const statusBreakdown = await Candidate.aggregate([
      { $match: { submittedBy: partner._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get available jobs count
    const availableJobsCount = await Job.countDocuments({
      status: 'ACTIVE',
      eligiblePlans: partner.subscription?.plan || 'FREE'
    });

    // Calculate profile completion
    const profileCompletion = partner.profileCompletion;
    const completedSections = Object.values(profileCompletion).filter(Boolean).length;
    const totalSections = Object.keys(profileCompletion).length;
    const completionPercentage = Math.round((completedSections / totalSections) * 100);

    res.json({
      success: true,
      data: {
        partner: {
          name: `${partner.firstName} ${partner.lastName}`,
          firmName: partner.firmName,
          verificationStatus: partner.verificationStatus
        },
        metrics: partner.metrics,
        subscription: partner.subscription,
        profileCompletion: {
          ...profileCompletion,
          percentage: completionPercentage
        },
        recentSubmissions,
        statusBreakdown,
        availableJobsCount
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard',
      error: error.message
    });
  }
};

// @desc    Get Earnings/Payouts
// @route   GET /api/staffing-partners/earnings
exports.getEarnings = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Get placed candidates with payout info
    const placements = await Candidate.find({
      submittedBy: partner._id,
      status: 'JOINED'
    })
      .populate('job', 'title commission')
      .populate('company', 'companyName')
      .sort({ 'joining.confirmedAt': -1 });

    // Calculate totals
    const totalEarnings = placements.reduce((sum, p) => sum + (p.payout?.commissionAmount || 0), 0);
    const paidEarnings = placements
      .filter(p => p.payout?.status === 'PAID')
      .reduce((sum, p) => sum + (p.payout?.commissionAmount || 0), 0);
    const pendingEarnings = totalEarnings - paidEarnings;

    res.json({
      success: true,
      data: {
        summary: {
          totalEarnings,
          paidEarnings,
          pendingEarnings,
          totalPlacements: placements.length
        },
        placements
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings',
      error: error.message
    });
  }
};