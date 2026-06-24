// backend/controllers/companyController.js
const crypto = require('crypto');
const Company = require("../models/Company");
const User = require("../models/User");
const Job = require("../models/Job");
const Candidate = require("../models/Candidate");
const { parseJobPosition } = require("../services/jobPositionParser");
const candidateLifecycleService = require("../services/candidateLifecycleService");
const StatusMachine = require("../utils/statusMachine");
const InterviewSlot = require("../models/InterviewSlot");
const whatsappService = require("../services/whatsappService");
const {
  COMPANY_PERMISSIONS,
  COMPANY_ALL_PERMISSIONS,
  COMPANY_PERMISSION_GROUPS,
  COMPANY_SUB_ADMIN_BUNDLES
} = require('../utils/permissions');

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
// HELPER: Add status history entry
// ─────────────────────────────────────────────────────────────────────────────
const addStatusHistory = (candidate, status, userId, role, notes, metadata = {}) => {
  candidate.statusHistory.push({
    status,
    changedBy: userId,
    changedByRole: role,
    notes,
    metadata,
  });
  candidate.status = status;
};

// HELPER: Convert time string (e.g. "10:00 AM" or "01:30 PM") to minutes from start of day
const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;

  let [_, hours, minutes, modifier] = match;
  hours = parseInt(hours);
  minutes = parseInt(minutes);

  if (hours === 12) {
    hours = 0;
  }
  if (modifier.toUpperCase() === 'PM') {
    hours += 12;
  }
  return hours * 60 + minutes;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Verify company owns the candidate
