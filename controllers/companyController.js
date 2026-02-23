// backend/controllers/companyController.js
const Company = require('../models/Company');
const User = require('../models/User');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

// ==================== 1. PRIMARY ACCOUNT (Decision Maker) ====================

// @desc    Update Primary Account / Basic Info
// @route   PUT /api/companies/profile/basic-info
exports.updateBasicInfo = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const {
      firstName,          // ✅ Accept firstName
      lastName,           // ✅ Accept lastName
      designation,
      department,
      linkedinProfile,
      city,
      state
    } = req.body;

    // ✅ Combine firstName + lastName if provided
    if (firstName && lastName) {
      company.decisionMakerName = `${firstName} ${lastName}`;
    } else if (firstName || lastName) {
      // If only one provided, update accordingly
      const currentName = company.decisionMakerName.split(' ');
      if (firstName) {
        currentName[0] = firstName;
      }
      if (lastName) {
        currentName[1] = lastName;
      }
      company.decisionMakerName = currentName.join(' ');
    }

    if (designation) company.designation = designation;
    if (department) company.department = department;
    if (linkedinProfile) company.linkedinProfile = linkedinProfile;
    if (city) company.city = city;
    if (state) company.state = state;

    company.profileCompletion.basicInfo = true;
    await company.save();

    // ✅ Return firstName and lastName separately for frontend
    const [returnFirstName, ...lastNameParts] = company.decisionMakerName.split(' ');
    const returnLastName = lastNameParts.join(' ');

    res.json({
      success: true,
      message: 'Basic info updated successfully',
      data: {
        firstName: returnFirstName,
        lastName: returnLastName,
        decisionMakerName: company.decisionMakerName,
        designation: company.designation,
        department: company.department,
        linkedinProfile: company.linkedinProfile,
        city: company.city,
        state: company.state
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// ==================== 2. COMPANY INFORMATION (Core KYC Layer) ====================

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

    const {
      registeredName,
      tradeName,
      logo,
      description,
      website,
      companyType,
      yearEstablished,
      cinNumber,
      llpinNumber,
      registeredAddress,
      operatingAddress,
      gstNumber,
      panNumber,
      industry,
      employeeCount
    } = req.body;

    // Handle operating address "same as registered" logic
    let finalOperatingAddress = operatingAddress;
    if (operatingAddress?.sameAsRegistered && registeredAddress) {
      finalOperatingAddress = {
        ...registeredAddress,
        sameAsRegistered: true
      };
    }

    company.kyc = {
      ...company.kyc,
      registeredName,
      tradeName,
      logo,
      description,
      website,
      companyType,
      yearEstablished,
      cinNumber,
      llpinNumber,
      registeredAddress,
      operatingAddress: finalOperatingAddress,
      gstNumber,
      panNumber,
      industry,
      employeeCount
    };

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

// ==================== 3. HIRING & BUSINESS PROFILE ====================

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

    const {
      preferredIndustries,
      functionalAreas,
      experienceLevels,
      hiringType,
      avgMonthlyHiringVolume,
      typicalCtcBand,
      preferredLocations,
      workModePreference,
      urgencyLevel
    } = req.body;

    company.hiringPreferences = {
      ...company.hiringPreferences,
      preferredIndustries,
      functionalAreas,
      experienceLevels,
      hiringType,
      avgMonthlyHiringVolume,
      typicalCtcBand,
      preferredLocations,
      workModePreference,
      urgencyLevel
    };

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

// ==================== 5. COMMERCIAL & BILLING SETUP ====================

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

    const {
      billingEntityName,
      billingAddress,
      gstRegistrationType,
      gstNumber,
      panNumber,
      poRequired,
      tdsApplicable,
      paymentTerms,
      preferredPaymentMethod
    } = req.body;

    company.billing = {
      ...company.billing,
      billingEntityName,
      billingAddress,
      gstRegistrationType,
      gstNumber,
      panNumber,
      poRequired,
      tdsApplicable,
      paymentTerms,
      preferredPaymentMethod
    };

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

// ==================== 6. USER ROLES & ACCESS CONTROL ====================

// @desc    Update Team Access (Enterprise Feature)
// @route   PUT /api/companies/profile/team-access
exports.updateTeamAccess = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Only verified companies can add team members
    if (company.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Company must be verified to add team members'
      });
    }

    const { isTeamEnabled, teamMembers } = req.body;

    company.teamAccess = {
      isTeamEnabled: isTeamEnabled || false,
      teamMembers: teamMembers || []
    };

    await company.save();

    res.json({
      success: true,
      message: 'Team access updated successfully',
      data: company.teamAccess
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
    });
  }
};

