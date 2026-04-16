// backend/controllers/companyController.js
const Company = require("../models/Company");
const User = require("../models/User");
const Job = require("../models/Job");
const Candidate = require("../models/Candidate");
const candidateLifecycleService = require("../services/candidateLifecycleService");
const StatusMachine = require("../utils/statusMachine");

// ==================== HELPER FUNCTIONS ====================

/**
 * ✅ FIX #4: Validate email format
 */
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * ✅ FIX #10: Sanitize pagination to prevent abuse
 */
const sanitizePagination = (page, limit) => ({
  page: Math.max(1, Math.min(1000, parseInt(page) || 1)),
  limit: Math.max(1, Math.min(100, parseInt(limit) || 20))
});

// ==================== 1. PRIMARY ACCOUNT (Decision Maker) ====================

// @desc    Update Primary Account / Basic Info
// @route   PUT /api/companies/profile/basic-info
exports.updateBasicInfo = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const {
      firstName,
      lastName,
      designation,
      department,
      linkedinProfile,
      city,
      state,
    } = req.body;

    // ✅ Combine firstName + lastName if provided
    if (firstName && lastName) {
      company.decisionMakerName = `${firstName} ${lastName}`;
    } else if (firstName || lastName) {
      const currentName = company.decisionMakerName.split(" ");
      if (firstName) {
        currentName[0] = firstName;
      }
      if (lastName) {
        currentName[1] = lastName;
      }
      company.decisionMakerName = currentName.join(" ");
    }

    if (designation) company.designation = designation;
    if (department) company.department = department;
    if (linkedinProfile) company.linkedinProfile = linkedinProfile;
    if (city) company.city = city;
    if (state) company.state = state;

    company.profileCompletion.basicInfo = true;
    await company.save();

    // ✅ Return firstName and lastName separately for frontend
    const [returnFirstName, ...lastNameParts] =
      company.decisionMakerName.split(" ");
    const returnLastName = lastNameParts.join(" ");

    res.json({
      success: true,
      message: "Basic info updated successfully",
      data: {
        firstName: returnFirstName,
        lastName: returnLastName,
        decisionMakerName: company.decisionMakerName,
        designation: company.designation,
        department: company.department,
        linkedinProfile: company.linkedinProfile,
        city: company.city,
        state: company.state,
      },
    });
  } catch (error) {
    console.error('[COMPANY] Update basic info error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

// @desc    Update Company KYC
// @route   PUT /api/companies/profile/kyc
exports.updateKYC = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
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
      employeeCount,
    } = req.body;

    // Handle operating address "same as registered" logic
    let finalOperatingAddress = operatingAddress;
    if (operatingAddress?.sameAsRegistered && registeredAddress) {
      finalOperatingAddress = {
        ...registeredAddress,
        sameAsRegistered: true,
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
      employeeCount,
    };

    company.profileCompletion.kyc = true;
    await company.save();

    res.json({
      success: true,
      message: "KYC updated successfully",
      data: company.kyc,
    });
  } catch (error) {
    console.error('[COMPANY] Update KYC error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Company not found",
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
      urgencyLevel,
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
      urgencyLevel,
    };

    company.profileCompletion.hiringPreferences = true;
    await company.save();

    res.json({
      success: true,
      message: "Hiring preferences updated successfully",
      data: company.hiringPreferences,
    });
  } catch (error) {
    console.error('[COMPANY] Update hiring preferences error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Company not found",
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
      preferredPaymentMethod,
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
      preferredPaymentMethod,
    };

    company.profileCompletion.billing = true;
    await company.save();

    res.json({
      success: true,
      message: "Billing updated successfully",
      data: company.billing,
    });
  } catch (error) {
    console.error('[COMPANY] Update billing error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
    });
  }
};

