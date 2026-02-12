// backend/controllers/staffingPartnerController.js
const StaffingPartner = require("../models/StaffingPartner");
const User = require("../models/User");
const Job = require("../models/Job");
const Candidate = require("../models/Candidate");

// @desc    Get Staffing Partner Profile
// @route   GET /api/staffing-partners/profile
exports.getProfile = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({
      user: req.user._id,
    }).populate("user", "email mobile status");

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    res.json({
      success: true,
      data: partner,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    const {
      firstName,
      lastName,
      firmName,
      designation,
      linkedinProfile,
      city,
      state,
    } = req.body;

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
      message: "Basic info updated",
      data: partner,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    const {
      registeredName,
      tradeName,
      entityType,
      yearEstablished,
      website,
      registeredOfficeAddress,
      operatingAddress,
      panNumber,
      gstNumber,
      cinNumber,
      llpinNumber,
      employeeCount
    } = req.body;

    // Handle operating address "same as registered" logic
    let finalOperatingAddress = operatingAddress;
    if (operatingAddress?.sameAsRegistered && registeredOfficeAddress) {
      finalOperatingAddress = {
        ...registeredOfficeAddress,
        sameAsRegistered: true
      };
    }

    partner.firmDetails = {
      ...partner.firmDetails,
      registeredName,
      tradeName,
      entityType,
      yearEstablished,
      website,
      registeredOfficeAddress,
      operatingAddress: finalOperatingAddress,
      panNumber,
      gstNumber,
      cinNumber,
      llpinNumber,
      employeeCount
    };

    partner.profileCompletion.firmDetails = true;
    await partner.save();

    res.json({
      success: true,
      message: "Firm details updated",
      data: partner.firmDetails,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    partner.Syncro1Competency = { ...partner.Syncro1Competency, ...req.body };
    partner.profileCompletion.Syncro1Competency = true;
    await partner.save();

    res.json({
      success: true,
      message: "Syncro1 competency updated",
      data: partner.Syncro1Competency,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    partner.geographicReach = { ...partner.geographicReach, ...req.body };
    partner.profileCompletion.geographicReach = true;
    await partner.save();

    res.json({
      success: true,
      message: "Geographic reach updated",
      data: partner.geographicReach,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

// @desc    Update Compliance & Ethical Declarations
// @route   PUT /api/staffing-partners/profile/compliance
exports.updateCompliance = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const { syncrotechAgreement, digitalSignature } = req.body;

    // Get IP address
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = new Date();

    // Validate all clauses are accepted
    const requiredClauses = [
      'noCvRecycling',
      'noFakeProfiles',
      'noDoubleRepresentation',
      'vendorCodeOfConduct',
      'dataPrivacyPolicy',
      'candidateConsentPolicy',
      'nonCircumventionClause',
      'commissionPayoutTerms',
      'replacementBackoutLiability'
    ];

    const allAccepted = requiredClauses.every(
      clause => syncrotechAgreement && syncrotechAgreement[clause] === true
    );

    if (!allAccepted) {
      return res.status(400).json({
        success: false,
        message: "All compliance clauses must be accepted",
        data: {
          required: requiredClauses,
          received: syncrotechAgreement
        }
      });
    }

    // Build compliance object with timestamps
    const complianceData = {
      syncrotechAgreement: {}
    };

    requiredClauses.forEach(clause => {
      complianceData.syncrotechAgreement[clause] = {
        accepted: true,
        acceptedAt: timestamp,
        acceptedIp: ipAddress
      };
    });

    complianceData.allClausesAccepted = true;
    complianceData.agreementAcceptedAt = timestamp;
    complianceData.agreementAcceptedIp = ipAddress;
    complianceData.digitalSignature = digitalSignature;
    complianceData.termsAccepted = true;
    complianceData.ndaSigned = true;
    complianceData.agreementSigned = true;
    complianceData.agreementSignedAt = timestamp;

    partner.compliance = complianceData;
    partner.profileCompletion.compliance = true;
    await partner.save();

    res.json({
      success: true,
      message: "Compliance updated successfully",
      data: partner.compliance,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    partner.financeDetails = { ...partner.financeDetails, ...req.body };
    partner.profileCompletion.financeDetails = true;
    await partner.save();

    res.json({
      success: true,
      message: "Finance details updated",
      data: partner.financeDetails,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

// @desc    Update Payout Preferences
// @route   PUT /api/staffing-partners/profile/payout-preferences
exports.updatePayoutPreferences = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    partner.payoutPreferences = {
      ...partner.payoutPreferences,
      ...req.body,
    };

    partner.profileCompletion.payoutPreferences = true;

    await partner.save();

    res.json({
      success: true,
      message: "Payout preferences updated",
      data: partner.payoutPreferences,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

// @desc    Update Team Access
// @route   PUT /api/staffing-partners/profile/team-access
exports.updateTeamAccess = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    // Only verified partners can manage team
    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to manage team members"
      });
    }

    const { isTeamEnabled } = req.body;

    partner.teamAccess.isTeamEnabled = isTeamEnabled || false;
    await partner.save();

    res.json({
      success: true,
      message: "Team access updated",
      data: partner.teamAccess,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

// @desc    Add Team Member
// @route   POST /api/staffing-partners/profile/team-access/member
exports.addTeamMember = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to add team members"
      });
    }

    const { name, email, mobile, role, permissions } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required"
      });
    }

    // Check if email already exists
    const existingMember = partner.teamAccess.teamMembers.find(
      m => m.email === email
    );

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: "Team member with this email already exists"
      });
    }

    partner.teamAccess.isTeamEnabled = true;
    partner.teamAccess.teamMembers.push({
      name,
      email,
      mobile,
      role: role || 'Recruiter',
      permissions: permissions || {
        canViewJobs: true,
        canSubmitCandidates: true,
        canViewEarnings: false,
        canManageTeam: false
      },
      addedAt: new Date(),
      isActive: true
    });

    await partner.save();

    res.json({
      success: true,
      message: "Team member added successfully",
      data: partner.teamAccess,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to add team member",
      error: error.message,
    });
  }
};

// @desc    Update Team Member
// @route   PUT /api/staffing-partners/profile/team-access/member/:memberId
exports.updateTeamMember = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to update team members"
      });
    }

    const { memberId } = req.params;
    const { name, email, mobile, role, permissions, isActive } = req.body;

    const memberIndex = partner.teamAccess.teamMembers.findIndex(
      m => m._id.toString() === memberId
    );

    if (memberIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Team member not found"
      });
    }

    // Check if email already exists (for different member)
    if (email) {
      const existingMember = partner.teamAccess.teamMembers.find(
        m => m.email === email && m._id.toString() !== memberId
      );

      if (existingMember) {
        return res.status(400).json({
          success: false,
          message: "Another team member with this email already exists"
        });
      }
    }

    // Update member fields
    if (name) partner.teamAccess.teamMembers[memberIndex].name = name;
    if (email) partner.teamAccess.teamMembers[memberIndex].email = email;
    if (mobile) partner.teamAccess.teamMembers[memberIndex].mobile = mobile;
    if (role) partner.teamAccess.teamMembers[memberIndex].role = role;
    if (permissions) partner.teamAccess.teamMembers[memberIndex].permissions = permissions;
    if (typeof isActive === 'boolean') partner.teamAccess.teamMembers[memberIndex].isActive = isActive;

    await partner.save();

    res.json({
      success: true,
      message: "Team member updated successfully",
      data: partner.teamAccess,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update team member",
      error: error.message,
    });
  }
};