// ─────────────────────────────────────────────────────────────────────────────
const verifyCompanyOwnership = async (candidateId, userId) => {
  const company = await Company.findOne({ user: userId });
  if (!company) throw { statusCode: 404, message: "Company not found" };

  const candidate = await Candidate.findById(candidateId);
  if (!candidate) throw { statusCode: 404, message: "Candidate not found" };

  if (candidate.company.toString() !== company._id.toString()) {
    throw { statusCode: 403, message: "Not authorized" };
  }

  return { company, candidate };
};

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
      email,
      mobile,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // If email is not verified, allow updating it
    if (email && !user.emailVerified) {
      const normalizedEmail = email.toLowerCase().trim();
      if (normalizedEmail !== user.email) {
        const emailExists = await User.findOne({ email: normalizedEmail });
        if (emailExists) {
          return res.status(400).json({
            success: false,
            message: "Email is already registered by another user",
          });
        }
        user.email = normalizedEmail;
      }
    }

    // If mobile/WhatsApp is not verified, allow updating it
    if (mobile && !user.mobileVerified) {
      const normalizedMobile = mobile.trim();
      if (normalizedMobile !== user.mobile) {
        const mobileExists = await User.findOne({ mobile: normalizedMobile });
        if (mobileExists) {
          return res.status(400).json({
            success: false,
            message: "Mobile/WhatsApp number is already registered by another user",
          });
        }
        user.mobile = normalizedMobile;
      }
    }

    await user.save();

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
      cookiePolicyAccepted,
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

      cookiePolicyAccepted,
      cookiePolicyAcceptedAt: cookiePolicyAccepted
        ? timestamp
        : company.legalConsents?.cookiePolicyAcceptedAt,
      cookiePolicyAcceptedIp: cookiePolicyAccepted
        ? ipAddress
        : company.legalConsents?.cookiePolicyAcceptedIp,

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
      incorporationCertificate,
      authorizedSignatoryProof,
      addressProof,
      msme,
      udyamCertificate,
      cinNumber,
      otherCompanyDocument,
    } = req.body;

    // Mandatory
    if (gstCertificate) company.documents.gstCertificate = gstCertificate;
    if (panCard) company.documents.panCard = panCard;

    // Optional
    if (incorporationCertificate) company.documents.incorporationCertificate = incorporationCertificate;
    if (authorizedSignatoryProof) company.documents.authorizedSignatoryProof = authorizedSignatoryProof;
    if (addressProof) company.documents.addressProof = addressProof;
    if (msme) company.documents.msme = msme;
    if (udyamCertificate) company.documents.udyamCertificate = udyamCertificate;
    if (cinNumber) company.documents.cinNumber = cinNumber;
    if (otherCompanyDocument) company.documents.otherCompanyDocument = otherCompanyDocument;

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
      "email mobile status emailVerified mobileVerified",
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
    const company = await Company.findOne({ user: req.user._id }).populate(
      'user',
      'emailVerified mobileVerified'
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const completion = company.profileCompletion ? (company.profileCompletion.toObject ? company.profileCompletion.toObject() : company.profileCompletion) : {};
    
    // Force basicInfo to false if email or mobile is not verified
    if (!company.user?.emailVerified || !company.user?.mobileVerified) {
      completion.basicInfo = false;
    }

    const completionKeys = Object.keys(completion).filter(k => !k.startsWith('$') && k !== '_id' && k !== 'id');
    const total = completionKeys.length;
    const completed = completionKeys.filter(k => !!completion[k]).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

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

    // Check email and mobile verification
    if (!user.emailVerified || !user.mobileVerified) {
      const missing = [];
      if (!user.emailVerified) missing.push("Email");
      if (!user.mobileVerified) missing.push("WhatsApp Number");
      return res.status(400).json({
        success: false,
        message: `Please verify your ${missing.join(" and ")} first to complete registration.`,
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
    const company = await Company.findOne({ user: req.user._id }).populate(
      'user',
      'emailVerified mobileVerified'
    );

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Auto-update expired active jobs of this company to ON_HOLD
    await Job.updateMany(
      {
        company: company._id,
        status: 'ACTIVE',
        applicationDeadline: { $lt: new Date() }
      },
      {
        $set: { status: 'ON_HOLD' }
      }
    );

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

    const HIDDEN_STATUSES = ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED'];

    const recentCandidates = await Candidate.find({ 
      company: company._id,
      status: { $nin: HIDDEN_STATUSES }
    })
      .populate("job", "title")
      .populate("submittedBy", "firstName lastName")
      .sort({ createdAt: -1 })
      .limit(10);

    const hiringFunnel = await Candidate.aggregate([
      { 
        $match: { 
          company: company._id,
          status: { $nin: HIDDEN_STATUSES }
        } 
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const activeJobs = await Job.find({
      company: company._id,
      status: "ACTIVE",
    }).limit(5);

    const profileCompletion = company.profileCompletion ? (company.profileCompletion.toObject ? company.profileCompletion.toObject() : company.profileCompletion) : {};
    
    // Force basicInfo to false if email or mobile is not verified
    if (!company.user?.emailVerified || !company.user?.mobileVerified) {
      profileCompletion.basicInfo = false;
    }

    const completionKeys = Object.keys(profileCompletion).filter(k => !k.startsWith('$') && k !== '_id' && k !== 'id');
    const totalSections = completionKeys.length;
    const completedSections = completionKeys.filter(k => !!profileCompletion[k]).length;
    const completionPercentage = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;

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

    // ✅ Enforce 30-day minimum deadline for new job posts
    if (req.body.applicationDeadline) {
      const deadline = new Date(req.body.applicationDeadline);
      const minDeadline = new Date();
      minDeadline.setDate(minDeadline.getDate() + 30);
      
      // Reset hours for fair date comparison
      minDeadline.setHours(0, 0, 0, 0);
      deadline.setHours(0, 0, 0, 0);

      if (deadline < minDeadline) {
        return res.status(400).json({
          success: false,
          message: "Application deadline must be at least 30 days from the current date."
        });
      }
    }

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

    // Trigger asynchronous JD parsing for JobPosition structure
    parseJobPosition(job).catch(err => {
      console.error(`[JD-PARSER] Asynchronous parsing error on job creation: ${err.message}`);
    });

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

    // Auto-update expired active jobs of this company to ON_HOLD
    await Job.updateMany(
      {
        company: company._id,
        status: 'ACTIVE',
        applicationDeadline: { $lt: new Date() }
      },
      {
        $set: { status: 'ON_HOLD' }
      }
    );

    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { status, approvalStatus } = req.query;

    const query = { company: company._id };
    if (status) query.status = status;
    if (approvalStatus) query.approvalStatus = approvalStatus;

    const skip = (page - 1) * limit;

    const jobs = await Job.find(query)
      .populate(
        'company',
        'companyName kyc.industry kyc.logo kyc.companyType kyc.employeeCount city state verificationStatus'
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments(query);

    // ✅ Enrich each job with safe company snapshot
    const enrichedJobs = jobs.map(job => {
      const jobObj = job.toObject();
      const comp = job.company;

      return {
        ...jobObj,
        companyDetails: comp
          ? {
            companyName: comp.companyName,
            industry: comp.kyc?.industry || null,
            logo: comp.kyc?.logo || null,
            companyType: comp.kyc?.companyType || null,
            employeeCount: comp.kyc?.employeeCount || null,
            city: comp.city || null,
            state: comp.state || null,
            verificationStatus: comp.verificationStatus || null
          }
          : null
      };
    });

    res.json({
      success: true,
      data: {
        jobs: enrichedJobs,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        }
      }
    });

  } catch (error) {
    console.error('[COMPANY] Get jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs',
      error: error.message
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

    // Auto-update if it is active but application deadline is passed
    if (job.status === 'ACTIVE' && job.applicationDeadline && new Date(job.applicationDeadline) < new Date()) {
      job.status = 'ON_HOLD';
      await job.save();
    }

    const JobPosition = require('../models/JobPosition');
    const jobPosition = await JobPosition.findOne({ jobId: job._id });

    const jobData = job.toObject();
    jobData.jobPosition = jobPosition;

    res.json({
      success: true,
      data: jobData,
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
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Apply fields from body
    Object.assign(job, req.body);

    // This will trigger the pre-save status sync hooks
    await job.save();

    // Trigger asynchronous JD parsing for JobPosition structure
    parseJobPosition(job).catch(err => {
      console.error(`[JD-PARSER] Asynchronous parsing error on job update: ${err.message}`);
    });

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

    const HIDDEN_STATUSES = ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED'];
    
    const query = { 
      job: req.params.jobId,
      status: status ? status : { $nin: HIDDEN_STATUSES }
    };

    const skip = (page - 1) * limit;

    const candidates = await Candidate.find(query)
      .populate("submittedBy", "firstName lastName firmName")
      .populate("assignedSlot", "date startTime endTime status interviewMode")
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

    const HIDDEN_STATUSES = ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED'];

    const query = { 
      company: company._id,
      status: status ? status : { $nin: HIDDEN_STATUSES }
    };

    const skip = (page - 1) * limit;

    const candidates = await Candidate.find(query)
      .populate("submittedBy", "firstName lastName firmName")
      .populate("job", "title")
      .populate("assignedSlot", "date startTime endTime status interviewMode")
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
      .populate("assignedSlot", "date startTime endTime status interviewMode")
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

// @desc    Shortlist Candidate
// @route   PUT /api/companies/candidates/:id/shortlist
exports.shortlistCandidate = async (req, res) => {
  try {
    const { notes } = req.body;

    const { candidate } = await verifyCompanyOwnership(
      req.params.id,
      req.user._id
    );

    // Use Lifecycle Service for consistent updates
    const updatedCandidate = await candidateLifecycleService.updateStatus(
      candidate._id,
      "SHORTLISTED",
      req.user._id,
      "company",
      notes || "Candidate shortlisted"
    );

    res.json({
      success: true,
      message: "Candidate shortlisted successfully",
      data: {
        candidateId: updatedCandidate._id,
        name: updatedCandidate.name,
        status: updatedCandidate.status,
        nextStep: "Create interview slots via POST /candidates/:id/interview-slots",
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("[COMPANY] Shortlist candidate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to shortlist candidate",
      error: error.message,
    });
  }
};

// @desc    Reject Candidate
// @route   PUT /api/companies/candidates/:id/reject
exports.rejectCandidate = async (req, res) => {
  try {
    const { reason, notes } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Reason for rejection is required",
      });
    }

    const { candidate } = await verifyCompanyOwnership(
      req.params.id,
      req.user._id
    );

    // Use Lifecycle Service for consistent updates
    const updatedCandidate = await candidateLifecycleService.updateStatus(
      candidate._id,
      "REJECTED",
      req.user._id,
      "company",
      notes || reason
    );

    res.json({
      success: true,
      message: "Candidate rejected successfully",
      data: {
        candidateId: updatedCandidate._id,
        status: updatedCandidate.status,
        reason: reason,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("[COMPANY] Reject candidate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject candidate",
      error: error.message,
    });
  }
};


// COMPANY: Create Interview Slots for a Job
// POST /api/companies/jobs/:jobId/interview-slots
exports.createInterviewSlots = async (req, res) => {
  try {
    const { slots } = req.body;

    // ── Validate payload ──────────────────────────────────────────────
    if (!slots || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one interview slot',
        example: {
          slots: [
            {
              date: '2024-02-15',
              startTime: '10:00 AM',
              endTime: '11:00 AM',
              maxCandidates: 3,
              notes: 'Optional notes',
            },
          ],
        },
      });
    }

    // ── Get company ───────────────────────────────────────────────────
    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // ── Get job & validate ownership ──────────────────────────────────
    const job = await Job.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.company.toString() !== company._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (!job.applicationDeadline) {
      return res.status(400).json({
        success: false,
        message: 'Job must have a deadline before creating interview slots',
      });
    }

    const jobDeadline = new Date(job.applicationDeadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    // ── Get existing active slots for overlap check ──────────────────
    const existingSlots = await InterviewSlot.find({
      job: job._id,
      status: { $ne: 'CANCELLED' }
    });

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // ── Validate each slot ────────────────────────────────────────────
    const invalidSlots = [];

    slots.forEach((slot, index) => {
      const errors = [];

      if (!slot.date) errors.push('date is required');
      if (!slot.startTime) errors.push('startTime is required');
      if (!slot.endTime) errors.push('endTime is required');
      if (!slot.maxCandidates || slot.maxCandidates < 1) {
        errors.push('maxCandidates must be at least 1');
      }

      if (slot.date && slot.startTime && slot.endTime) {
        const slotDate = new Date(slot.date);
        slotDate.setHours(0, 0, 0, 0);

        const startMin = timeToMinutes(slot.startTime);
        const endMin = timeToMinutes(slot.endTime);

        if (startMin >= endMin) {
          errors.push('Start time must be before end time');
        }

        // 1. Must be today or future
        if (slotDate < today) {
          errors.push(`Date ${slot.date} is in the past`);
        } else if (slotDate.getTime() === today.getTime()) {
          // 2. If today, start time must be at least 30 mins in future (allow some buffer)
          if (startMin < currentMinutes + 15) {
            errors.push(`Start time ${slot.startTime} is too close to current time or in the past`);
          }
        }

        // 3. Must be on or before job deadline
        if (slotDate > jobDeadline) {
          errors.push(
            `Date ${slot.date} exceeds job deadline (${job.applicationDeadline.toLocaleDateString()})`
          );
        }

        // 4. Check for overlaps WITHIN the new slots array
        const internalOverlap = slots.find((other, otherIdx) => {
          if (otherIdx === index) return false;
          if (other.date !== slot.date) return false;
          
          const oStart = timeToMinutes(other.startTime);
          const oEnd = timeToMinutes(other.endTime);
          
          // Overlap if (StartA < EndB) AND (EndA > StartB)
          return (startMin < oEnd) && (endMin > oStart);
        });

        if (internalOverlap) {
          errors.push(`Slot overlaps with another slot in this request (at index ${slots.indexOf(internalOverlap)})`);
        }

        // 5. Check for overlaps with EXISTING slots in DB
        const dbOverlap = existingSlots.find(existing => {
          const eDate = new Date(existing.date);
          eDate.setHours(0, 0, 0, 0);
          if (eDate.getTime() !== slotDate.getTime()) return false;

          const eStart = timeToMinutes(existing.startTime);
          const eEnd = timeToMinutes(existing.endTime);

          return (startMin < eEnd) && (endMin > eStart);
        });

        if (dbOverlap) {
          errors.push(`Slot overlaps with an existing slot on ${slotDate.toLocaleDateString()} (${dbOverlap.startTime} - ${dbOverlap.endTime})`);
        }
      }

      if (errors.length > 0) {
        invalidSlots.push({ index, slot, errors });
      }
    });

    if (invalidSlots.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some slots have invalid data',
        jobDeadline: job.deadline,
        allowedDateRange: {
          from: today.toISOString().split('T')[0],
          to: jobDeadline.toISOString().split('T')[0],
        },
        invalidSlots,
      });
    }

    // ── Helper to add minutes to 12h time ────────────────────────────
    const addMinutesTo12h = (timeStr, minutes) => {
      let [time, modifier] = timeStr.split(' ');
      let [hours, mins] = time.split(':').map(Number);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      
      const totalMins = hours * 60 + mins + minutes;
      let newHours = Math.floor(totalMins / 60) % 24;
      const newMins = totalMins % 60;
      const ampm = newHours >= 12 ? 'PM' : 'AM';
      newHours = newHours % 12 || 12;
      
      return `${newHours.toString().padStart(2, '0')}:${newMins.toString().padStart(2, '0')} ${ampm}`;
    };

    // ── Create slots ──────────────────────────────────────────────────
    const explodedSlots = [];
    slots.forEach(slot => {
      const avg = parseInt(slot.averageTime) || 30;
      let currentStartTime = slot.startTime;

      for (let i = 0; i < slot.maxCandidates; i++) {
        const currentEndTime = addMinutesTo12h(currentStartTime, avg);
        
        explodedSlots.push({
          job: job._id,
          company: company._id,
          date: new Date(slot.date),
          startTime: currentStartTime,
          endTime: currentEndTime,
          maxCandidates: 1,
          averageTime: avg,
          interviewMode: slot.interviewMode || 'Virtual',
          availableSpots: 1,
          notes: slot.notes || null,
          status: 'ACTIVE',
          createdBy: req.subAdminUser ? req.subAdminUser._id : req.user._id,
        });

        currentStartTime = currentEndTime;
      }
    });

    const createdSlots = await InterviewSlot.insertMany(explodedSlots);

    res.status(201).json({
      success: true,
      message: `${createdSlots.length} interview slot(s) created successfully`,
      data: {
        jobId: job._id,
        jobTitle: job.title,
        jobDeadline: job.deadline,
        allowedDateRange: {
          from: today.toISOString().split('T')[0],
          to: jobDeadline.toISOString().split('T')[0],
        },
        totalSlotsCreated: createdSlots.length,
        slots: createdSlots,
        nextStep:
          'Partners will now see these slots and assign their shortlisted candidates',
      },
    });
  } catch (error) {
    console.error('[COMPANY] Create interview slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create interview slots',
      error: error.message,
    });
  }
};

// COMPANY: Get all slots for a job (Company view — sees all bookings)
// GET /api/companies/jobs/:jobId/interview-slots
exports.getJobInterviewSlots = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const job = await Job.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    if (job.company.toString() !== company._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const callingUserId = req.subAdminUser ? req.subAdminUser._id : req.user._id;
    const isSubAdmin = !!req.subAdminUser;
    const permissions = isSubAdmin ? req.subAdminUser.permissions : [];

    const query = {
      job: req.params.jobId,
      company: company._id,
    };

    if (isSubAdmin && !permissions.includes('MANAGE_INTERVIEWS_ALL') && permissions.includes('MANAGE_INTERVIEWS_SELF')) {
      query.$or = [
        { createdBy: callingUserId },
        { createdBy: null }
      ];
    }

    const slots = await InterviewSlot.find(query)
      .populate({
        path: 'bookedCandidates.candidate',
        select: 'firstName lastName email mobile status profile.currentDesignation',
      })
      .populate({
        path: 'bookedCandidates.partner',
        select: 'firmName contactPerson',
      })
      .sort({ date: 1, startTime: 1 });

    // Group by date for easy viewing
    const slotsByDate = {};
    slots.forEach((slot) => {
      const dateKey = new Date(slot.date).toISOString().split('T')[0];
      if (!slotsByDate[dateKey]) {
        slotsByDate[dateKey] = [];
      }
      slotsByDate[dateKey].push(slot);
    });

    res.json({
      success: true,
      data: {
        jobId: job._id,
        jobTitle: job.title,
        jobDeadline: job.applicationDeadline,
        totalSlots: slots.length,
        totalCapacity: slots.reduce((sum, s) => sum + s.maxCandidates, 0),
        totalBooked: slots.reduce(
          (sum, s) =>
            sum + s.bookedCandidates.filter((b) => b.bookingStatus === 'BOOKED').length,
          0
        ),
        slotsByDate,
        allSlots: slots,
      },
    });
  } catch (error) {
    console.error('[COMPANY] Get job interview slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get interview slots',
      error: error.message,
    });
  }
};

// COMPANY: Delete / Cancel a slot
// DELETE /api/companies/jobs/:jobId/interview-slots/:slotId
exports.cancelInterviewSlot = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const slot = await InterviewSlot.findOne({
      _id: req.params.slotId,
      job: req.params.jobId,
      company: company._id,
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found' });
    }

    const callingUserId = req.subAdminUser ? req.subAdminUser._id : req.user._id;
    const isSubAdmin = !!req.subAdminUser;
    const permissions = isSubAdmin ? req.subAdminUser.permissions : [];

    if (isSubAdmin && !permissions.includes('MANAGE_INTERVIEWS_ALL') && permissions.includes('MANAGE_INTERVIEWS_SELF')) {
      if (slot.createdBy && slot.createdBy.toString() !== callingUserId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to cancel interview slots created by other team members.'
        });
      }
    }

    // Cannot cancel if candidates are already booked
    const activeBookings = slot.bookedCandidates.filter(
      (b) => b.bookingStatus === 'BOOKED'
    );

    if (activeBookings.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel slot with ${activeBookings.length} active booking(s). Remove candidates first.`,
        activeBookings: activeBookings.length,
      });
    }

    slot.status = 'CANCELLED';
    await slot.save();

    res.json({
      success: true,
      message: 'Interview slot cancelled successfully',
      data: { slotId: slot._id, status: slot.status },
    });
  } catch (error) {
    console.error('[COMPANY] Cancel interview slot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel slot',
      error: error.message,
    });
  }
};

// COMPANY: Confirm interview details (mode, link/address, interviewer)
// POST /api/companies/candidates/:id/confirm-interview
exports.confirmInterviewDetails = async (req, res) => {
  try {
    const { mode, details, interviewer } = req.body;

    if (!mode || !details || !interviewer) {
      return res.status(400).json({
        success: false,
        message: "Please provide interview mode, details (link/address), and interviewer name",
      });
    }

    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    const candidate = await Candidate.findById(req.params.id);
    if (!candidate) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    if (candidate.company.toString() !== company._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    if (!candidate.assignedSlot) {
      return res.status(400).json({
        success: false,
        message: "No interview slot assigned for this candidate yet",
      });
    }

    // Fetch slot info for WhatsApp
    const slot = await InterviewSlot.findById(candidate.assignedSlot);
    if (!slot) {
      return res.status(404).json({ success: false, message: "Assigned slot not found" });
    }

    const job = await Job.findById(candidate.job);

    // Generate unique token for confirmation
    const confirmationToken = crypto.randomBytes(32).toString("hex");

    // Update candidate
    candidate.interviewConfig = {
      mode,
      details,
      interviewer,
      isConfirmedByCompany: true,
      confirmedAt: new Date(),
      confirmationToken,
      candidateResponse: "PENDING",
    };

    candidate.status = "INTERVIEW_SCHEDULED";
    candidate.statusHistory.push({
      status: "INTERVIEW_SCHEDULED",
      changedBy: req.user._id,
      changedAt: new Date(),
      changedByRole: "COMPANY",
      notes: `Interview confirmed: ${mode} with ${interviewer}. Confirmation token generated.`,
    });

    await candidate.save();

    // Trigger WhatsApp
    try {
      const interviewDate = new Date(slot.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

      await whatsappService.sendInterviewInvitation(
        candidate.mobile,
        candidate.firstName,
        company.companyName,
        interviewDate,
        slot.startTime,
        job.title,
        mode === "Virtual" ? "Online" : "Offline",
        details,
        interviewer,
        confirmationToken // Use the new crypto token
      );
    } catch (waError) {
      console.error("[COMPANY] WhatsApp notification failed:", waError.message);
    }

    res.json({
      success: true,
      message: "Interview details confirmed and shared with candidate",
      data: candidate.interviewConfig,
    });
  } catch (error) {
    console.error("[COMPANY] Confirm interview details error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to confirm interview details",
      error: error.message,
    });
  }
};

// @desc    Get Interview Schedule for a Company
// @route   GET /api/companies/interview-schedule
exports.getInterviewSchedule = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const { date, startDate, endDate } = req.query;
    let filterDate, nextDay;
    if (startDate && endDate) {
      filterDate = new Date(startDate);
      filterDate.setHours(0, 0, 0, 0);
      nextDay = new Date(endDate);
      nextDay.setHours(23, 59, 59, 999);
    } else {
      filterDate = date ? new Date(date) : new Date();
      filterDate.setHours(0, 0, 0, 0);
      nextDay = new Date(filterDate);
      nextDay.setDate(nextDay.getDate() + 1);
    }

    const callingUserId = req.subAdminUser ? req.subAdminUser._id : req.user._id;
    const isSubAdmin = !!req.subAdminUser;
    const permissions = isSubAdmin ? req.subAdminUser.permissions : [];

    const query = {
      company: company._id,
      date: {
        $gte: filterDate,
        $lte: nextDay
      },
      status: { $ne: 'CANCELLED' }
    };

    if (isSubAdmin && !permissions.includes('MANAGE_INTERVIEWS_ALL') && permissions.includes('MANAGE_INTERVIEWS_SELF')) {
      query.$or = [
        { createdBy: callingUserId },
        { createdBy: null }
      ];
    }

    const slots = await InterviewSlot.find(query)
    .populate({
      path: 'bookedCandidates.candidate',
      model: 'Candidate',
      select: 'firstName lastName email mobile status profile.currentDesignation profile.middleName uniqueId interviewConfig'
    })
    .populate('job', 'title location employmentType')
    .sort({ date: 1, startTime: 1 });
    
    // Format response for dashboard
    const schedule = slots.map(slot => {
      
      const bookings = (slot.bookedCandidates || [])
        .map(b => {
          if (!b.candidate) {
            return null;
          }
          
          // Check if it's a populated object or just an ID
          const cand = b.candidate;
          if (!cand.firstName) {
             if (cand._id) {
                // If it's an object but empty
                return {
                    candidateId: cand._id,
                    uniqueId: cand.uniqueId || "N/A",
                    name: "Data Missing",
                    email: "Missing",
                    status: b.bookingStatus
                };
             }
             return null;
          }

          return {
            candidateId: cand._id,
            uniqueId: cand.uniqueId || "N/A",
            name: `${cand.firstName || ''} ${cand.middleName || ''} ${cand.lastName || ''}`.replace(/\s+/g, ' ').trim(),
            email: cand.email,
            designation: cand.profile?.currentDesignation || 'Candidate',
            status: b.bookingStatus,
            mobile: cand.mobile,
            interviewConfig: cand.interviewConfig || null
          };
        })
        .filter(Boolean);

      return {
        id: slot._id,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        interviewMode: slot.interviewMode,
        jobTitle: slot.job?.title || 'Unknown Position',
        jobLocation: slot.job?.location?.city || 'N/A',
        notes: slot.notes,
        bookings
      };
    });

    res.json({
      success: true,
      data: {
        date: filterDate,
        schedule,
        debug: {
            slotCount: slots.length,
            totalBookings: schedule.reduce((sum, s) => sum + s.bookings.length, 0)
        }
      }
    });
  } catch (error) {
    console.error('[COMPANY] Get interview schedule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch interview schedule',
      error: error.message
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
    const requiredFields = ['title', 'description', 'category', 'employmentType', 'experienceLevel', 'location.city'];
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
                location: Array.isArray(job.location.city) ? job.location.city.join(', ') : (job.location.city || 'N/A'),
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

    // Helper function for deep value comparison (handles Dates, nested objects, and arrays)
    const valuesAreEqual = (a, b) => {
      if (a === b) return true;
      if (a == null || b == null) return a == b;

      // Handle Dates
      const isDateLike = (val) => {
        if (val instanceof Date) return true;
        if (typeof val === 'string' && !isNaN(Date.parse(val)) && val.includes('-')) {
          return true;
        }
        return false;
      };

      if (isDateLike(a) && isDateLike(b)) {
        try {
          const dateA = new Date(a);
          const dateB = new Date(b);
          if (dateA.getTime() === dateB.getTime()) return true;
          
          // Fallback to split string comparison for simple dates
          const ymdA = dateA.toISOString().split('T')[0];
          const ymdB = dateB.toISOString().split('T')[0];
          return ymdA === ymdB;
        } catch (e) {
          // fall through
        }
      }

      // Handle Array
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((item, idx) => valuesAreEqual(item, b[idx]));
      }

      // Handle Object
      if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        if (keysA.length !== keysB.length) return false;
        return keysA.every(key => valuesAreEqual(a[key], b[key]));
      }

      // Handle string vs number comparison
      if ((typeof a === 'string' && typeof b === 'number') || (typeof a === 'number' && typeof b === 'string')) {
        return String(a) === String(b);
      }

      return JSON.stringify(a) === JSON.stringify(b);
    };

    // Validate that requested fields exist and values are different
    const validatedChanges = {};
    const invalidFields = [];

    for (const [field, change] of Object.entries(requestedChanges)) {
      if (change.old === undefined || change.new === undefined) {
        invalidFields.push(`${field}: Must provide both 'old' and 'new' values`);
        continue;
      }

      // Check if field exists in job
      const currentValue = field.split('.').reduce((obj, key) => obj?.[key], job);

      if (currentValue === undefined) {
        invalidFields.push(`${field}: Field does not exist in job`);
        continue;
      }

      // Check if old value matches current (using our robust comparison helper)
      if (!valuesAreEqual(currentValue, change.old)) {
        invalidFields.push(`${field}: Old value doesn't match current value`);
        continue;
      }

      // Check if new value is actually different; if they are same, we just skip it (don't error out)
      if (valuesAreEqual(change.old, change.new)) {
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

    if (Object.keys(validatedChanges).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No changes were detected in the requested edit'
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

// ==================== COMPANY SUB-ADMIN MANAGEMENT ====================

// Generate a secure random password
const generatePassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '@#$!';
  const all = upper + lower + digits + special;
  const rand = (str) => str[crypto.randomInt(str.length)];
  const base = rand(upper) + rand(lower) + rand(digits) + rand(special);
  const rest = Array.from({ length: 8 }, () => rand(all)).join('');
  // Shuffle the 12-char password
  return (base + rest).split('').sort(() => crypto.randomInt(3) - 1).join('');
};

// Helper: validate company permissions
const validateCompanyPermissions = (permissions = []) => {
  if (!Array.isArray(permissions)) return false;
  return permissions.every((permission) => COMPANY_ALL_PERMISSIONS.includes(permission));
};

// @desc    Create company sub-admin
// @route   POST /api/companies/sub-admins
// @access  Company (Main User only)
exports.createSubAdmin = async (req, res) => {
  try {
    const emailService = require('../services/emailService');
    const {
      firstName = '',
      lastName = '',
      email,
      mobile,
      permissions = [],
      bundle,
      status = 'ACTIVE'
    } = req.body;

    if (!email || !mobile) {
      return res.status(400).json({
        success: false,
        message: 'Email and WhatsApp number are required'
      });
    }

    if (!firstName.trim() || !lastName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'First name and last name are required'
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

    const existingUser = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { mobile: normalizedMobile }
      ]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or WhatsApp number already exists'
      });
    }

    let finalPermissions = permissions;

    // If bundle provided and permissions not provided, use bundle
    if ((!permissions || permissions.length === 0) && bundle) {
      if (!COMPANY_SUB_ADMIN_BUNDLES[bundle]) {
        return res.status(400).json({
          success: false,
          message: 'Invalid permission bundle'
        });
      }
      finalPermissions = COMPANY_SUB_ADMIN_BUNDLES[bundle];
    }

    if (!validateCompanyPermissions(finalPermissions)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid permissions provided'
      });
    }

    // Auto-generate a secure password
    const autoPassword = generatePassword();

    const subAdmin = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: normalizedEmail,
      mobile: normalizedMobile,
      password: autoPassword,
      role: 'company',
      status,
      permissions: [...new Set(finalPermissions)],
      createdBy: req.user._id,
      emailVerified: true,
      mobileVerified: true,
      isPasswordChanged: false // Must change on first login
    });

    // Send onboarding welcome email (fire-and-forget)
    emailService.sendSubAdminWelcome(
      normalizedEmail,
      firstName.trim(),
      lastName.trim(),
      autoPassword,
      [...new Set(finalPermissions)]
    ).catch(e => console.error('[COMPANY-SUB-ADMIN] Welcome email failed:', e.message));

    const responseUser = await User.findById(subAdmin._id).select('-password');

    res.status(201).json({
      success: true,
      message: `Sub-admin created! Welcome email sent to ${normalizedEmail}`,
      data: responseUser
    });
  } catch (error) {
    console.error('[COMPANY-SUB-ADMIN] Create error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sub-admin',
      error: error.message
    });
  }
};