// @desc    Update Team Access
// @route   PUT /api/companies/profile/team-access
exports.updateTeamAccess = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    if (company.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Company must be verified to add team members",
      });
    }

    const { isTeamEnabled, teamMembers } = req.body;

    company.teamAccess = {
      isTeamEnabled: isTeamEnabled || false,
      teamMembers: teamMembers || [],
    };

    await company.save();

    res.json({
      success: true,
      message: "Team access updated successfully",
      data: company.teamAccess,
    });
  } catch (error) {
    console.error('[COMPANY] Update team access error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Company not found",
      });
    }

    if (company.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Company must be verified to add team members",
      });
    }

    const { name, email, mobile, role } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and role are required",
      });
    }

    // ✅ FIX #4: Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const existingMember = company.teamAccess.teamMembers.find(
      (m) => m.email === email,
    );

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: "Team member with this email already exists",
      });
    }

    company.teamAccess.isTeamEnabled = true;
    company.teamAccess.teamMembers.push({
      name,
      email,
      mobile,
      role,
      addedAt: new Date(),
      isActive: true,
    });

    await company.save();

    res.json({
      success: true,
      message: "Team member added successfully",
      data: company.teamAccess,
    });
  } catch (error) {
    console.error('[COMPANY] Add team member error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to add team member",
      error: error.message,
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
        message: "Company not found",
      });
    }

    const { memberId } = req.params;

    company.teamAccess.teamMembers = company.teamAccess.teamMembers.filter(
      (m) => m._id.toString() !== memberId,
    );

    await company.save();

    res.json({
      success: true,
      message: "Team member removed successfully",
      data: company.teamAccess,
    });
  } catch (error) {
    console.error('[COMPANY] Remove team member error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to remove team member",
      error: error.message,
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
        message: "Company not found",
      });
    }

    const {
      termsAccepted,
      privacyPolicyAccepted,
      dataProcessingAgreementAccepted,
      dataStorageConsent,
      vendorSharingConsent,
      communicationConsent,
    } = req.body;

    const ipAddress =
      req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const timestamp = new Date();

    company.legalConsents = {
      termsAccepted,
      termsAcceptedAt: termsAccepted
        ? timestamp
        : company.legalConsents?.termsAcceptedAt,
      termsAcceptedIp: termsAccepted
        ? ipAddress
        : company.legalConsents?.termsAcceptedIp,

      privacyPolicyAccepted,
      privacyPolicyAcceptedAt: privacyPolicyAccepted
        ? timestamp
        : company.legalConsents?.privacyPolicyAcceptedAt,
      privacyPolicyAcceptedIp: privacyPolicyAccepted
        ? ipAddress
        : company.legalConsents?.privacyPolicyAcceptedIp,

      dataProcessingAgreementAccepted,
      dataProcessingAgreementAcceptedAt: dataProcessingAgreementAccepted
        ? timestamp
        : company.legalConsents?.dataProcessingAgreementAcceptedAt,
      dataProcessingAgreementAcceptedIp: dataProcessingAgreementAccepted
        ? ipAddress
        : company.legalConsents?.dataProcessingAgreementAcceptedIp,

      dataStorageConsent,
      dataStorageConsentAt: dataStorageConsent
        ? timestamp
        : company.legalConsents?.dataStorageConsentAt,
      dataStorageConsentIp: dataStorageConsent
        ? ipAddress
        : company.legalConsents?.dataStorageConsentIp,

      vendorSharingConsent,
      vendorSharingConsentAt: vendorSharingConsent
        ? timestamp
        : company.legalConsents?.vendorSharingConsentAt,
      vendorSharingConsentIp: vendorSharingConsent
        ? ipAddress
        : company.legalConsents?.vendorSharingConsentIp,

      communicationConsent:
        communicationConsent || company.legalConsents?.communicationConsent,
      communicationConsentAt: communicationConsent
        ? timestamp
        : company.legalConsents?.communicationConsentAt,
      communicationConsentIp: communicationConsent
        ? ipAddress
        : company.legalConsents?.communicationConsentIp,
    };

    company.profileCompletion.legalConsents = true;
    await company.save();

    res.json({
      success: true,
      message: "Legal consents updated successfully",
      data: company.legalConsents,
    });
  } catch (error) {
    console.error('[COMPANY] Update legal consents error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Company not found",
      });
    }

    const {
      gstCertificate,
      panCard,
      additionalDocuments,
    } = req.body;

    if (gstCertificate) company.documents.gstCertificate = gstCertificate;
    if (panCard) company.documents.panCard = panCard;

    if (additionalDocuments && Array.isArray(additionalDocuments)) {
      if (!company.documents.additionalDocuments) {
        company.documents.additionalDocuments = [];
      }
      additionalDocuments.forEach(doc => {
        company.documents.additionalDocuments.push({
          documentType: doc.documentType,
          documentUrl: doc.documentUrl,
          documentName: doc.documentName,
          uploadedAt: new Date()
        });
      });
    }

    // Mark complete only if mandatory docs uploaded
    company.profileCompletion.documents = !!(
      company.documents.gstCertificate &&
      company.documents.panCard
    );

    await company.save();

    res.json({
      success: true,
      message: "Documents uploaded successfully",
      data: company.documents,
    });
  } catch (error) {
    console.error('[COMPANY] Upload documents error:', error);
    res.status(500).json({
      success: false,
      message: "Upload failed",
      error: error.message,
    });
  }
};

