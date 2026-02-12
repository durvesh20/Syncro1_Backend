// backend/controllers/companyController.js
const Company = require('../models/Company');
const User = require('../models/User');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

// @desc    Get Company Profile
// @route   GET /api/companies/profile
exports.getProfile = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id })
      .populate('user', 'email mobile status');

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      data: company
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
};

// backend/controllers/companyController.js

// @desc    Update Company KYC
// @route   PUT /api/companies/profile/kyc
exports.updateKYC = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // ✅ Handle operating address "same as registered" logic
    if (req.body.operatingAddress?.sameAsRegistered) {
      req.body.operatingAddress = {
        ...req.body.registeredAddress,
        sameAsRegistered: true
      };
    }

    company.kyc = { ...company.kyc, ...req.body };
    company.profileCompletion.kyc = true;
    await company.save();

    res.json({
      success: true,
      message: 'KYC updated successfully',
      data: company.kyc
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Hiring Preferences
// @route   PUT /api/companies/profile/hiring-preferences
exports.updateHiringPreferences = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    company.hiringPreferences = { ...company.hiringPreferences, ...req.body };
    company.profileCompletion.hiringPreferences = true;
    await company.save();

    res.json({
      success: true,
      message: 'Hiring preferences updated successfully',
      data: company.hiringPreferences
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Update Billing Setup
// @route   PUT /api/companies/profile/billing
exports.updateBilling = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    company.billing = { ...company.billing, ...req.body };
    company.profileCompletion.billing = true;
    await company.save();

    res.json({
      success: true,
      message: 'Billing updated successfully',
      data: company.billing
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Accept Legal Consents
// @route   PUT /api/companies/profile/legal-consents
exports.updateLegalConsents = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const { 
      termsAccepted, 
      privacyPolicyAccepted, 
      dataProcessingAgreementAccepted,  // ✅ NEW
      vendorSharingConsent,              // ✅ NEW
      communicationConsent,              // ✅ NEW
      agreementSigned 
    } = req.body;

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = new Date();

    // ✅ Update with IP logging and timestamps
    company.legalConsents = {
      termsAccepted,
      termsAcceptedAt: termsAccepted ? timestamp : company.legalConsents.termsAcceptedAt,
      termsAcceptedIp: termsAccepted ? ipAddress : company.legalConsents.termsAcceptedIp,
      
      privacyPolicyAccepted,
      privacyPolicyAcceptedAt: privacyPolicyAccepted ? timestamp : company.legalConsents.privacyPolicyAcceptedAt,
      privacyPolicyAcceptedIp: privacyPolicyAccepted ? ipAddress : company.legalConsents.privacyPolicyAcceptedIp,
      
      dataProcessingAgreementAccepted,
      dataProcessingAgreementAcceptedAt: dataProcessingAgreementAccepted ? timestamp : company.legalConsents.dataProcessingAgreementAcceptedAt,
      dataProcessingAgreementAcceptedIp: dataProcessingAgreementAccepted ? ipAddress : company.legalConsents.dataProcessingAgreementAcceptedIp,
      
      vendorSharingConsent,
      vendorSharingConsentAt: vendorSharingConsent ? timestamp : company.legalConsents.vendorSharingConsentAt,
      vendorSharingConsentIp: vendorSharingConsent ? ipAddress : company.legalConsents.vendorSharingConsentIp,
      
      communicationConsent: communicationConsent || company.legalConsents.communicationConsent,
      communicationConsentAt: communicationConsent ? timestamp : company.legalConsents.communicationConsentAt,
      communicationConsentIp: communicationConsent ? ipAddress : company.legalConsents.communicationConsentIp,
      
      agreementSigned,
      agreementSignedAt: agreementSigned ? timestamp : company.legalConsents.agreementSignedAt
    };
    
    company.profileCompletion.legalConsents = true;
    await company.save();

    res.json({
      success: true,
      message: 'Legal consents updated successfully',
      data: company.legalConsents
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
// @route   PUT /api/companies/profile/documents
exports.uploadDocuments = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    company.documents = { ...company.documents, ...req.body };
    company.profileCompletion.documents = true;
    await company.save();

    res.json({
      success: true,
      message: 'Documents uploaded successfully',
      data: company.documents
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
};

// @desc    Submit Profile for Verification
// @route   POST /api/companies/profile/submit
exports.submitProfile = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    const user = await User.findById(req.user._id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check required sections
    const { basicInfo, kyc, hiringPreferences, billing, legalConsents } = company.profileCompletion;
    
    if (!basicInfo || !kyc || !hiringPreferences || !billing || !legalConsents) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required sections',
        data: company.profileCompletion
      });
    }

    company.verificationStatus = 'UNDER_REVIEW';
    user.status = 'UNDER_VERIFICATION';
    
    await company.save();
    await user.save();

    res.json({
      success: true,
      message: 'Profile submitted for verification',
      data: {
        verificationStatus: company.verificationStatus,
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

// @desc    Create Job Posting
// @route   POST /api/companies/jobs
exports.createJob = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const jobData = {
      ...req.body,
      company: company._id,
      postedBy: req.user._id,
      status: 'ACTIVE',
      eligiblePlans: req.body.eligiblePlans || ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM']
    };

    const job = await Job.create(jobData);

    // Update company metrics
    company.metrics.totalJobsPosted += 1;
    company.metrics.activeJobs += 1;
    await company.save();

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Job creation failed',
      error: error.message
    });
  }
};

// @desc    Get Company Jobs
// @route   GET /api/companies/jobs
exports.getJobs = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const { page = 1, limit = 10, status } = req.query;

    const query = { company: company._id };
    if (status) query.status = status;

    const jobs = await Job.find(query)
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

// @desc    Get Single Job
// @route   GET /api/companies/jobs/:id
exports.getJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job',
      error: error.message
    });
  }
};

// @desc    Update Job
// @route   PUT /api/companies/jobs/:id
exports.updateJob = async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      message: 'Job updated successfully',
      data: job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Delete/Close Job
// @route   DELETE /api/companies/jobs/:id
exports.deleteJob = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    job.status = 'CLOSED';
    await job.save();

    // Update company metrics
    const company = await Company.findById(job.company);
    if (company) {
      company.metrics.activeJobs = Math.max(0, company.metrics.activeJobs - 1);
      await company.save();
    }

    res.json({
      success: true,
      message: 'Job closed successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to close job',
      error: error.message
    });
  }
};