// @desc    Get all company sub-admins
// @route   GET /api/companies/sub-admins
// @access  Company (Main User only)
exports.getSubAdmins = async (req, res) => {
  try {
    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { status, search } = req.query;

    const query = { role: 'company', createdBy: req.user._id };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { email: new RegExp(search, 'i') },
        { mobile: new RegExp(search, 'i') }
      ];
    }

    const skip = (page - 1) * limit;

    const [subAdmins, total] = await Promise.all([
      User.find(query)
        .select('-password')
        .populate('createdBy', 'email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        subAdmins,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        }
      }
    });
  } catch (error) {
    console.error('[COMPANY-SUB-ADMIN] List error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sub-admins',
      error: error.message
    });
  }
};

// @desc    Get single company sub-admin
// @route   GET /api/companies/sub-admins/:id
// @access  Company (Main User only)
exports.getSubAdminById = async (req, res) => {
  try {
    const subAdmin = await User.findOne({
      _id: req.params.id,
      role: 'company',
      createdBy: req.user._id
    })
      .select('-password')
      .populate('createdBy', 'email role');

    if (!subAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Sub-admin not found'
      });
    }

    res.json({
      success: true,
      data: subAdmin
    });
  } catch (error) {
    console.error('[COMPANY-SUB-ADMIN] Get by id error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sub-admin',
      error: error.message
    });
  }
};