// @desc    Get Company Profile
// @route   GET /api/companies/profile
exports.getProfile = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id }).populate(
      "user",
      "email mobile status",
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const [firstName, ...lastNameParts] = company.decisionMakerName.split(" ");
    const lastName = lastNameParts.join(" ");

    const responseData = {
      ...company.toObject(),
      firstName,
      lastName,
    };

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('[COMPANY] Get profile error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message,
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
        message: "Profile not found",
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
          completion.legalConsents,
      },
    });
  } catch (error) {
    console.error('[COMPANY] Get profile completion error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch completion status",
      error: error.message,
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
        message: "Company not found",
      });
    }

    const { basicInfo, kyc, hiringPreferences, billing, legalConsents } =
      company.profileCompletion;

    if (
      !basicInfo ||
      !kyc ||
      !hiringPreferences ||
      !billing ||
      !legalConsents
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required sections",
        data: company.profileCompletion,
      });
    }

    company.verificationStatus = "UNDER_REVIEW";
    user.status = "UNDER_VERIFICATION";

    await company.save();
    await user.save();

    res.json({
      success: true,
      message: "Profile submitted for verification",
      data: {
        verificationStatus: company.verificationStatus,
        userStatus: user.status,
      },
    });
  } catch (error) {
    console.error('[COMPANY] Submit profile error:', error);
    res.status(500).json({
      success: false,
      message: "Submission failed",
      error: error.message,
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
        message: "Company not found",
      });
    }

    const jobStats = await Job.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    // ✅ NEW: Approval status breakdown
    const approvalStats = await Job.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: "$approvalStatus", count: { $sum: 1 } } }
    ]);

    // ✅ NEW: Get rejected jobs for alerts
    const rejectedJobs = await Job.find({
      company: company._id,
      approvalStatus: 'REJECTED'
    })
      .select('title rejectionReason rejectedAt')
      .sort({ rejectedAt: -1 })
      .limit(5); // Show top 5 most recent

    // ✅ NEW: Get pending approval jobs
    const pendingApprovalJobs = await Job.find({
      company: company._id,
      approvalStatus: 'PENDING_APPROVAL'
    })
      .select('title createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    const recentCandidates = await Candidate.find({ company: company._id })
      .populate("job", "title")
      .populate("submittedBy", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(10);

    const hiringFunnel = await Candidate.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const activeJobs = await Job.find({
      company: company._id,
      status: "ACTIVE",
    }).limit(5);

    const profileCompletion = company.profileCompletion;
    const completedSections =
      Object.values(profileCompletion).filter(Boolean).length;
    const totalSections = Object.keys(profileCompletion).length;
    const completionPercentage = Math.round(
      (completedSections / totalSections) * 100,
    );

    res.json({
      success: true,
      data: {
        company: {
          name: company.companyName,
          verificationStatus: company.verificationStatus,
          profileCompletion: {
            ...profileCompletion,
            percentage: completionPercentage,
          },
        },
        metrics: company.metrics,
        jobStats,

        // ✅ NEW: Approval stats
        approvalStats: approvalStats.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {}),

        // ✅ NEW: Alerts section
        alerts: {
          rejectedJobs: {
            count: rejectedJobs.length,
            jobs: rejectedJobs.map(job => ({
              id: job._id,
              title: job.title,
              reason: job.rejectionReason,
              rejectedAt: job.rejectedAt,
              daysAgo: Math.floor((Date.now() - new Date(job.rejectedAt)) / (1000 * 60 * 60 * 24))
            }))
          },
          pendingApproval: {
            count: pendingApprovalJobs.length,
            jobs: pendingApprovalJobs.map(job => ({
              id: job._id,
              title: job.title,
              submittedAt: job.createdAt,
              daysAgo: Math.floor((Date.now() - new Date(job.createdAt)) / (1000 * 60 * 60 * 24))
            }))
          }
        },

        recentCandidates,
        hiringFunnel,
        activeJobs,
      },
    });
  } catch (error) {
    console.error('[COMPANY] Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard",
      error: error.message,
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
        message: "Company not found",
      });
    }

    // ✅ Ensure eligiblePlans has a default
    const eligiblePlans =
      req.body.eligiblePlans && req.body.eligiblePlans.length > 0
        ? req.body.eligiblePlans
        : ["FREE", "GROWTH", "PROFESSIONAL", "PREMIUM"];

    const jobData = {
      ...req.body,
      company: company._id,
      postedBy: req.user._id,
      status: "DRAFT",
      approvalStatus: "DRAFT",
      eligiblePlans,
    };

    const job = await Job.create(jobData);

    company.metrics.totalJobsPosted += 1;
    await company.save();

    console.log(
      `[JOB] Created as DRAFT: "${job.title}" — Requires admin approval before becoming visible`,
    );

    res.status(201).json({
      success: true,
      message: "Job created as draft. Submit for approval to make it visible to partners.",
      data: job,
    });
  } catch (error) {
    console.error('[COMPANY] Create job error:', error);
    res.status(500).json({
      success: false,
      message: "Job creation failed",
      error: error.message,
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
        message: "Company not found",
      });
    }

    // ✅ FIX #10: Sanitize pagination
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { status, approvalStatus } = req.query; // ✅ Added approvalStatus

    const query = { company: company._id };
    if (status) query.status = status;
    if (approvalStatus) query.approvalStatus = approvalStatus; // ✅ NEW LINE

    const skip = (page - 1) * limit;

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        },
      },
    });
  } catch (error) {
    console.error('[COMPANY] Get jobs error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch jobs",
      error: error.message,
    });
  }
};