// @desc    Add Team Member
// @route   POST /api/companies/profile/team-access/member
exports.addTeamMember = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    if (company.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Company must be verified to add team members'
      });
    }

    const { name, email, mobile, role } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and role are required'
      });
    }

    // Check if email already exists in team
    const existingMember = company.teamAccess.teamMembers.find(
      m => m.email === email
    );

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: 'Team member with this email already exists'
      });
    }

    company.teamAccess.isTeamEnabled = true;
    company.teamAccess.teamMembers.push({
      name,
      email,
      mobile,
      role,
      addedAt: new Date(),
      isActive: true
    });

    await company.save();

    res.json({
      success: true,
      message: 'Team member added successfully',
      data: company.teamAccess
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add team member',
      error: error.message
    });
  }
};

// @desc    Remove Team Member
// @route   DELETE /api/companies/profile/team-access/member/:memberId
exports.removeTeamMember = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const { memberId } = req.params;

    company.teamAccess.teamMembers = company.teamAccess.teamMembers.filter(
      m => m._id.toString() !== memberId
    );

    await company.save();

    res.json({
      success: true,
      message: 'Team member removed successfully',
      data: company.teamAccess
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to remove team member',
      error: error.message
    });
  }
};

// ==================== 7. LEGAL & COMPLIANCE ====================

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
      dataProcessingAgreementAccepted,
      dataStorageConsent,
      vendorSharingConsent,
      communicationConsent
    } = req.body;

    // Get IP address for logging
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = new Date();

    company.legalConsents = {
      // Terms of Service
      termsAccepted,
      termsAcceptedAt: termsAccepted ? timestamp : company.legalConsents?.termsAcceptedAt,
      termsAcceptedIp: termsAccepted ? ipAddress : company.legalConsents?.termsAcceptedIp,

      // Privacy Policy
      privacyPolicyAccepted,
      privacyPolicyAcceptedAt: privacyPolicyAccepted ? timestamp : company.legalConsents?.privacyPolicyAcceptedAt,
      privacyPolicyAcceptedIp: privacyPolicyAccepted ? ipAddress : company.legalConsents?.privacyPolicyAcceptedIp,

      // Data Processing Agreement
      dataProcessingAgreementAccepted,
      dataProcessingAgreementAcceptedAt: dataProcessingAgreementAccepted ? timestamp : company.legalConsents?.dataProcessingAgreementAcceptedAt,
      dataProcessingAgreementAcceptedIp: dataProcessingAgreementAccepted ? ipAddress : company.legalConsents?.dataProcessingAgreementAcceptedIp,

      // Data Storage Consent
      dataStorageConsent,
      dataStorageConsentAt: dataStorageConsent ? timestamp : company.legalConsents?.dataStorageConsentAt,
      dataStorageConsentIp: dataStorageConsent ? ipAddress : company.legalConsents?.dataStorageConsentIp,

      // Vendor Sharing Consent
      vendorSharingConsent,
      vendorSharingConsentAt: vendorSharingConsent ? timestamp : company.legalConsents?.vendorSharingConsentAt,
      vendorSharingConsentIp: vendorSharingConsent ? ipAddress : company.legalConsents?.vendorSharingConsentIp,

      // Communication Consent
      communicationConsent: communicationConsent || company.legalConsents?.communicationConsent,
      communicationConsentAt: communicationConsent ? timestamp : company.legalConsents?.communicationConsentAt,
      communicationConsentIp: communicationConsent ? ipAddress : company.legalConsents?.communicationConsentIp
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

// ==================== 8. DOCUMENTS (Post-Signup Verification) ====================

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

    const {
      gstCertificate,
      panCard,
      incorporationCertificate,
      authorizedSignatoryProof,
      addressProof
    } = req.body;

    // ✅ Update only provided documents
    if (gstCertificate) company.documents.gstCertificate = gstCertificate;
    if (panCard) company.documents.panCard = panCard;
    if (incorporationCertificate) company.documents.incorporationCertificate = incorporationCertificate;
    if (authorizedSignatoryProof) company.documents.authorizedSignatoryProof = authorizedSignatoryProof;
    if (addressProof) company.documents.addressProof = addressProof;

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


// ==================== PROFILE MANAGEMENT ====================

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

    // ✅ Split decisionMakerName for frontend
    const [firstName, ...lastNameParts] = company.decisionMakerName.split(' ');
    const lastName = lastNameParts.join(' ');

    const responseData = {
      ...company.toObject(),
      firstName,  // ✅ Add firstName
      lastName    // ✅ Add lastName
    };

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message
    });
  }
};