// @desc    Update company sub-admin
// @route   PUT /api/companies/sub-admins/:id
// @access  Company (Main User only)
exports.updateSubAdmin = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      mobile,
      permissions,
      bundle,
      status
    } = req.body;

    const subAdmin = await User.findOne({
      _id: req.params.id,
      role: 'company',
      createdBy: req.user._id
    });

    if (!subAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Sub-admin not found'
      });
    }

    if (firstName !== undefined) subAdmin.firstName = firstName.trim();
    if (lastName !== undefined) subAdmin.lastName = lastName.trim();

    if (mobile) {
      const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

      const existingMobileUser = await User.findOne({
        mobile: normalizedMobile,
        _id: { $ne: subAdmin._id }
      });

      if (existingMobileUser) {
        return res.status(400).json({
          success: false,
          message: 'WhatsApp number already in use'
        });
      }

      subAdmin.mobile = normalizedMobile;
    }

    let finalPermissions = permissions;

    if ((!permissions || permissions.length === 0) && bundle) {
      if (!COMPANY_SUB_ADMIN_BUNDLES[bundle]) {
        return res.status(400).json({
          success: false,
          message: 'Invalid permission bundle'
        });
      }
      finalPermissions = COMPANY_SUB_ADMIN_BUNDLES[bundle];
    }

    if (finalPermissions !== undefined) {
      if (!validateCompanyPermissions(finalPermissions)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid permissions provided'
        });
      }

      subAdmin.permissions = [...new Set(finalPermissions)];
    }

    if (status) {
      subAdmin.status = status;

      if (status === 'SUSPENDED') {
        subAdmin.suspendedBy = req.user._id;
        subAdmin.suspendedAt = new Date();
      } else {
        subAdmin.suspendedBy = null;
        subAdmin.suspendedAt = null;
      }
    }

    await subAdmin.save();

    const updatedSubAdmin = await User.findById(subAdmin._id)
      .select('-password')
      .populate('createdBy', 'email role');

    res.json({
      success: true,
      message: 'Sub-admin updated successfully',
      data: updatedSubAdmin
    });
  } catch (error) {
    console.error('[COMPANY-SUB-ADMIN] Update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update sub-admin',
      error: error.message
    });
  }
};