// @desc    Remove Team Member
// @route   DELETE /api/staffing-partners/profile/team-access/member/:memberId
exports.removeTeamMember = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to remove team members"
      });
    }

    const { memberId } = req.params;

    const memberExists = partner.teamAccess.teamMembers.some(
      m => m._id.toString() === memberId
    );

    if (!memberExists) {
      return res.status(404).json({
        success: false,
        message: "Team member not found"
      });
    }

    partner.teamAccess.teamMembers = partner.teamAccess.teamMembers.filter(
      m => m._id.toString() !== memberId
    );

    // If no team members left, disable team access
    if (partner.teamAccess.teamMembers.length === 0) {
      partner.teamAccess.isTeamEnabled = false;
    }

    await partner.save();

    res.json({
      success: true,
      message: "Team member removed successfully",
      data: partner.teamAccess,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to remove team member",
      error: error.message,
    });
  }
};

// @desc    Get Team Members
// @route   GET /api/staffing-partners/profile/team-access/members
exports.getTeamMembers = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    res.json({
      success: true,
      data: {
        isTeamEnabled: partner.teamAccess.isTeamEnabled,
        teamMembers: partner.teamAccess.teamMembers,
        totalMembers: partner.teamAccess.teamMembers.length,
        activeMembers: partner.teamAccess.teamMembers.filter(m => m.isActive).length
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch team members",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    partner.documents = { ...partner.documents, ...req.body };
    await partner.save();

    res.json({
      success: true,
      message: "Documents uploaded",
      data: partner.documents,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
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
        message: "Profile not found",
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
        canSubmit:
          completion.basicInfo &&
          completion.firmDetails &&
          completion.Syncro1Competency &&
          completion.geographicReach &&
          completion.compliance,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch completion status",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    // Check if required sections are complete
    const {
      basicInfo,
      firmDetails,
      Syncro1Competency,
      geographicReach,
      compliance,
    } = partner.profileCompletion;

    if (
      !basicInfo ||
      !firmDetails ||
      !Syncro1Competency ||
      !geographicReach ||
      !compliance
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required sections before submitting",
        data: partner.profileCompletion,
      });
    }

    partner.verificationStatus = "UNDER_REVIEW";
    user.status = "UNDER_VERIFICATION";

    await partner.save();
    await user.save();

    res.json({
      success: true,
      message: "Profile submitted for verification",
      data: {
        verificationStatus: partner.verificationStatus,
        userStatus: user.status,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Submission failed",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    const {
      page = 1,
      limit = 10,
      category,
      location,
      experienceLevel,
      search,
    } = req.query;

    const query = {
      status: "ACTIVE",
      eligiblePlans: partner.subscription?.plan || "FREE",
    };

    if (category) query.category = category;
    if (location) query["location.city"] = new RegExp(location, "i");
    if (experienceLevel) query.experienceLevel = experienceLevel;
    if (search) {
      query.$or = [
        { title: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
      ];
    }

    const jobs = await Job.find(query)
      .populate("company", "companyName kyc.logo kyc.industry")
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
          total,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch jobs",
      error: error.message,
    });
  }
};

// @desc    Get Job Details with Shareable Link
// @route   GET /api/staffing-partners/jobs/:id
exports.getJobDetails = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate(
      "company",
      "companyName kyc.logo kyc.industry kyc.companyType kyc.website",
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Increment view count
    job.metrics.views += 1;
    await job.save();

    res.json({
      success: true,
      data: {
        job,
        shareableLink: job.shareableLink,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch job",
      error: error.message,
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
        message: "Partner profile not found",
      });
    }

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    if (job.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: "This job is no longer accepting applications",
      });
    }

    const { firstName, lastName, email, mobile, consent, profile } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !mobile) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required candidate information",
      });
    }

    if (!consent) {
      return res.status(400).json({
        success: false,
        message: "Candidate consent is required",
      });
    }

    // Check for duplicate submission
    const existingSubmission = await Candidate.findOne({
      job: job._id,
      email: email.toLowerCase(),
    });

    if (existingSubmission) {
      return res.status(400).json({
        success: false,
        message: "This candidate has already been submitted for this job",
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
        givenAt: new Date(),
      },
      profile: profile || {},
      status: "SUBMITTED",
      statusHistory: [
        {
          status: "SUBMITTED",
          changedBy: req.user._id,
          notes: "Initial submission",
        },
      ],
    });

    // Update metrics
    job.metrics.applications += 1;
    partner.metrics.totalSubmissions += 1;

    await job.save();
    await partner.save();

    res.status(201).json({
      success: true,
      message: "Candidate submitted successfully",
      data: candidate,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Submission failed",
      error: error.message,
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
        message: "Candidate not found",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file",
      });
    }

    candidate.resume = {
      url: req.file.path,
      fileName: req.file.originalname,
      uploadedAt: new Date(),
    };

    await candidate.save();

    res.json({
      success: true,
      message: "Resume uploaded successfully",
      data: candidate.resume,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    const { page = 1, limit = 10, status } = req.query;

    const query = { submittedBy: partner._id };
    if (status) query.status = status;

    const submissions = await Candidate.find(query)
      .populate("job", "title company commission")
      .populate("company", "companyName")
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
          total,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch submissions",
      error: error.message,
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
      submittedBy: partner._id,
    })
      .populate("job", "title company commission")
      .populate("company", "companyName");

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Submission not found",
      });
    }

    res.json({
      success: true,
      data: submission,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch submission",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    // Get recent submissions
    const recentSubmissions = await Candidate.find({ submittedBy: partner._id })
      .populate("job", "title")
      .populate("company", "companyName")
      .sort({ createdAt: -1 })
      .limit(5);

    // Get status breakdown
    const statusBreakdown = await Candidate.aggregate([
      { $match: { submittedBy: partner._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    // Get available jobs count
    const availableJobsCount = await Job.countDocuments({
      status: "ACTIVE",
      eligiblePlans: partner.subscription?.plan || "FREE",
    });

    // Calculate profile completion
    const profileCompletion = partner.profileCompletion;
    const completedSections =
      Object.values(profileCompletion).filter(Boolean).length;
    const totalSections = Object.keys(profileCompletion).length;
    const completionPercentage = Math.round(
      (completedSections / totalSections) * 100,
    );

    const payoutReady =
      partner.profileCompletion.financeDetails &&
      partner.profileCompletion.payoutPreferences;

    res.json({
      success: true,
      data: {
        partner: {
          name: `${partner.firstName} ${partner.lastName}`,
          firmName: partner.firmName,
          verificationStatus: partner.verificationStatus,
        },
        metrics: partner.metrics,
        subscription: partner.subscription,
        profileCompletion: {
          ...profileCompletion,
          percentage: completionPercentage,
        },
        payoutReady,
        recentSubmissions,
        statusBreakdown,
        availableJobsCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard",
      error: error.message,
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
        message: "Profile not found",
      });
    }

    // Get placed candidates with payout info
    const placements = await Candidate.find({
      submittedBy: partner._id,
      status: "JOINED",
    })
      .populate("job", "title commission")
      .populate("company", "companyName")
      .sort({ "joining.confirmedAt": -1 });

    // Calculate totals
    const totalEarnings = placements.reduce(
      (sum, p) => sum + (p.payout?.commissionAmount || 0),
      0,
    );
    const paidEarnings = placements
      .filter((p) => p.payout?.status === "PAID")
      .reduce((sum, p) => sum + (p.payout?.commissionAmount || 0), 0);
    const pendingEarnings = totalEarnings - paidEarnings;

    res.json({
      success: true,
      data: {
        summary: {
          totalEarnings,
          paidEarnings,
          pendingEarnings,
          totalPlacements: placements.length,
        },
        placements,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch earnings",
      error: error.message,
    });
  }
};