// @desc    Get Rejected Job Posts
// @route   GET /api/companies/jobs/rejected
exports.getRejectedJobs = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);

    const query = {
      company: company._id,
      approvalStatus: 'REJECTED'
    };

    const skip = (page - 1) * limit;

    const jobs = await Job.find(query)
      .select('title category employmentType experienceLevel location vacancies salary rejectionReason rejectedAt createdAt')
      .sort({ rejectedAt: -1 }) // Most recently rejected first
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      data: {
        jobs: jobs.map(job => ({
          _id: job._id,
          title: job.title,
          category: job.category,
          employmentType: job.employmentType,
          experienceLevel: job.experienceLevel,
          location: job.location,
          vacancies: job.vacancies,
          salary: job.salary,
          rejectionReason: job.rejectionReason,
          rejectedAt: job.rejectedAt,
          submittedAt: job.createdAt,
          canEdit: true,
          canResubmit: true,
          daysAgo: Math.floor((Date.now() - new Date(job.rejectedAt)) / (1000 * 60 * 60 * 24))
        })),
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        },
        message: total === 0
          ? '✅ No rejected jobs! All your submissions are either approved or pending review.'
          : `You have ${total} rejected job post${total > 1 ? 's' : ''} that need${total === 1 ? 's' : ''} revision.`
      }
    });
  } catch (error) {
    console.error('[COMPANY] Get rejected jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rejected jobs',
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
        message: "Job not found",
      });
    }

    res.json({
      success: true,
      data: job,
    });
  } catch (error) {
    console.error('[COMPANY] Get job error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch job",
      error: error.message,
    });
  }
};

// @desc    Update Job
// @route   PUT /api/companies/jobs/:id
exports.updateJob = async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    res.json({
      success: true,
      message: "Job updated successfully",
      data: job,
    });
  } catch (error) {
    console.error('[COMPANY] Update job error:', error);
    res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message,
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
        message: "Job not found",
      });
    }

    job.status = "CLOSED";
    await job.save();

    const company = await Company.findById(job.company);
    if (company) {
      company.metrics.activeJobs = Math.max(0, company.metrics.activeJobs - 1);
      await company.save();
    }

    res.json({
      success: true,
      message: "Job closed successfully",
    });
  } catch (error) {
    console.error('[COMPANY] Delete job error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to close job",
      error: error.message,
    });
  }
};

// @desc    Get Candidates for a Job
// @route   GET /api/companies/jobs/:jobId/candidates
exports.getJobCandidates = async (req, res) => {
  try {
    // ✅ FIX #10: Sanitize pagination
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { status } = req.query;

    const query = { job: req.params.jobId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const candidates = await Candidate.find(query)
      .populate("submittedBy", "firstName lastName firmName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Candidate.countDocuments(query);

    res.json({
      success: true,
      data: {
        candidates,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        },
      },
    });
  } catch (error) {
    console.error('[COMPANY] Get job candidates error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch candidates",
      error: error.message,
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
        message: "Company not found",
      });
    }

    // ✅ FIX #10: Sanitize pagination
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { status } = req.query;

    const query = { company: company._id };
    if (status) query.status = status;

    const skip = (page - 1) * limit;

    const candidates = await Candidate.find(query)
      .populate("submittedBy", "firstName lastName firmName")
      .populate("job", "title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Candidate.countDocuments(query);

    res.json({
      success: true,
      data: {
        candidates,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        },
      },
    });
  } catch (error) {
    console.error('[COMPANY] Get all candidates error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch candidates",
      error: error.message,
    });
  }
};