// @desc    Get Candidates for a Job
// @route   GET /api/companies/jobs/:jobId/candidates
exports.getJobCandidates = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const query = { job: req.params.jobId };
    if (status) query.status = status;

    const candidates = await Candidate.find(query)
      .populate('submittedBy', 'firstName lastName firmName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Candidate.countDocuments(query);

    res.json({
      success: true,
      data: {
        candidates,
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
      message: 'Failed to fetch candidates',
      error: error.message
    });
  }
};

// @desc    Get All Candidates for Company
// @route   GET /api/companies/candidates
exports.getAllCandidates = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    
    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const { page = 1, limit = 10, status } = req.query;

    const query = { company: company._id };
    if (status) query.status = status;

    const candidates = await Candidate.find(query)
      .populate('submittedBy', 'firstName lastName firmName')
      .populate('job', 'title')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Candidate.countDocuments(query);

    res.json({
      success: true,
      data: {
        candidates,
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
      message: 'Failed to fetch candidates',
      error: error.message
    });
  }
};

// @desc    Get Single Candidate
// @route   GET /api/companies/candidates/:id
exports.getCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
      .populate('submittedBy', 'firstName lastName firmName email')
      .populate('job', 'title commission')
      .populate({
        path: 'company',
        select: 'companyName user' // ✅ Include user field
      });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // ✅ Now check authorization properly
    const isCompany =
      req.user.role === 'company' &&
      candidate.company?.user?.toString() === req.user._id.toString();

    if (!isCompany) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this candidate'
      });
    }

    // Remove sensitive company.user before sending response
    const responseData = candidate.toObject();
    if (responseData.company?.user) {
      delete responseData.company.user;
    }

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch candidate',
      error: error.message
    });
  }
};