// @desc    Update company sub-admin status
// @route   PUT /api/companies/sub-admins/:id/status
// @access  Company (Main User only)
exports.updateSubAdminStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Allowed: ACTIVE, SUSPENDED'
      });
    }

    const subAdmin = await User.findOne({
      _id: req.params.id,
      role: 'company',
      createdBy: req.user._id
    });

    if (!subAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Sub-admin not found'
      });
    }

    subAdmin.status = status;

    if (status === 'SUSPENDED') {
      subAdmin.suspendedBy = req.user._id;
      subAdmin.suspendedAt = new Date();
    } else {
      subAdmin.suspendedBy = null;
      subAdmin.suspendedAt = null;
    }

    await subAdmin.save();

    res.json({
      success: true,
      message: 'Sub-admin status updated successfully',
      data: {
        id: subAdmin._id,
        email: subAdmin.email,
        status: subAdmin.status,
        suspendedAt: subAdmin.suspendedAt
      }
    });
  } catch (error) {
    console.error('[COMPANY-SUB-ADMIN] Status update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update sub-admin status',
      error: error.message
    });
  }
};

// @desc    Get company available permissions and bundles
// @route   GET /api/companies/sub-admins/permissions
// @access  Company (Main User only)
exports.getPermissionsMeta = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        allPermissions: COMPANY_ALL_PERMISSIONS,
        groups: COMPANY_PERMISSION_GROUPS,
        bundles: COMPANY_SUB_ADMIN_BUNDLES,
        totalPermissions: COMPANY_ALL_PERMISSIONS.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch permissions metadata',
      error: error.message
    });
  }
};