// @desc    Get Profile Completion Status
// @route   GET /api/companies/profile/completion
exports.getProfileCompletion = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const completion = company.profileCompletion;
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
        canSubmit:
          completion.basicInfo &&
          completion.kyc &&
          completion.hiringPreferences &&
          completion.billing &&
          completion.legalConsents
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

// ==================== DASHBOARD ====================

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

    // Calculate profile completion
    const profileCompletion = company.profileCompletion;
    const completedSections = Object.values(profileCompletion).filter(Boolean).length;
    const totalSections = Object.keys(profileCompletion).length;
    const completionPercentage = Math.round((completedSections / totalSections) * 100);

    res.json({
      success: true,
      data: {
        company: {
          name: company.companyName,
          verificationStatus: company.verificationStatus,
          profileCompletion: {
            ...profileCompletion,
            percentage: completionPercentage
          }
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

// ==================== JOB MANAGEMENT (Existing - Keep as is) ====================

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

// ==================== CANDIDATE MANAGEMENT (Keep existing with auth fixes) ====================

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
// @desc    Get Single Candidate
// @route   GET /api/companies/candidates/:id
exports.getCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
      .populate('submittedBy', 'firstName lastName firmName email')
      .populate('job', 'title commission')
      .populate({
        path: 'company',
        select: 'companyName user'
      });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // ✅ More robust authorization check
    if (req.user.role === 'company') {
      const company = await Company.findOne({ user: req.user._id });

      if (!company || candidate.company._id.toString() !== company._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this candidate'
        });
      }
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this candidate'
      });
    }

    // Clean response
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
        select: 'user'
      });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify this company owns this candidate
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
    const candidate = await Candidate.findById(req.params.id)
      .populate({ path: 'company', select: 'user' });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify ownership
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
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
    const candidate = await Candidate.findById(req.params.id)
      .populate({ path: 'company', select: 'user' });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify ownership
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
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
    const candidate = await Candidate.findById(req.params.id)
      .populate({ path: 'company', select: 'user' });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify ownership
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
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
    const candidate = await Candidate.findById(req.params.id)
      .populate({ path: 'company', select: 'user' });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify ownership
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
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
    const candidate = await Candidate.findById(req.params.id)
      .populate({ path: 'company', select: 'user' });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify ownership
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const job = await Job.findById(candidate.job);
    const company = await Company.findById(candidate.company._id);

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
    const candidate = await Candidate.findById(req.params.id)
      .populate({ path: 'company', select: 'user' });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    // Verify ownership
    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
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