// @desc    Get Single Candidate
// @route   GET /api/companies/candidates/:id
exports.getCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
      .populate("submittedBy", "firstName lastName firmName email")
      .populate("job", "title commission")
      .populate({
        path: "company",
        select: "companyName user",
      });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    // ✅ Authorization check
    if (req.user.role === "company") {
      const company = await Company.findOne({ user: req.user._id });

      if (
        !company ||
        candidate.company._id.toString() !== company._id.toString()
      ) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to view this candidate",
        });
      }
    } else if (!["admin", "sub_admin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this candidate",
      });
    }

    const responseData = candidate.toObject();
    if (responseData.company?.user) {
      delete responseData.company.user;
    }

    res.json({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('[COMPANY] Get candidate error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch candidate",
      error: error.message,
    });
  }
};

// @desc    Update Candidate Status
// @route   PUT /api/companies/candidates/:id/status
exports.updateCandidateStatus = async (req, res) => {
  try {
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Please provide status",
      });
    }

    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res
        .status(404)
        .json({ success: false, message: "Company not found" });
    }

    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
      return res
        .status(404)
        .json({ success: false, message: "Candidate not found" });
    }

    if (candidate.company.toString() !== company._id.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    // ✅ VALIDATE: If marking as JOINED, offer must exist
    if (status === "JOINED") {
      if (!candidate.offer || !candidate.offer.salary) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot mark as JOINED without an offer. Please make an offer first.",
          hint: "Use POST /api/companies/candidates/:id/offer to set offer details",
          data: {
            hasOffer: !!candidate.offer,
            hasSalary: !!candidate.offer?.salary,
            currentOffer: candidate.offer || null,
          },
        });
      }

      if (!candidate.offer.joiningDate) {
        return res.status(400).json({
          success: false,
          message:
            "Please set a joining date in the offer before marking as JOINED",
          data: { currentOffer: candidate.offer },
        });
      }
    }

    // ✅ VALIDATE: If marking as OFFERED, salary must be provided
    if (status === "OFFERED") {
      if (!candidate.offer || !candidate.offer.salary) {
        return res.status(400).json({
          success: false,
          message:
            "Cannot mark as OFFERED without offer details. Use the offer endpoint first.",
          hint: "Use POST /api/companies/candidates/:id/offer with salary and joiningDate",
        });
      }
    }

    // ✅ Use lifecycle service
    try {
      const updatedCandidate = await candidateLifecycleService.updateStatus(
        req.params.id,
        status,
        req.user._id,
        "company",
        notes,
      );

      const responseCandidate = await Candidate.findById(updatedCandidate._id)
        .populate("submittedBy", "firstName lastName firmName")
        .populate("job", "title commission")
        .populate("company", "companyName");

      const nextActions = candidateLifecycleService.getNextActions(
        status,
        "company",
      );

      res.json({
        success: true,
        message: `Status updated to ${StatusMachine.getStatusLabel(status)}`,
        data: {
          candidate: responseCandidate,
          nextActions: nextActions.map((s) => ({
            value: s,
            label: StatusMachine.getStatusLabel(s),
          })),
        },
      });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          success: false,
          message: error.message,
          data: {
            currentStatus: {
              value: candidate.status,
              label: StatusMachine.getStatusLabel(candidate.status),
            },
            allowedTransitions: (error.allowedTransitions || []).map((s) => ({
              value: s,
              label: StatusMachine.getStatusLabel(s),
            })),
            hint: error.hint || null,
          },
        });
      }
      throw error;
    }
  } catch (error) {
    console.error('[COMPANY] Update candidate status error:', error);
    res.status(500).json({
      success: false,
      message: "Status update failed",
      error: error.message,
    });
  }
};

// @desc    Schedule Interview
// @route   POST /api/companies/candidates/:id/interviews
exports.scheduleInterview = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id).populate({
      path: "company",
      select: "user",
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const { type, scheduledAt, interviewerName, interviewerEmail, meetingLink } = req.body;

    // ✅ FIX #4: Validate interviewer email if provided
    if (interviewerEmail && !isValidEmail(interviewerEmail)) {
      return res.status(400).json({
        success: false,
        message: "Invalid interviewer email format",
      });
    }

    const interview = {
      round: candidate.interviews.length + 1,
      type,
      scheduledAt,
      interviewerName,
      interviewerEmail,
      meetingLink,
      result: "PENDING",
    };

    candidate.interviews.push(interview);
    candidate.status = "INTERVIEW_SCHEDULED";
    candidate.statusHistory.push({
      status: "INTERVIEW_SCHEDULED",
      changedBy: req.user._id,
      notes: `Interview Round ${interview.round} scheduled for ${new Date(interview.scheduledAt).toLocaleString()}`,
    });

    await candidate.save();

    res.json({
      success: true,
      message: "Interview scheduled successfully",
      data: candidate,
    });
  } catch (error) {
    console.error('[COMPANY] Schedule interview error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to schedule interview",
      error: error.message,
    });
  }
};