// @desc    Update Candidate Status
// @route   PUT /api/companies/candidates/:id/status
exports.updateCandidateStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;

    const candidate = await Candidate.findById(req.params.id)
      .populate({
        path: 'company',
        select: 'user' // ✅ Only need user for auth check
      });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // ✅ Verify this company owns this candidate
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this candidate'
      });
    }

    const previousStatus = candidate.status;

    // Update status
    candidate.status = status;
    candidate.statusHistory.push({
      status,
      changedBy: req.user._id,
      changedAt: new Date(),
      notes
    });

    await candidate.save();

    // Update job metrics based on status
    const job = await Job.findById(candidate.job);
    if (job) {
      if (status === 'SHORTLISTED' && previousStatus !== 'SHORTLISTED') {
        job.metrics.shortlisted += 1;
      }
      if (status === 'INTERVIEWED' && previousStatus !== 'INTERVIEWED') {
        job.metrics.interviewed += 1;
      }
      if (status === 'OFFERED' && previousStatus !== 'OFFERED') {
        job.metrics.offered += 1;
      }
      if (status === 'JOINED' && previousStatus !== 'JOINED') {
        job.metrics.joined += 1;
      }
      await job.save();
    }

    // Re-fetch without user field for response
    const updatedCandidate = await Candidate.findById(candidate._id)
      .populate('submittedBy', 'firstName lastName firmName')
      .populate('job', 'title commission')
      .populate('company', 'companyName');

    res.json({
      success: true,
      message: 'Candidate status updated',
      data: updatedCandidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Status update failed',
      error: error.message
    });
  }
};

// @desc    Schedule Interview
// @route   POST /api/companies/candidates/:id/interviews
exports.scheduleInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    const interview = {
      round: candidate.interviews.length + 1,
      type: req.body.type,
      scheduledAt: req.body.scheduledAt,
      interviewerName: req.body.interviewerName,
      interviewerEmail: req.body.interviewerEmail,
      meetingLink: req.body.meetingLink,
      result: 'PENDING'
    };

    candidate.interviews.push(interview);
    candidate.status = 'INTERVIEW_SCHEDULED';
    candidate.statusHistory.push({
      status: 'INTERVIEW_SCHEDULED',
      changedBy: req.user._id,
      notes: `Interview Round ${interview.round} scheduled for ${new Date(interview.scheduledAt).toLocaleString()}`
    });

    await candidate.save();

    res.json({
      success: true,
      message: 'Interview scheduled successfully',
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to schedule interview',
      error: error.message
    });
  }
};

// @desc    Update Interview Feedback
// @route   PUT /api/companies/candidates/:id/interviews/:interviewId
exports.updateInterviewFeedback = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    const interview = candidate.interviews.id(req.params.interviewId);
    if (!interview) {
      return res.status(404).json({
        success: false,
        message: 'Interview not found'
      });
    }

    interview.feedback = req.body.feedback;
    interview.rating = req.body.rating;
    interview.result = req.body.result;

    if (req.body.result === 'PASSED' || req.body.result === 'FAILED') {
      candidate.status = 'INTERVIEWED';
      candidate.statusHistory.push({
        status: 'INTERVIEWED',
        changedBy: req.user._id,
        notes: `Interview Round ${interview.round} completed - ${req.body.result}`
      });
    }

    await candidate.save();

    res.json({
      success: true,
      message: 'Interview feedback updated',
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update feedback',
      error: error.message
    });
  }
};

// @desc    Make Offer
// @route   POST /api/companies/candidates/:id/offer
exports.makeOffer = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    candidate.offer = {
      salary: req.body.salary,
      joiningDate: req.body.joiningDate,
      offerLetterUrl: req.body.offerLetterUrl,
      offeredAt: new Date(),
      response: 'PENDING'
    };
    candidate.status = 'OFFERED';
    candidate.statusHistory.push({
      status: 'OFFERED',
      changedBy: req.user._id,
      notes: `Offer made with salary ₹${req.body.salary}`
    });

    await candidate.save();

    res.json({
      success: true,
      message: 'Offer made successfully',
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to make offer',
      error: error.message
    });
  }
};

// @desc    Update Offer Response
// @route   PUT /api/companies/candidates/:id/offer
exports.updateOfferResponse = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    candidate.offer.response = req.body.response;
    candidate.offer.respondedAt = new Date();
    candidate.offer.negotiationNotes = req.body.negotiationNotes;

    if (req.body.response === 'ACCEPTED') {
      candidate.status = 'OFFER_ACCEPTED';
    } else if (req.body.response === 'DECLINED') {
      candidate.status = 'OFFER_DECLINED';
    }

    candidate.statusHistory.push({
      status: candidate.status,
      changedBy: req.user._id,
      notes: `Offer ${req.body.response.toLowerCase()}`
    });

    await candidate.save();

    res.json({
      success: true,
      message: 'Offer response updated',
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update offer response',
      error: error.message
    });
  }
};

// @desc    Confirm Joining
// @route   POST /api/companies/candidates/:id/joining
exports.confirmJoining = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);
    
    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    const job = await Job.findById(candidate.job);
    const company = await Company.findById(candidate.company);

    candidate.joining = {
      actualJoiningDate: req.body.joiningDate,
      confirmed: true,
      confirmedAt: new Date(),
      documentsSubmitted: req.body.documentsSubmitted || false
    };
    candidate.status = 'JOINED';
    candidate.statusHistory.push({
      status: 'JOINED',
      changedBy: req.user._id,
      notes: `Joined on ${new Date(req.body.joiningDate).toDateString()}`
    });

    // Calculate commission
    if (job && candidate.offer) {
      const commissionAmount = job.commission.type === 'percentage'
        ? (candidate.offer.salary * job.commission.value / 100)
        : job.commission.value;

      candidate.payout = {
        commissionAmount,
        status: 'PENDING'
      };
    }

    // Update metrics
    if (job) {
      job.filledPositions += 1;
      if (job.filledPositions >= job.vacancies) {
        job.status = 'FILLED';
      }
      await job.save();
    }

    if (company) {
      company.metrics.totalHires += 1;
      await company.save();
    }

    await candidate.save();

    res.json({
      success: true,
      message: 'Joining confirmed successfully',
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to confirm joining',
      error: error.message
    });
  }
};

// @desc    Add Note to Candidate
// @route   POST /api/companies/candidates/:id/notes
exports.addNote = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id);

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    candidate.notes.push({
      content: req.body.content,
      addedBy: req.user._id,
      isInternal: req.body.isInternal !== false
    });

    await candidate.save();

    res.json({
      success: true,
      message: 'Note added successfully',
      data: candidate.notes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add note',
      error: error.message
    });
  }
};

// @desc    Get Dashboard Stats
// @route   GET /api/companies/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Get job stats
    const jobStats = await Job.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get recent candidates
    const recentCandidates = await Candidate.find({ company: company._id })
      .populate('job', 'title')
      .populate('submittedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get hiring funnel
    const hiringFunnel = await Candidate.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get active jobs
    const activeJobs = await Job.find({ 
      company: company._id, 
      status: 'ACTIVE' 
    }).limit(5);

    res.json({
      success: true,
      data: {
        company: {
          name: company.companyName,
          verificationStatus: company.verificationStatus,
          profileCompletion: company.profileCompletion
        },
        metrics: company.metrics,
        jobStats,
        recentCandidates,
        hiringFunnel,
        activeJobs
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