// @desc    Update Interview Feedback
// @route   PUT /api/companies/candidates/:id/interviews/:interviewId
exports.updateInterviewFeedback = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id).populate({
      path: "company",
      select: "user",
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const interview = candidate.interviews.id(req.params.interviewId);
    if (!interview) {
      return res.status(404).json({
        success: false,
        message: "Interview not found",
      });
    }

    interview.feedback = req.body.feedback;
    interview.rating = req.body.rating;
    interview.result = req.body.result;

    if (req.body.result === "PASSED" || req.body.result === "FAILED") {
      candidate.status = "INTERVIEWED";
      candidate.statusHistory.push({
        status: "INTERVIEWED",
        changedBy: req.user._id,
        notes: `Interview Round ${interview.round} completed - ${req.body.result}`,
      });
    }

    await candidate.save();

    res.json({
      success: true,
      message: "Interview feedback updated",
      data: candidate,
    });
  } catch (error) {
    console.error('[COMPANY] Update interview feedback error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update feedback",
      error: error.message,
    });
  }
};

// @desc    Make Offer
// @route   POST /api/companies/candidates/:id/offer
exports.makeOffer = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id).populate({
      path: "company",
      select: "user",
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    candidate.offer = {
      salary: req.body.salary,
      joiningDate: req.body.joiningDate,
      offerLetterUrl: req.body.offerLetterUrl,
      offeredAt: new Date(),
      response: "PENDING",
    };
    candidate.status = "OFFERED";
    candidate.statusHistory.push({
      status: "OFFERED",
      changedBy: req.user._id,
      notes: `Offer made with salary ₹${req.body.salary}`,
    });

    await candidate.save();

    res.json({
      success: true,
      message: "Offer made successfully",
      data: candidate,
    });
  } catch (error) {
    console.error('[COMPANY] Make offer error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to make offer",
      error: error.message,
    });
  }
};

// @desc    Update Offer Response
// @route   PUT /api/companies/candidates/:id/offer
exports.updateOfferResponse = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id).populate({
      path: "company",
      select: "user",
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    candidate.offer.response = req.body.response;
    candidate.offer.respondedAt = new Date();
    candidate.offer.negotiationNotes = req.body.negotiationNotes;

    if (req.body.response === "ACCEPTED") {
      candidate.status = "OFFER_ACCEPTED";
    } else if (req.body.response === "DECLINED") {
      candidate.status = "OFFER_DECLINED";
    }

    candidate.statusHistory.push({
      status: candidate.status,
      changedBy: req.user._id,
      notes: `Offer ${req.body.response.toLowerCase()}`,
    });

    await candidate.save();

    res.json({
      success: true,
      message: "Offer response updated",
      data: candidate,
    });
  } catch (error) {
    console.error('[COMPANY] Update offer response error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to update offer response",
      error: error.message,
    });
  }
};

// @desc    Add Note to Candidate
// @route   POST /api/companies/candidates/:id/notes
exports.addNote = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id).populate({
      path: "company",
      select: "user",
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Candidate not found",
      });
    }

    if (candidate.company.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    candidate.notes.push({
      content: req.body.content,
      addedBy: req.user._id,
      isInternal: req.body.isInternal !== false,
    });

    await candidate.save();

    res.json({
      success: true,
      message: "Note added successfully",
      data: candidate.notes,
    });
  } catch (error) {
    console.error('[COMPANY] Add note error:', error);
    res.status(500).json({
      success: false,
      message: "Failed to add note",
      error: error.message,
    });
  }
};

// ==================== JOB APPROVAL WORKFLOW ====================

// @desc    Submit job for admin approval
// @route   POST /api/companies/jobs/:id/submit-for-approval
exports.submitJobForApproval = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Authorization check
    if (job.company.toString() !== company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to submit this job'
      });
    }

    // Validation: Can only submit DRAFT or REJECTED jobs
    if (!['DRAFT', 'REJECTED'].includes(job.approvalStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit job with status: ${job.approvalStatus}`,
        currentStatus: job.approvalStatus
      });
    }

    // Validate required fields are complete
    const requiredFields = ['title', 'description', 'category', 'employmentType', 'experienceLevel', 'location.city', 'location.state'];
    const missingFields = [];

    requiredFields.forEach(field => {
      const keys = field.split('.');
      let value = job;
      for (const key of keys) {
        value = value?.[key];
      }
      if (!value) missingFields.push(field);
    });

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required fields before submitting',
        missingFields
      });
    }

    // Update job status
    job.approvalStatus = 'PENDING_APPROVAL';
    job.status = 'PENDING_APPROVAL';
    job.addToHistory('SUBMITTED', req.user._id, {}, 'Job submitted for approval');
    await job.save();

    // ✅ FIX #12: Fire and forget for notifications (non-blocking)
    const notifyAdmins = async () => {
      try {
        // ✅ FIX #2: Lazy load to avoid circular dependencies
        const notificationEngine = require('../services/notificationEngine');
        const adminUsers = await User.find({ role: 'admin' });

        for (const admin of adminUsers) {
          await notificationEngine.send({
            recipientId: admin._id,
            type: 'JOB_SUBMITTED_FOR_APPROVAL',
            title: `New job requires approval: "${job.title}"`,
            message: `${company.companyName} has submitted a new job posting "${job.title}" for approval.`,
            data: {
              entityType: 'Job',
              entityId: job._id,
              actionUrl: `/admin/jobs/pending/${job._id}`,
              metadata: {
                jobTitle: job.title,
                companyName: company.companyName,
                category: job.category,
                location: `${job.location.city}, ${job.location.state}`,
                vacancies: job.vacancies
              }
            },
            channels: { inApp: true, email: true },
            priority: 'high'
          });
        }
      } catch (notifError) {
        console.error('[NOTIFICATION] Failed to notify admins:', notifError.message);
      }
    };

    notifyAdmins(); // Don't await - fire and forget

    res.json({
      success: true,
      message: 'Job submitted for admin approval successfully',
      data: {
        jobId: job._id,
        approvalStatus: 'PENDING_APPROVAL',
        submittedAt: new Date(),
        estimatedReviewTime: '24-48 hours'
      }
    });
  } catch (error) {
    console.error('[COMPANY] Submit job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit job for approval',
      error: error.message
    });
  }
};

// @desc    Request edit on active job
// @route   POST /api/companies/jobs/:id/request-edit
exports.requestJobEdit = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');
    const company = await Company.findOne({ user: req.user._id });
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Authorization check
    if (job.company.toString() !== company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Can only request edit on ACTIVE jobs
    if (job.approvalStatus !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot request edit on job with status: ${job.approvalStatus}. Only ACTIVE jobs can be edited.`,
        hint: job.approvalStatus === 'DRAFT' ? 'You can edit this job directly.' : 'Wait for current approval process to complete.'
      });
    }

    // Check for existing pending edit request
    const existingRequest = await JobEditRequest.findOne({
      job: job._id,
      status: 'PENDING'
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending edit request for this job',
        data: {
          editRequestId: existingRequest._id,
          requestedAt: existingRequest.createdAt,
          status: existingRequest.status
        }
      });
    }

    const { requestedChanges, changeDescription, priority } = req.body;

    // Validate requested changes
    if (!requestedChanges || typeof requestedChanges !== 'object' || Object.keys(requestedChanges).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please specify what fields you want to change',
        example: {
          requestedChanges: {
            salary: { old: { min: 1000000, max: 1500000 }, new: { min: 1200000, max: 1800000 } },
            vacancies: { old: 2, new: 5 }
          }
        }
      });
    }

    // Validate change description
    if (!changeDescription || changeDescription.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please explain why you need this edit (minimum 10 characters)'
      });
    }

    // Validate that requested fields exist and values are different
    const validatedChanges = {};
    const invalidFields = [];

    for (const [field, change] of Object.entries(requestedChanges)) {
      if (!change.old || !change.new) {
        invalidFields.push(`${field}: Must provide both 'old' and 'new' values`);
        continue;
      }

      // Check if field exists in job
      const currentValue = field.split('.').reduce((obj, key) => obj?.[key], job);

      if (currentValue === undefined) {
        invalidFields.push(`${field}: Field does not exist in job`);
        continue;
      }

      // Check if old value matches current
      if (JSON.stringify(currentValue) !== JSON.stringify(change.old)) {
        invalidFields.push(`${field}: Old value doesn't match current value`);
        continue;
      }

      // Check if new value is different
      if (JSON.stringify(change.old) === JSON.stringify(change.new)) {
        invalidFields.push(`${field}: New value is same as old value`);
        continue;
      }

      validatedChanges[field] = change;
    }

    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid changes requested',
        errors: invalidFields
      });
    }

    // Create edit request
    const editRequest = await JobEditRequest.create({
      job: job._id,
      company: company._id,
      requestedBy: req.user._id,
      requestedChanges: validatedChanges,
      changeDescription: changeDescription.trim(),
      priority: priority || 'MEDIUM',
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    // Update job
    job.approvalStatus = 'EDIT_REQUESTED';
    job.editRequestCount += 1;
    job.lastEditRequestAt = new Date();
    job.addToHistory('EDIT_REQUESTED', req.user._id, validatedChanges, changeDescription);
    await job.save();

    // ✅ FIX #12: Fire and forget for notifications (non-blocking)
    const notifyAdmins = async () => {
      try {
        // ✅ FIX #2: Lazy load
        const notificationEngine = require('../services/notificationEngine');
        const adminUsers = await User.find({ role: 'admin' });
        const priorityLabel = { LOW: '🔵', MEDIUM: '🟡', HIGH: '🟠', URGENT: '🔴' }[priority || 'MEDIUM'];

        for (const admin of adminUsers) {
          await notificationEngine.send({
            recipientId: admin._id,
            type: 'JOB_EDIT_REQUESTED',
            title: `${priorityLabel} Edit request for "${job.title}"`,
            message: `${company.companyName} requested to edit "${job.title}". Priority: ${priority || 'MEDIUM'}. Changes: ${Object.keys(validatedChanges).join(', ')}`,
            data: {
              entityType: 'JobEditRequest',
              entityId: editRequest._id,
              actionUrl: `/admin/edit-requests/${editRequest._id}`,
              metadata: {
                jobId: job._id,
                jobTitle: job.title,
                companyName: company.companyName,
                priority: priority || 'MEDIUM',
                changedFields: Object.keys(validatedChanges),
                changeCount: Object.keys(validatedChanges).length
              }
            },
            channels: { inApp: true, email: priority === 'URGENT' },
            priority: priority === 'URGENT' ? 'urgent' : 'high'
          });
        }
      } catch (notifError) {
        console.error('[NOTIFICATION] Failed to notify admins:', notifError.message);
      }
    };

    notifyAdmins(); // Don't await - fire and forget

    res.status(201).json({
      success: true,
      message: 'Edit request submitted successfully',
      data: {
        editRequestId: editRequest._id,
        status: 'PENDING',
        changedFields: Object.keys(validatedChanges),
        estimatedReviewTime: priority === 'URGENT' ? '12-24 hours' : '24-48 hours',
        note: 'Your job will remain visible to partners while edit request is being reviewed'
      }
    });
  } catch (error) {
    console.error('[COMPANY] Request edit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create edit request',
      error: error.message
    });
  }
};

// @desc    Get edit requests for a job
// @route   GET /api/companies/jobs/:id/edit-requests
exports.getJobEditRequests = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');
    const company = await Company.findOne({ user: req.user._id });
    const job = await Job.findById(req.params.id);

    if (!job || job.company.toString() !== company._id.toString()) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const editRequests = await JobEditRequest.find({ job: job._id })
      .populate('reviewedBy', 'email')
      .sort({ createdAt: -1 });

    const stats = {
      total: editRequests.length,
      pending: editRequests.filter(r => r.status === 'PENDING').length,
      approved: editRequests.filter(r => r.status === 'APPROVED').length,
      rejected: editRequests.filter(r => r.status === 'REJECTED').length,
      cancelled: editRequests.filter(r => r.status === 'CANCELLED').length
    };

    res.json({
      success: true,
      data: {
        editRequests,
        stats,
        job: {
          id: job._id,
          title: job.title,
          approvalStatus: job.approvalStatus,
          canRequestEdit: job.approvalStatus === 'ACTIVE' && stats.pending === 0
        }
      }
    });
  } catch (error) {
    console.error('[COMPANY] Get job edit requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch edit requests',
      error: error.message
    });
  }
};

// @desc    Cancel pending edit request
// @route   DELETE /api/companies/jobs/:id/edit-requests/:editRequestId
exports.cancelEditRequest = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');
    const company = await Company.findOne({ user: req.user._id });
    const job = await Job.findById(req.params.id);

    if (!job || job.company.toString() !== company._id.toString()) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const editRequest = await JobEditRequest.findById(req.params.editRequestId);

    if (!editRequest) {
      return res.status(404).json({
        success: false,
        message: 'Edit request not found'
      });
    }

    if (editRequest.job.toString() !== job._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Edit request does not belong to this job'
      });
    }

    if (editRequest.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel edit request with status: ${editRequest.status}`
      });
    }

    editRequest.status = 'CANCELLED';
    await editRequest.save();

    // Update job status back to ACTIVE if this was the only pending request
    const otherPending = await JobEditRequest.countDocuments({
      job: job._id,
      status: 'PENDING'
    });

    if (otherPending === 0 && job.approvalStatus === 'EDIT_REQUESTED') {
      job.approvalStatus = 'ACTIVE';
      await job.save();
    }

    res.json({
      success: true,
      message: 'Edit request cancelled successfully',
      data: {
        editRequestId: editRequest._id,
        jobStatus: job.approvalStatus
      }
    });
  } catch (error) {
    console.error('[COMPANY] Cancel edit request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel edit request',
      error: error.message
    });
  }
};
