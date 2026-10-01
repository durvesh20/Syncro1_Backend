const crypto = require('crypto');
const Company = require("../models/Company");
const User = require("../models/User");
const Job = require("../models/Job");
const Candidate = require("../models/Candidate");
const ScreeningQuestion = require("../models/ScreeningQuestion");
const candidateLifecycleService = require("../services/candidateLifecycleService");
const InterviewSlot = require("../models/InterviewSlot");
const whatsappService = require("../services/whatsappService");
const notifyCRM = require('../utils/notifyCRM');
const {
  COMPANY_ALL_PERMISSIONS,
  COMPANY_PERMISSION_GROUPS,
  COMPANY_SUB_ADMIN_BUNDLES
} = require('../utils/permissions');
const { isWorkEmail } = require('../utils/validators');

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

    // ── CRM: Company Profile Step ───────────────────────────────────
    try { notifyCRM.companyProfileStep(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────

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
      logo: logo !== undefined ? logo : company.kyc?.logo,
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

    // ── CRM: Company Profile Step ───────────────────────────────────
    try { notifyCRM.companyProfileStep(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────

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

    // ── CRM: Company Profile Step ───────────────────────────────────
    try { notifyCRM.companyProfileStep(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────

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

    // ── CRM: Company Profile Step ───────────────────────────────────
    try { notifyCRM.companyProfileStep(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────

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

    // ── CRM: Company Profile Step ───────────────────────────────────
    try { notifyCRM.companyProfileStep(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────

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

    // ── CRM: Company Profile Step ───────────────────────────────────
    try { notifyCRM.companyProfileStep(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────
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

    // ── CRM: Company Profile Submitted ─────────────────────────────
    try { notifyCRM.companyProfileSubmitted(req.user, company) } catch (e) { /* non-critical */ }
    // ─────────────────────────────────────────────────────────

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

    // NOTE: Deadline-based auto ON_HOLD removed intentionally.
    // Status is changed only via explicit action.

    const jobStats = await Job.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    // ✅ NEW: Approval status breakdown
    const approvalStats = await Job.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    // ✅ NEW: Get rejected jobs for alerts
    const rejectedJobs = await Job.find({
      company: company._id,
      status: 'REJECTED'
    })
      .select('title rejectionReason rejectedAt')
      .sort({ rejectedAt: -1 })
      .limit(5); // Show top 5 most recent

    // ✅ NEW: Get pending approval jobs
    const pendingApprovalJobs = await Job.find({
      company: company._id,
      status: 'PENDING_APPROVAL'
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

    // ✅ Enforce vacancies > 0 validation
    if (req.body.vacancies !== undefined && (Number(req.body.vacancies) <= 0 || !Number.isInteger(Number(req.body.vacancies)))) {
      return res.status(400).json({
        success: false,
        message: "Vacancies must be a positive integer greater than 0."
      });
    }

    // ✅ Enforce salary >= 0 validation
    if (req.body.salary) {
      if (req.body.salary.min !== undefined && Number(req.body.salary.min) < 0) {
        return res.status(400).json({
          success: false,
          message: "Salary minimum must be greater than or equal to 0."
        });
      }
      if (req.body.salary.max !== undefined && Number(req.body.salary.max) < 0) {
        return res.status(400).json({
          success: false,
          message: "Salary maximum must be greater than or equal to 0."
        });
      }
    }

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
      status: "DRAFT",
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

    // NOTE: Deadline-based auto ON_HOLD removed intentionally.
    // Status is changed only via explicit action.

    const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
    const { status, search } = req.query;

    const query = { company: company._id };
    if (status) {
      const normalizedStatus = String(status).toUpperCase().trim().replace(/[\s-]+/g, '_');
      if (normalizedStatus === 'ACTIVE') {
        query.status = { $in: ['ACTIVE', 'APPROVED', 'EDIT_REQUESTED'] };
      } else {
        query.status = normalizedStatus;
      }
    }

    if (search && search.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      query.$or = [
        { title: rx },
        { uniqueId: rx },
        { 'location.city': rx },
        { 'location.state': rx }
      ];
    }

    const skip = (page - 1) * limit;

    const [jobs, total, totalAll, totalActive, totalPending, totalEditReq, totalDraft, totalClosed, totalOnHold, totalPaused, totalRejected] = await Promise.all([
      Job.find(query)
        .populate(
          'company',
          'companyName kyc.industry kyc.logo kyc.companyType kyc.employeeCount city state verificationStatus'
        )
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit),
      Job.countDocuments(query),
      Job.countDocuments({ company: company._id }),
      Job.countDocuments({ company: company._id, status: { $in: ['ACTIVE', 'APPROVED'] }, status: { $ne: 'CLOSED' } }),
      Job.countDocuments({ company: company._id, status: 'PENDING_APPROVAL' }),
      Job.countDocuments({ company: company._id, status: 'EDIT_REQUESTED' }),
      Job.countDocuments({ company: company._id, status: 'DRAFT' }),
      Job.countDocuments({ company: company._id, status: 'CLOSED' }),
      Job.countDocuments({ company: company._id, status: 'ON_HOLD' }),
      Job.countDocuments({ company: company._id, status: 'PAUSED' }),
      Job.countDocuments({ company: company._id, status: 'REJECTED' }),
    ]);

    const summary = {
      TOTAL: totalAll,
      ACTIVE: totalActive,
      PENDING_APPROVAL: totalPending,
      EDIT_REQUESTED: totalEditReq,
      DRAFT: totalDraft,
      CLOSED: totalClosed,
      ON_HOLD: totalOnHold,
      PAUSED: totalPaused,
      REJECTED: totalRejected
    };

    // ✅ Enrich each job with safe company snapshot and active candidates count
    const enrichedJobs = await Promise.all(jobs.map(async (job) => {
      const jobObj = job.toObject();
      const comp = job.company;

      const activeCandidatesCount = await Candidate.countDocuments({
        job: job._id,
        status: {
          $nin: ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED', 'REJECTED', 'WITHDRAWN', 'JOINED']
        }
      });

      return {
        ...jobObj,
        activeCandidatesCount,
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
    }));

    res.json({
      success: true,
      data: {
        jobs: enrichedJobs,
        summary,
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
      status: 'REJECTED'
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

    // NOTE: Deadline-based auto ON_HOLD removed intentionally.
    // Status is changed only via explicit action.

    const activeCandidatesCount = await Candidate.countDocuments({
      job: job._id,
      status: {
        $nin: ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED', 'REJECTED', 'WITHDRAWN', 'JOINED']
      }
    });

    const jobObj = job.toObject();
    jobObj.activeCandidatesCount = activeCandidatesCount;

    res.json({
      success: true,
      data: jobObj,
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

    // ✅ Enforce vacancies > 0 validation
    if (req.body.vacancies !== undefined && (Number(req.body.vacancies) <= 0 || !Number.isInteger(Number(req.body.vacancies)))) {
      return res.status(400).json({
        success: false,
        message: "Vacancies must be a positive integer greater than 0."
      });
    }

    // ✅ Enforce salary >= 0 validation
    if (req.body.salary) {
      if (req.body.salary.min !== undefined && Number(req.body.salary.min) < 0) {
        return res.status(400).json({
          success: false,
          message: "Salary minimum must be greater than or equal to 0."
        });
      }
      if (req.body.salary.max !== undefined && Number(req.body.salary.max) < 0) {
        return res.status(400).json({
          success: false,
          message: "Salary maximum must be greater than or equal to 0."
        });
      }
    }

    const oldVacancies = job.vacancies || 1;

    // Apply fields from body
    Object.assign(job, req.body);

    // This will trigger the pre-save status sync hooks
    await job.save();

    // ✅ Sync talent partner slot sizes (submissionLimit) if vacancies were updated (1 vacancy = 5 slots)
    if (req.body.vacancies !== undefined && Number(req.body.vacancies) !== oldVacancies) {
      try {
        const { syncJobInterestSlots } = require('../services/slotService');
        await syncJobInterestSlots(job._id, oldVacancies, Number(req.body.vacancies));
      } catch (slotErr) {
        console.error('[COMPANY] Failed to sync partner slots on job update:', slotErr);
      }
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
    const { status, search } = req.query;

    const HIDDEN_STATUSES = ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED'];

    const query = {
      job: req.params.jobId,
      status: status ? status : { $nin: HIDDEN_STATUSES }
    };

    if (search && search.trim()) {
      const s = search.trim();
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { mobile: regex },
        { phone: regex },
        { uniqueId: regex },
        { 'profile.location': regex },
        { 'profile.currentCity': regex },
        { 'profile.city': regex },
        { 'profile.phone': regex },
        { 'profile.mobile': regex },
        { 'profile.currentDesignation': regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: escaped,
              options: "i"
            }
          }
        }
      ];
    }

    const skip = (page - 1) * limit;

    const candidates = await Candidate.find(query)
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
    const { status, search, job, jobId } = req.query;

    const HIDDEN_STATUSES = ['DRAFT', 'CONSENT_PENDING', 'CONSENT_CONFIRMED', 'CONSENT_DENIED', 'ADMIN_REVIEW', 'ADMIN_REJECTED'];

    const query = {
      company: company._id,
      status: status ? status : { $nin: HIDDEN_STATUSES }
    };

    const targetJob = job || jobId;
    if (targetJob && targetJob !== 'ALL') {
      query.job = targetJob;
    }

    if (search && search.trim()) {
      const s = search.trim();
      const regex = new RegExp(s, 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { mobile: regex },
        { uniqueId: regex },
        { 'profile.currentDesignation': regex },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: ["$firstName", " ", "$lastName"] },
              regex: s,
              options: "i"
            }
          }
        }
      ];
    }

    const skip = (page - 1) * limit;

    const candidates = await Candidate.find(query)
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

async function checkAndElevateCandidateStatus(candidate, userId) {
  // Disabled: viewing a candidate must not silently mutate their status to SLOTS_PUBLISHED in DB
  return;
}

// @desc    Get Single Candidate
// @route   GET /api/companies/candidates/:id
exports.getCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
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
    const { slots, roundType } = req.body;

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
    if (job.pipelineTemplate && job.pipelineTemplate.length > 0) {
      if (!roundType) {
        return res.status(400).json({
          success: false,
          message: 'Please specify the roundType for these interview slots.'
        });
      }
      const hasRound = job.pipelineTemplate.some(r => r.roundType === roundType) || roundType === 'HR_ROUND';
      if (!hasRound) {
        return res.status(400).json({
          success: false,
          message: `The round type "${roundType}" is not configured in this job's interview pipeline.`
        });
      }
    }

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
        jobDeadline: job.applicationDeadline || null,
        allowedDateRange: {
          from: today.toISOString().split('T')[0],
          to: job.applicationDeadline ? new Date(job.applicationDeadline).toISOString().split('T')[0] : null,
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
    const Candidate = require('../models/Candidate');

    const taggedIds = slots.map(s => s.taggedCandidateId).filter(Boolean).map(id => id.toString());
    const duplicateId = taggedIds.find((id, idx) => taggedIds.indexOf(id) !== idx);
    if (duplicateId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot tag the same candidate to multiple interview slots at the same time.'
      });
    }

    for (const slot of slots) {
      const avg = parseInt(slot.averageTime) || 30;
      let currentStartTime = slot.startTime;
      const count = slot.taggedCandidateId ? 1 : (parseInt(slot.maxCandidates) || 1);

      let taggedCand = null;
      if (slot.taggedCandidateId) {
        taggedCand = await Candidate.findOne({
          _id: slot.taggedCandidateId,
          job: job._id
        });

        if (!taggedCand) {
          return res.status(404).json({
            success: false,
            message: 'Tagged candidate not found for this job'
          });
        }

        // 1. Consent validation
        if (
          taggedCand.status === 'CONSENT_PENDING' ||
          taggedCand.status === 'CONSENT_SENT' ||
          taggedCand.status === 'CONSENT_DENIED' ||
          taggedCand.status === 'DRAFT' ||
          taggedCand.whatsappConsent?.status === 'PENDING' ||
          taggedCand.whatsappConsent?.status === 'DENIED' ||
          taggedCand.consent?.consentStatus === 'PENDING_CONFIRMATION' ||
          taggedCand.consent?.consentStatus === 'DENIED'
        ) {
          return res.status(400).json({
            success: false,
            message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} is pending consent and cannot be tagged for an interview slot.`
          });
        }

        // 2. Shortlisted pipeline status validation
        const allowedCandidateStatuses = [
          'SHORTLISTED',
          'SLOTS_NOT_PUBLISHED',
          'SLOTS_PUBLISHED',
          'ROUND_SELECTED_NEXT',
          'ROUND_SELECTED_DIRECT_HR',
          'HR_ROUND_PENDING',
          'RESCHEDULE_REQUESTED',
          'ASSESSMENT_PASSED'
        ];
        if (!allowedCandidateStatuses.includes(taggedCand.status)) {
          return res.status(400).json({
            success: false,
            message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} is not shortlisted or eligible for interview scheduling (status: ${taggedCand.status}).`
          });
        }

        // Check if candidate is already tagged or assigned to an active slot for their current round
        if (['SLOT_ASSIGNED', 'SLOT_DETAILS_SHARED', 'INTERVIEW_CONFIRMED'].includes(taggedCand.status)) {
          const existingTaggedSlot = await InterviewSlot.findOne({
            job: job._id,
            status: { $ne: 'CANCELLED' },
            ...(roundType ? { roundType } : {}),
            $or: [
              { candidateId: taggedCand._id },
              { 'bookedCandidates.candidate': taggedCand._id },
              ...(taggedCand.assignedSlot ? [{ _id: taggedCand.assignedSlot }] : [])
            ]
          });

          if (existingTaggedSlot) {
            return res.status(400).json({
              success: false,
              message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} is already tagged to an active interview slot (${existingTaggedSlot.startTime} - ${existingTaggedSlot.endTime}).`
            });
          }
        }

        // Check if candidate is eligible for the chosen roundType
        if (roundType && taggedCand.rounds && taggedCand.rounds.length > 0) {
          const sType = roundType.trim().toLowerCase();
          const validHrNames = ['hr', 'hr round', 'hr_round', 'human resource', 'human resource round'];
          const isSlotHr = validHrNames.includes(sType);

          // Find candidate's current active round index
          let currentActiveIdx = -1;
          const ACTIVE_ROUND_STATES = [
            'SLOTS_NOT_PUBLISHED',
            'SLOTS_PUBLISHED',
            'SLOT_ASSIGNED',
            'RESCHEDULE_REQUESTED',
            'SLOT_DETAILS_SHARED',
            'INTERVIEW_CONDUCTED',
            'ROUND_ON_HOLD',
            'HR_ROUND_PENDING',
            'ASSESSMENT_PENDING',
            'ASSESSMENT_LINK_SENT',
            'ASSESSMENT_LINK_COMPLETE'
          ];
          for (let rIdx = 0; rIdx < taggedCand.rounds.length; rIdx++) {
            if (ACTIVE_ROUND_STATES.includes(taggedCand.rounds[rIdx].status)) {
              currentActiveIdx = rIdx;
              break;
            }
          }

          if (currentActiveIdx === -1) {
            for (let rIdx = 0; rIdx < taggedCand.rounds.length; rIdx++) {
              const r = taggedCand.rounds[rIdx];
              const isCleared = ['PASSED', 'ROUND_SELECTED_NEXT', 'ROUND_PASSED', 'ASSESSMENT_PASSED', 'CLEARED'].includes(r.status) ||
                ['SELECTED_NEXT_ROUND', 'PASSED', 'PASS'].includes(r.outcome?.decision);
              if (!isCleared) {
                currentActiveIdx = rIdx;
                break;
              }
            }
          }
          if (currentActiveIdx === -1) currentActiveIdx = 0;

          let targetRoundIdx = taggedCand.rounds.findIndex(r => {
            const rName = (r.roundType || '').trim().toLowerCase();
            return isSlotHr ? validHrNames.includes(rName) : rName === sType;
          });

          // Match by job pipelineTemplate order if exact name didn't match
          if (targetRoundIdx === -1 && job.pipelineTemplate && job.pipelineTemplate.length > 0) {
            const pRound = job.pipelineTemplate.find(pr => {
              const prName = (pr.roundType || '').trim().toLowerCase();
              return isSlotHr ? validHrNames.includes(prName) : prName === sType;
            });
            if (pRound && pRound.order != null) {
              targetRoundIdx = taggedCand.rounds.findIndex(r => r.order === pRound.order);
            }
          }

          // Match by partial inclusion
          if (targetRoundIdx === -1) {
            targetRoundIdx = taggedCand.rounds.findIndex(r => {
              const rName = (r.roundType || '').trim().toLowerCase();
              return rName.includes(sType) || sType.includes(rName);
            });
          }

          if (targetRoundIdx === -1) {
            return res.status(400).json({
              success: false,
              message: `Round "${roundType}" is not part of candidate ${taggedCand.firstName} ${taggedCand.lastName}'s interview pipeline.`
            });
          }

          if (targetRoundIdx < currentActiveIdx) {
            return res.status(400).json({
              success: false,
              message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} has already cleared round "${roundType}".`
            });
          }

          if (targetRoundIdx > currentActiveIdx) {
            return res.status(400).json({
              success: false,
              message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} has not reached round "${roundType}" yet.`
            });
          }

          const targetRound = taggedCand.rounds[targetRoundIdx];
          if (['PASSED', 'REJECTED', 'ROUND_REJECTED', 'ASSESSMENT_FAILED', 'CANDIDATE_DROP'].includes(targetRound.status)) {
            return res.status(400).json({
              success: false,
              message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} is not eligible for round "${roundType}" (round status: ${targetRound.status}).`
            });
          }

          if (['SLOT_ASSIGNED', 'SLOT_DETAILS_SHARED', 'INTERVIEW_CONFIRMED'].includes(targetRound.status)) {
            return res.status(400).json({
              success: false,
              message: `Candidate ${taggedCand.firstName} ${taggedCand.lastName} already has an active slot assigned for round "${roundType}".`
            });
          }
        }
      }

      for (let i = 0; i < count; i++) {
        const currentEndTime = (slot.endTime && count === 1) ? slot.endTime : addMinutesTo12h(currentStartTime, avg);

        const slotObj = {
          job: job._id,
          company: company._id,
          date: new Date(slot.date),
          startTime: currentStartTime,
          endTime: currentEndTime,
          maxCandidates: 1,
          averageTime: avg,
          interviewMode: slot.interviewMode || 'Virtual',
          interviewDetails: slot.interviewDetails || "",
          interviewerName: slot.interviewerName || "",
          availableSpots: taggedCand ? 0 : 1,
          notes: slot.notes || null,
          status: taggedCand ? 'FULL' : 'ACTIVE',
          roundType: roundType || null,
          createdBy: req.subAdminUser ? req.subAdminUser._id : req.user._id,
          isTagged: !!taggedCand,
          candidateId: taggedCand ? taggedCand._id : null,
          bookedCandidates: taggedCand ? [{
            candidate: taggedCand._id,
            partner: taggedCand.submittedBy,
            bookedAt: new Date(),
            bookingStatus: 'BOOKED'
          }] : [],
          activityLogs: [{
            action: 'CREATED',
            performedBy: req.user._id,
            performedByRole: req.user.role || (req.subAdminUser ? 'company_sub_admin' : 'company'),
            performedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Company',
            details: taggedCand
              ? `Slot created and allotted to candidate ${taggedCand.firstName} ${taggedCand.lastName}`
              : `Slot created for candidate pool (Capacity: ${count})`,
            timestamp: new Date()
          }]
        };

        explodedSlots.push(slotObj);
        currentStartTime = currentEndTime;
      }
    }

    const createdSlots = await InterviewSlot.insertMany(explodedSlots);

    // Update tagged candidates
    for (const createdSlot of createdSlots) {
      if (createdSlot.isTagged && createdSlot.candidateId) {
        const cand = await Candidate.findById(createdSlot.candidateId);
        if (cand) {
          cand.assignedSlot = createdSlot._id;
          cand.status = 'SLOT_ASSIGNED';

          // Update active round
          for (let i = 0; i < (cand.rounds || []).length; i++) {
            const r = cand.rounds[i];
            if (['SLOTS_NOT_PUBLISHED', 'SLOTS_PUBLISHED', 'SHORTLISTED', 'RESCHEDULE_REQUESTED'].includes(r.status)) {
              r.status = 'SLOT_ASSIGNED';
              r.slots = [{
                date: createdSlot.date,
                startTime: createdSlot.startTime,
                endTime: createdSlot.endTime,
                timezone: createdSlot.timezone || 'Asia/Kolkata',
                mode: createdSlot.interviewMode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL',
                interviewerName: createdSlot.interviewerName || '',
                capacity: 1,
                bookedBy: cand.submittedBy,
                bookedAt: new Date(),
                isTagged: true,
                candidateId: cand._id,
                roundType: createdSlot.roundType || r.roundType,
                details: {
                  meetingLink: createdSlot.interviewMode === 'Virtual' ? (createdSlot.interviewDetails || '') : '',
                  address: createdSlot.interviewMode === 'Face-to-Face' ? (createdSlot.interviewDetails || '') : '',
                  pointOfContact: {
                    name: createdSlot.interviewerName || '',
                    phone: '',
                    email: ''
                  }
                }
              }];
              break;
            }
          }

          cand.statusHistory.push({
            status: 'SLOT_ASSIGNED',
            changedBy: req.subAdminUser ? req.subAdminUser._id : req.user._id,
            changedAt: new Date(),
            changedByRole: 'COMPANY',
            notes: `Interview slot pre-allotted on ${new Date(createdSlot.date).toDateString()} ${createdSlot.startTime} - ${createdSlot.endTime}. Awaiting talent partner confirmation.`,
            metadata: {
              slotId: createdSlot._id,
              slotDate: createdSlot.date,
              startTime: createdSlot.startTime,
              endTime: createdSlot.endTime,
            }
          });

          await cand.save();
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `${createdSlots.length} interview slot(s) created successfully`,
      data: {
        jobId: job._id,
        jobTitle: job.title,
        jobDeadline: job.applicationDeadline || null,
        allowedDateRange: {
          from: today.toISOString().split('T')[0],
          to: job.applicationDeadline ? new Date(job.applicationDeadline).toISOString().split('T')[0] : null,
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
    const job = await Job.findById(req.params.jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    let companyId;
    if (req.user.role === 'admin' || req.user.role === 'sub_admin') {
      companyId = job.company;
    } else {
      const company = await Company.findOne({ user: req.user._id });
      if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }
      if (job.company.toString() !== company._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      companyId = company._id;
    }

    const callingUserId = req.subAdminUser ? req.subAdminUser._id : req.user._id;
    const isSubAdmin = !!req.subAdminUser;
    const permissions = isSubAdmin ? req.subAdminUser.permissions : [];

    const query = {
      job: req.params.jobId,
      company: companyId,
    };

    if (isSubAdmin && !permissions.includes('MANAGE_INTERVIEWS_ALL') && permissions.includes('MANAGE_INTERVIEWS_SELF')) {
      query.$or = [
        { createdBy: callingUserId },
        { createdBy: null }
      ];
    }

    const slots = await InterviewSlot.find(query)
      .populate('candidateId', 'firstName lastName email mobile uniqueId')
      .populate({
        path: 'bookedCandidates.candidate',
        select: 'firstName lastName email mobile status profile.currentDesignation uniqueId interviewConfig',
      })
      .populate({
        path: 'bookedCandidates.partner',
        select: 'firmName contactPerson',
      })
      .populate('createdBy', 'email role')
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
        jobStatus: job.status,
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
    slot.activityLogs = slot.activityLogs || [];
    slot.activityLogs.push({
      action: 'CANCELLED',
      performedBy: req.user._id,
      performedByRole: req.user.role || (req.subAdminUser ? 'company_sub_admin' : 'company'),
      performedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Company',
      details: 'Interview slot cancelled by Company',
      timestamp: new Date()
    });
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

// @desc    Update an Interview Slot
// @route   PUT /api/companies/jobs/:jobId/interview-slots/:slotId
// @access  Private (Company / Sub-admin with MANAGE_INTERVIEWS)
exports.updateInterviewSlot = async (req, res) => {
  try {
    const company = await Company.findOne({ user: req.user._id });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const { jobId, slotId } = req.params;
    const {
      date,
      startTime,
      endTime,
      interviewMode,
      interviewDetails,
      interviewerName,
      averageTime,
      maxCandidates,
      notes,
      roundType,
      taggedCandidateId
    } = req.body;

    const Candidate = require('../models/Candidate');

    const slot = await InterviewSlot.findOne({
      _id: slotId,
      job: jobId,
      company: company._id
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Interview slot not found' });
    }

    if (slot.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Cannot edit a cancelled interview slot' });
    }

    const callingUserId = req.subAdminUser ? req.subAdminUser._id : req.user._id;
    const isSubAdmin = !!req.subAdminUser;
    const permissions = isSubAdmin ? req.subAdminUser.permissions : [];

    if (isSubAdmin && !permissions.includes('MANAGE_INTERVIEWS_ALL') && permissions.includes('MANAGE_INTERVIEWS_SELF')) {
      if (slot.createdBy && slot.createdBy.toString() !== callingUserId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to edit interview slots created by other team members.'
        });
      }
    }

    const changes = [];
    const before = {};
    const after = {};

    // Validate and update date
    if (date) {
      const newD = new Date(date);
      newD.setHours(0, 0, 0, 0);
      const oldD = new Date(slot.date);
      oldD.setHours(0, 0, 0, 0);
      if (newD.getTime() !== oldD.getTime()) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (newD < today) {
          return res.status(400).json({ success: false, message: 'Slot date cannot be in the past' });
        }
        const oldStr = oldD.toISOString().split('T')[0];
        const newStr = newD.toISOString().split('T')[0];
        changes.push(`Date changed from ${oldStr} to ${newStr}`);
        before.date = oldStr;
        after.date = newStr;
        slot.date = newD;
      }
    }

    // Validate and update start/end time
    if (startTime && startTime !== slot.startTime) {
      changes.push(`Start time changed from ${slot.startTime} to ${startTime}`);
      before.startTime = slot.startTime;
      after.startTime = startTime;
      slot.startTime = startTime;
    }

    if (endTime && endTime !== slot.endTime) {
      changes.push(`End time changed from ${slot.endTime} to ${endTime}`);
      before.endTime = slot.endTime;
      after.endTime = endTime;
      slot.endTime = endTime;
    }

    // Validate and update interview mode
    if (interviewMode && interviewMode !== slot.interviewMode) {
      changes.push(`Interview mode changed from ${slot.interviewMode} to ${interviewMode}`);
      before.interviewMode = slot.interviewMode;
      after.interviewMode = interviewMode;
      slot.interviewMode = interviewMode;
    }

    // Validate and update details
    if (interviewDetails !== undefined && interviewDetails !== slot.interviewDetails) {
      changes.push(`Interview details updated`);
      before.interviewDetails = slot.interviewDetails;
      after.interviewDetails = interviewDetails;
      slot.interviewDetails = interviewDetails;
    }

    // Interviewer name
    if (interviewerName !== undefined && interviewerName !== slot.interviewerName) {
      changes.push(`Interviewer changed from "${slot.interviewerName || 'N/A'}" to "${interviewerName}"`);
      before.interviewerName = slot.interviewerName;
      after.interviewerName = interviewerName;
      slot.interviewerName = interviewerName;
    }

    // Average time
    if (averageTime && Number(averageTime) !== slot.averageTime) {
      changes.push(`Average time changed from ${slot.averageTime}m to ${averageTime}m`);
      before.averageTime = slot.averageTime;
      after.averageTime = Number(averageTime);
      slot.averageTime = Number(averageTime);
    }

    // Notes
    if (notes !== undefined && notes !== slot.notes) {
      changes.push(`Notes updated`);
      before.notes = slot.notes;
      after.notes = notes;
      slot.notes = notes;
    }

    // Round type
    if (roundType && roundType !== slot.roundType) {
      changes.push(`Round step changed from ${slot.roundType} to ${roundType}`);
      before.roundType = slot.roundType;
      after.roundType = roundType;
      slot.roundType = roundType;
    }

    // Candidate Tagging / Untagging / Switching
    const currentTaggedId = slot.candidateId?.toString() || (slot.isTagged ? slot.bookedCandidates?.[0]?.candidate?.toString() : null);
    const newTaggedId = taggedCandidateId ? taggedCandidateId.toString() : null;

    if (newTaggedId !== currentTaggedId) {
      // If there was an old tagged candidate, untag them
      if (currentTaggedId) {
        const oldCand = await Candidate.findById(currentTaggedId);
        if (oldCand && oldCand.assignedSlot?.toString() === slot._id.toString()) {
          oldCand.assignedSlot = null;
          oldCand.status = 'SHORTLISTED';
          for (let i = 0; i < (oldCand.rounds || []).length; i++) {
            const r = oldCand.rounds[i];
            if (['SLOT_ASSIGNED', 'SLOT_DETAILS_SHARED'].includes(r.status)) {
              r.status = 'SHORTLISTED';
              r.slots = [];
              break;
            }
          }
          oldCand.statusHistory.push({
            status: 'SHORTLISTED',
            changedBy: req.user._id,
            changedAt: new Date(),
            changedByRole: 'COMPANY',
            notes: `Slot allotment removed during slot edit by Company`
          });
          await oldCand.save();
          changes.push(`Untagged candidate ${oldCand.firstName} ${oldCand.lastName}`);
          before.taggedCandidate = `${oldCand.firstName} ${oldCand.lastName}`;
        }
      }

      // If new candidate is to be tagged
      if (newTaggedId) {
        const newCand = await Candidate.findOne({ _id: newTaggedId, job: jobId });
        if (!newCand) {
          return res.status(404).json({ success: false, message: 'New candidate to tag was not found for this job' });
        }

        // Validate consent
        if (
          newCand.status === 'CONSENT_PENDING' ||
          newCand.status === 'CONSENT_SENT' ||
          newCand.status === 'CONSENT_DENIED' ||
          newCand.status === 'DRAFT' ||
          newCand.whatsappConsent?.status === 'PENDING' ||
          newCand.whatsappConsent?.status === 'DENIED' ||
          newCand.consent?.consentStatus === 'PENDING_CONFIRMATION' ||
          newCand.consent?.consentStatus === 'DENIED'
        ) {
          return res.status(400).json({
            success: false,
            message: `Candidate ${newCand.firstName} ${newCand.lastName} is pending consent and cannot be tagged.`
          });
        }

        // Validate shortlisted
        const allowedStatuses = [
          'SHORTLISTED',
          'SLOTS_NOT_PUBLISHED',
          'SLOTS_PUBLISHED',
          'ROUND_SELECTED_NEXT',
          'ROUND_SELECTED_DIRECT_HR',
          'HR_ROUND_PENDING',
          'RESCHEDULE_REQUESTED',
          'ASSESSMENT_PASSED'
        ];
        if (!allowedStatuses.includes(newCand.status)) {
          return res.status(400).json({
            success: false,
            message: `Candidate ${newCand.firstName} ${newCand.lastName} is not shortlisted or eligible for interview scheduling (status: ${newCand.status}).`
          });
        }

        // Check if candidate already has active assigned slot elsewhere in current round
        if (['SLOT_ASSIGNED', 'SLOT_DETAILS_SHARED', 'INTERVIEW_CONFIRMED'].includes(newCand.status)) {
          const existingTaggedSlot = await InterviewSlot.findOne({
            job: jobId,
            _id: { $ne: slot._id },
            status: { $ne: 'CANCELLED' },
            ...(slot.roundType ? { roundType: slot.roundType } : {}),
            $or: [
              { candidateId: newCand._id },
              { 'bookedCandidates.candidate': newCand._id },
              ...(newCand.assignedSlot ? [{ _id: newCand.assignedSlot }] : [])
            ]
          });
          if (existingTaggedSlot) {
            return res.status(400).json({
              success: false,
              message: `Candidate ${newCand.firstName} ${newCand.lastName} is already tagged to another active interview slot (${existingTaggedSlot.startTime} - ${existingTaggedSlot.endTime}).`
            });
          }
        }

        slot.isTagged = true;
        slot.candidateId = newCand._id;
        slot.maxCandidates = 1;
        slot.availableSpots = 0;
        slot.status = 'FULL';
        slot.bookedCandidates = [{
          candidate: newCand._id,
          partner: newCand.submittedBy,
          bookedAt: new Date(),
          bookingStatus: 'BOOKED'
        }];

        newCand.assignedSlot = slot._id;
        newCand.status = 'SLOT_ASSIGNED';
        for (let i = 0; i < (newCand.rounds || []).length; i++) {
          const r = newCand.rounds[i];
          if (['SLOTS_NOT_PUBLISHED', 'SLOTS_PUBLISHED', 'SHORTLISTED', 'RESCHEDULE_REQUESTED'].includes(r.status)) {
            r.status = 'SLOT_ASSIGNED';
            r.slots = [{
              date: slot.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              timezone: slot.timezone || 'Asia/Kolkata',
              mode: slot.interviewMode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL',
              interviewerName: slot.interviewerName || '',
              capacity: 1,
              bookedBy: newCand.submittedBy,
              bookedAt: new Date(),
              details: {
                meetingLink: slot.interviewMode === 'Virtual' ? (slot.interviewDetails || '') : '',
                address: slot.interviewMode === 'Face-to-Face' ? (slot.interviewDetails || '') : '',
                pointOfContact: {
                  name: slot.interviewerName || '',
                  phone: '',
                  email: ''
                }
              }
            }];
            break;
          }
        }
        newCand.statusHistory.push({
          status: 'SLOT_ASSIGNED',
          changedBy: req.user._id,
          changedAt: new Date(),
          changedByRole: 'COMPANY',
          notes: `Assigned to slot (${slot.startTime} - ${slot.endTime}) during slot edit by Company`
        });
        await newCand.save();

        changes.push(`Allotted slot to candidate ${newCand.firstName} ${newCand.lastName}`);
        after.taggedCandidate = `${newCand.firstName} ${newCand.lastName}`;
      } else {
        // Just untagged, now open to pool
        slot.isTagged = false;
        slot.candidateId = null;
        slot.bookedCandidates = [];
        const newMax = maxCandidates ? Math.max(1, Number(maxCandidates)) : 1;
        slot.maxCandidates = newMax;
        slot.availableSpots = newMax;
        slot.status = 'ACTIVE';
        changes.push(`Slot opened to general candidate pool (Capacity: ${newMax})`);
        after.taggedCandidate = null;
      }
    } else if (slot.isTagged && slot.candidateId) {
      // Candidate stayed the same, but slot details (date/time/mode/details) might have changed
      const cand = await Candidate.findById(slot.candidateId);
      if (cand && (before.date || before.startTime || before.endTime || before.interviewMode || before.interviewDetails || before.interviewerName)) {
        for (let i = 0; i < (cand.rounds || []).length; i++) {
          const r = cand.rounds[i];
          if (r.slots && r.slots.length > 0) {
            r.slots[0].date = slot.date;
            r.slots[0].startTime = slot.startTime;
            r.slots[0].endTime = slot.endTime;
            r.slots[0].mode = slot.interviewMode === 'Face-to-Face' ? 'FACE_TO_FACE' : 'VIRTUAL';
            r.slots[0].interviewerName = slot.interviewerName || '';
            if (r.slots[0].details) {
              r.slots[0].details.meetingLink = slot.interviewMode === 'Virtual' ? (slot.interviewDetails || '') : '';
              r.slots[0].details.address = slot.interviewMode === 'Face-to-Face' ? (slot.interviewDetails || '') : '';
              if (r.slots[0].details.pointOfContact) {
                r.slots[0].details.pointOfContact.name = slot.interviewerName || '';
              }
            }
            break;
          }
        }
        if (cand.interviewConfig) {
          cand.interviewConfig.mode = slot.interviewMode;
          cand.interviewConfig.details = slot.interviewDetails || '';
          cand.interviewConfig.interviewer = slot.interviewerName || '';
        }
        cand.statusHistory.push({
          status: cand.status,
          changedBy: req.user._id,
          changedAt: new Date(),
          changedByRole: 'COMPANY',
          notes: `Slot details updated by Company: ${changes.join(', ')}`
        });
        await cand.save();
      }
    } else if (!slot.isTagged && maxCandidates !== undefined) {
      // Normal untagged slot capacity update
      const newMax = Math.max(1, Number(maxCandidates));
      const activeBookings = (slot.bookedCandidates || []).filter(b => b.bookingStatus === 'BOOKED').length;
      if (newMax < activeBookings) {
        return res.status(400).json({
          success: false,
          message: `Cannot set capacity to ${newMax} when ${activeBookings} candidate(s) are already booked.`
        });
      }
      if (newMax !== slot.maxCandidates) {
        changes.push(`Capacity changed from ${slot.maxCandidates} to ${newMax}`);
        before.maxCandidates = slot.maxCandidates;
        after.maxCandidates = newMax;
        slot.maxCandidates = newMax;
        slot.availableSpots = newMax - activeBookings;
        if (slot.availableSpots === 0) {
          slot.status = 'FULL';
        } else if (slot.status === 'FULL') {
          slot.status = 'ACTIVE';
        }
      }
    }

    if (changes.length === 0) {
      return res.json({ success: true, message: 'No changes detected', data: slot });
    }

    // Append to activityLogs
    slot.activityLogs = slot.activityLogs || [];
    slot.activityLogs.push({
      action: 'UPDATED',
      performedBy: req.user._id,
      performedByRole: isSubAdmin ? 'company_sub_admin' : 'company',
      performedByName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'Company',
      details: changes.join('; '),
      changes: { before, after },
      timestamp: new Date()
    });

    await slot.save();

    res.json({
      success: true,
      message: 'Interview slot updated successfully',
      data: slot
    });
  } catch (error) {
    console.error('[COMPANY UPDATE SLOT] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update interview slot', error: error.message });
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

    // Helper to get active round info
    const getActiveRoundInfo = (c) => {
      const status = c.status;
      if (status === 'SHORTLISTED' || status === 'REJECTED') return null;
      const hrStates = ['HR_ROUND_PENDING', 'HR_SELECTED', 'HR_REJECTED', 'HR_ON_HOLD'];
      if (hrStates.includes(status)) {
        const idx = c.rounds.findIndex(r => r.roundType === 'HR_ROUND');
        if (idx !== -1) return { index: idx, round: c.rounds[idx] };
      }
      const assessmentStates = ['ASSESSMENT_PENDING', 'ASSESSMENT_LINK_SENT', 'ASSESSMENT_LINK_COMPLETE'];
      if (assessmentStates.includes(status)) {
        const idx = c.rounds.findIndex(r => r.roundType === 'ASSESSMENT');
        if (idx !== -1) return { index: idx, round: c.rounds[idx] };
      }
      const offerStates = ['OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'ONBOARDING'];
      if (offerStates.includes(status)) return null;
      for (let i = 0; i < c.rounds.length; i++) {
        const r = c.rounds[i];
        const L_STATES = [
          'SLOTS_NOT_PUBLISHED',
          'SLOTS_PUBLISHED',
          'SLOT_ASSIGNED',
          'RESCHEDULE_REQUESTED',
          'SLOT_DETAILS_SHARED',
          'INTERVIEW_CONDUCTED',
          'ROUND_ON_HOLD'
        ];
        if (L_STATES.includes(r.status)) return { index: i, round: r };
      }
      return null;
    };

    const activeInfo = getActiveRoundInfo(candidate);
    if (activeInfo) {
      if (activeInfo.round.slots && activeInfo.round.slots.length > 0) {
        activeInfo.round.slots[0].details = {
          meetingLink: mode === "Virtual" ? details : "",
          address: mode !== "Virtual" ? details : "",
          pointOfContact: {
            name: interviewer || "",
            phone: "",
            email: ""
          }
        };
      }
      activeInfo.round.status = "SLOT_DETAILS_SHARED";
    }

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

    candidate.status = "SLOT_DETAILS_SHARED";
    candidate.statusHistory.push({
      status: "SLOT_DETAILS_SHARED",
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
    if (!['DRAFT', 'REJECTED'].includes(job.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit job with status: ${job.status}`,
        currentStatus: job.status
      });
    }

    // Validate required fields are complete before approval submit
    const missingFields = [];
    if (!job.title || !job.title.trim() || job.title === 'Untitled Job') missingFields.push('Title');
    if (!job.description || !job.description.trim()) missingFields.push('Description');
    if (!job.category || !job.category.trim()) missingFields.push('Category');
    if (!job.subCategory && !job.subcategory) missingFields.push('Sub Category');
    if (!job.location?.city || (Array.isArray(job.location.city) && job.location.city.length === 0)) missingFields.push('City');
    if (!job.location?.isRemote && !job.location?.isHybrid && !job.location?.isOnSite) missingFields.push('Job Type');
    if (!job.skills?.required || job.skills.required.length === 0) missingFields.push('Mandatory Skills');
    if (!job.education?.minimum || (Array.isArray(job.education.minimum) && job.education.minimum.length === 0)) missingFields.push('Qualification');
    if (!job.applicationDeadline) missingFields.push('Application Deadline');

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot submit for approval. Please complete mandatory fields: ${missingFields.join(', ')}`,
        missingFields
      });
    }

    // Update job status
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
        status: 'PENDING_APPROVAL',
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
    if (job.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Cannot request edit on job with status: ${job.status}. Only ACTIVE jobs can be edited.`,
        hint: job.status === 'DRAFT' ? 'You can edit this job directly.' : 'Wait for current approval process to complete.'
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

    // ✅ Enforce vacancies > 0 validation on requested changes
    if (requestedChanges && requestedChanges.vacancies) {
      const newVacancies = requestedChanges.vacancies.new;
      if (newVacancies !== undefined && (Number(newVacancies) <= 0 || !Number.isInteger(Number(newVacancies)))) {
        return res.status(400).json({
          success: false,
          message: "Requested changes for vacancies must be a positive integer greater than 0."
        });
      }
    }

    // ✅ Enforce salary >= 0 validation on requested changes
    if (requestedChanges && requestedChanges.salary) {
      const newSalary = requestedChanges.salary.new;
      if (newSalary) {
        if (newSalary.min !== undefined && Number(newSalary.min) < 0) {
          return res.status(400).json({
            success: false,
            message: "Requested changes for salary minimum must be greater than or equal to 0."
          });
        }
        if (newSalary.max !== undefined && Number(newSalary.max) < 0) {
          return res.status(400).json({
            success: false,
            message: "Requested changes for salary maximum must be greater than or equal to 0."
          });
        }
      }
    }

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
    const jobPlain = job.toObject({ virtuals: false, getters: true });

    for (const [field, change] of Object.entries(requestedChanges)) {
      if (change.old === undefined || change.new === undefined) {
        invalidFields.push(`${field}: Must provide both 'old' and 'new' values`);
        continue;
      }

      // Check if field exists in the Job schema or is screeningQuestions
      const pathExists = field === 'screeningQuestions' ||
        Job.schema.path(field) !== undefined ||
        Object.keys(Job.schema.paths).some(p => p.startsWith(field + '.'));

      if (!pathExists) {
        invalidFields.push(`${field}: Field does not exist in job`);
        continue;
      }

      // Special handling for screeningQuestions (decoupled from Job schema paths)
      if (field === 'screeningQuestions') {
        if (!valuesAreEqual(change.old, change.new)) {
          validatedChanges[field] = change;
        }
        continue;
      }

      // Get plain currentValue from the job
      const currentValue = field.split('.').reduce((obj, key) => obj?.[key], jobPlain);

      // Normalize current value or old value if either is empty/null/undefined
      let normalizedCurrent = currentValue;
      if (normalizedCurrent === undefined || normalizedCurrent === null) {
        if (Array.isArray(change.old)) {
          normalizedCurrent = [];
        } else if (typeof change.old === 'object' && change.old !== null) {
          normalizedCurrent = {};
        } else if (typeof change.old === 'number') {
          normalizedCurrent = 0;
        } else {
          normalizedCurrent = '';
        }
      }

      // Check if old value matches current (using our robust comparison helper)
      if (!valuesAreEqual(normalizedCurrent, change.old)) {
        // If it doesn't match, instead of returning an error and blocking, we automatically
        // align the old value to the actual currentValue in the database.
        // This ensures the edit request proceeds smoothly and the admin gets the correct diff.
        change.old = currentValue !== undefined ? currentValue : null;
      }

      // Ensure required category field is not submitted as empty string or null
      if (field === 'category') {
        if (!change.new || typeof change.new !== 'string' || !change.new.trim()) {
          change.new = (typeof currentValue === 'string' && currentValue.trim()) ? currentValue.trim() : (typeof change.old === 'string' && change.old.trim()) ? change.old.trim() : 'Other';
        }
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
    job.status = 'EDIT_REQUESTED';
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
          status: job.status,
          canRequestEdit: job.status === 'ACTIVE' && stats.pending === 0
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

    if (otherPending === 0 && job.status === 'EDIT_REQUESTED') {
      job.status = 'ACTIVE';
      await job.save();
    }

    res.json({
      success: true,
      message: 'Edit request cancelled successfully',
      data: {
        editRequestId: editRequest._id,
        jobStatus: job.status
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

    if (!isWorkEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Please use an official company work email address.'
      });
    }

    const ownerEmail = req.user?.email || '';
    const ownerDomain = ownerEmail.includes('@') ? ownerEmail.split('@')[1].toLowerCase().trim() : '';
    const subAdminDomain = normalizedEmail.includes('@') ? normalizedEmail.split('@')[1].toLowerCase().trim() : '';

    if (ownerDomain && subAdminDomain && ownerDomain !== subAdminDomain) {
      return res.status(400).json({
        success: false,
        message: `Sub-admin email domain (@${subAdminDomain}) must match your company's registered email domain (@${ownerDomain}).`
      });
    }

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

// ==================== SCREENING QUESTIONS ====================

/**
 * @desc   Add/replace all screening questions for a job
 * @route  POST /api/companies/jobs/:jobId/screening-questions
 * @access Company
 */
exports.saveJobScreeningQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    let company = await Company.findOne({ user: req.user._id });
    if (!company && req.user.company) {
      company = await Company.findById(req.user.company);
    }
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const { questions } = req.body; // Array of { questionText, answerType, idealAnswer, isRequired }

    // Verify job belongs to this company
    const job = await Job.findOne({ _id: jobId, company: company._id });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // For active jobs, screening questions follow the edit request flow only internally
    // (questions themselves can be changed freely since they are not part of the job edit workflow)

    if (!Array.isArray(questions)) {
      return res.status(400).json({ success: false, message: 'questions must be an array' });
    }

    // Validate each question
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.questionText?.trim()) {
        return res.status(400).json({ success: false, message: `Question ${i + 1}: text is required` });
      }
      if (!['yes_no', 'numeric'].includes(q.answerType)) {
        return res.status(400).json({ success: false, message: `Question ${i + 1}: answerType must be yes_no or numeric` });
      }
      if (q.answerType === 'yes_no' && !['yes', 'no'].includes(q.idealAnswer)) {
        return res.status(400).json({ success: false, message: `Question ${i + 1}: idealAnswer for yes_no must be "yes" or "no"` });
      }
      if (q.answerType === 'numeric' && (isNaN(Number(q.idealAnswer)) || q.idealAnswer === '')) {
        return res.status(400).json({ success: false, message: `Question ${i + 1}: idealAnswer for numeric must be a valid number` });
      }
    }

    // Delete existing questions for this job and re-create
    await ScreeningQuestion.deleteMany({ job: jobId });

    const created = await ScreeningQuestion.insertMany(
      questions.map((q, idx) => ({
        job: jobId,
        questionText: q.questionText.trim(),
        answerType: q.answerType,
        idealAnswer: String(q.idealAnswer),
        isRequired: q.isRequired !== false, // default true
        createdBy: req.user._id,
        order: idx
      }))
    );

    return res.json({
      success: true,
      message: 'Screening questions saved successfully',
      data: { questions: created }
    });
  } catch (error) {
    console.error('saveJobScreeningQuestions error:', error);
    res.status(500).json({ success: false, message: 'Failed to save screening questions', error: error.message });
  }
};

/**
 * @desc   Get screening questions for a job (company side)
 * @route  GET /api/companies/jobs/:jobId/screening-questions
 * @access Company
 */
exports.getJobScreeningQuestions = async (req, res) => {
  try {
    const { jobId } = req.params;
    let company = await Company.findOne({ user: req.user._id });
    if (!company && req.user.company) {
      company = await Company.findById(req.user.company);
    }

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const job = await Job.findOne({ _id: jobId, company: company._id });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const questions = await ScreeningQuestion.find({ job: jobId }).sort({ order: 1 });

    return res.json({
      success: true,
      data: { questions }
    });
  } catch (error) {
    console.error('getJobScreeningQuestions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch screening questions', error: error.message });
  }
};

/**
 * @desc   Delete a single screening question
 * @route  DELETE /api/companies/jobs/:jobId/screening-questions/:qId
 * @access Company
 */
exports.deleteJobScreeningQuestion = async (req, res) => {
  try {
    const { jobId, qId } = req.params;
    let company = await Company.findOne({ user: req.user._id });
    if (!company && req.user.company) {
      company = await Company.findById(req.user.company);
    }
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const job = await Job.findOne({ _id: jobId, company: company._id });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    await ScreeningQuestion.deleteOne({ _id: qId, job: jobId });

    return res.json({ success: true, message: 'Question deleted' });
  } catch (error) {
    console.error('deleteJobScreeningQuestion error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete screening question', error: error.message });
  }
};

/* =========================================================================
   DEVELOPER API SETTINGS (COMPANY DASHBOARD)
========================================================================= */

const bcrypt = require('bcryptjs');
const Integration = require('../models/Integration');
const ApiClient = require('../models/ApiClient');

/**
 * Helper: Resolve Company model from req.user
 */
const resolveCompanyForUser = async (user) => {
  let company = await Company.findOne({ user: user._id });
  if (!company && user.company) {
    company = await Company.findById(user.company);
  }
  return company;
};

/**
 * @desc    Get Developer API status and summary for company
 * @route   GET /api/companies/developer-api/status
 * @access  Company
 */
exports.getDeveloperApiStatus = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const integration = await Integration.findOne({ company_id: company._id });
    const devAccounts = await DeveloperAccount.find({ company_id: company._id })
      .select('email name status last_login_at created_at')
      .sort({ created_at: -1 });
    
    // We can also count API keys instead of credentials count if needed, but not strictly required
    const credentialsCount = await ApiClient.countDocuments({
      company_id: company._id,
      status: 'ACTIVE'
    });

    return res.json({
      success: true,
      data: {
        enabled: integration?.status === 'ACTIVE',
        status: integration?.status || 'INACTIVE',
        environment: integration?.environment || 'PRODUCTION',
        last_sync_at: integration?.last_sync_at || null,
        active_credentials_count: credentialsCount,
        created_at: integration?.created_at || null,
        developer_accounts: devAccounts,
        developer_account: devAccounts[0] || null
      }
    });
  } catch (error) {
    console.error('getDeveloperApiStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch Developer API status', error: error.message });
  }
};

/**
 * @desc    Enable Developer API access for company
 * @route   POST /api/companies/developer-api/enable
 * @access  Company
 */
exports.enableDeveloperApi = async (req, res) => {
  try {
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    let integration = await Integration.findOne({ company_id: company._id });
    if (!integration) {
      integration = await Integration.create({
        company_id: company._id,
        user_id: req.user._id,
        status: 'ACTIVE'
      });
    } else {
      integration.status = 'ACTIVE';
      await integration.save();
    }

    return res.json({
      success: true,
      message: 'Developer API access enabled successfully',
      data: { status: 'ACTIVE' }
    });
  } catch (error) {
    console.error('enableDeveloperApi error:', error);
    res.status(500).json({ success: false, message: 'Failed to enable Developer API', error: error.message });
  }
};

/**
 * @desc    Disable Developer API access for company
 * @route   POST /api/companies/developer-api/disable
 * @access  Company
 */
exports.disableDeveloperApi = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const integration = await Integration.findOne({ company_id: company._id });
    if (integration) {
      integration.status = 'INACTIVE';
      await integration.save();
    }

    // Revoke all active API keys
    await ApiClient.updateMany(
      { company_id: company._id, status: 'ACTIVE' },
      { status: 'REVOKED' }
    );

    // Deactivate DeveloperAccount
    await DeveloperAccount.updateMany(
      { company_id: company._id, status: 'ACTIVE' },
      { status: 'INACTIVE' }
    );

    return res.json({
      success: true,
      message: 'Developer API access disabled, developer accounts deactivated, and existing credentials revoked',
      data: { status: 'INACTIVE' }
    });
  } catch (error) {
    console.error('disableDeveloperApi error:', error);
    res.status(500).json({ success: false, message: 'Failed to disable Developer API', error: error.message });
  }
};

/**
 * @desc    Create new Developer Account for the portal
 * @route   POST /api/companies/developer-api/account
 * @access  Company
 */
exports.createDeveloperAccount = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    let integration = await Integration.findOne({ company_id: company._id, status: 'ACTIVE' });
    if (!integration) {
      return res.status(400).json({
        success: false,
        message: 'Developer API access is disabled. Please enable it before creating a developer account.'
      });
    }

    const { email, name, password } = req.body;

    if (!email || !name || !password) {
      return res.status(400).json({ success: false, message: 'Email, name, and password are required' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long' });
    }

    const emailExists = await DeveloperAccount.findOne({ email: email.toLowerCase().trim() });
    if (emailExists) {
      return res.status(400).json({ success: false, message: 'This email is already used by another developer account' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const devAccount = await DeveloperAccount.create({
      company_id: company._id,
      integration_id: integration._id,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      password_hash: passwordHash,
      status: 'ACTIVE'
    });

    return res.status(201).json({
      success: true,
      message: 'Developer account created successfully.',
      data: {
        _id: devAccount._id,
        email: devAccount.email,
        name: devAccount.name,
        status: devAccount.status,
        created_at: devAccount.created_at
      }
    });
  } catch (error) {
    console.error('createDeveloperAccount error:', error);
    res.status(500).json({ success: false, message: 'Failed to create developer account', error: error.message });
  }
};

/**
 * @desc    Get Developer Accounts for the portal
 * @route   GET /api/companies/developer-api/account
 * @access  Company
 */
exports.getDeveloperAccount = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const devAccounts = await DeveloperAccount.find({ company_id: company._id })
      .select('email name status last_login_at created_at')
      .sort({ created_at: -1 });

    return res.json({
      success: true,
      data: {
        accounts: devAccounts,
        account: devAccounts[0] || null
      }
    });
  } catch (error) {
    console.error('getDeveloperAccount error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch developer account', error: error.message });
  }
};

/**
 * @desc    Reset Developer Account Password
 * @route   POST /api/companies/developer-api/account/reset-password
 * @access  Company
 */
exports.resetDeveloperPassword = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const new_password = req.body.new_password || req.body.newPassword;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long' });
    }

    const account_id = req.body.account_id || req.body.id;
    const email = req.body.email;
    const query = { company_id: company._id };
    if (account_id) {
      query._id = account_id;
    } else if (email) {
      query.email = email.toLowerCase().trim();
    }

    const devAccount = await DeveloperAccount.findOne(query);
    if (!devAccount) {
      return res.status(404).json({ success: false, message: 'Developer account not found' });
    }

    const salt = await bcrypt.genSalt(10);
    devAccount.password_hash = await bcrypt.hash(new_password, salt);
    await devAccount.save();

    return res.json({
      success: true,
      message: `Developer account password reset successfully for ${devAccount.email}`
    });
  } catch (error) {
    console.error('resetDeveloperPassword error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset developer password', error: error.message });
  }
};

/**
 * @desc    Toggle Developer Account Status
 * @route   PATCH /api/companies/developer-api/account/status
 * @access  Company
 */
exports.toggleDeveloperAccountStatus = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const account_id = req.body.account_id || req.body.id;
    const email = req.body.email;
    const query = { company_id: company._id };
    if (account_id) {
      query._id = account_id;
    } else if (email) {
      query.email = email.toLowerCase().trim();
    }

    const devAccount = await DeveloperAccount.findOne(query);
    if (!devAccount) {
      return res.status(404).json({ success: false, message: 'Developer account not found' });
    }

    devAccount.status = status;
    await devAccount.save();

    return res.json({
      success: true,
      message: `Developer account ${devAccount.email} status updated to ${status}`,
      data: { status: devAccount.status, _id: devAccount._id }
    });
  } catch (error) {
    console.error('toggleDeveloperAccountStatus error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle developer account status', error: error.message });
  }
};

/**
 * @desc    Delete Developer Account
 * @route   DELETE /api/companies/developer-api/account/:id
 * @access  Company
 */
exports.deleteDeveloperAccount = async (req, res) => {
  try {
    const DeveloperAccount = require('../models/DeveloperAccount');
    const company = await resolveCompanyForUser(req.user);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const { id } = req.params;
    const devAccount = await DeveloperAccount.findOneAndDelete({
      _id: id,
      company_id: company._id
    });

    if (!devAccount) {
      return res.status(404).json({ success: false, message: 'Developer account not found' });
    }

    return res.json({
      success: true,
      message: `Developer account ${devAccount.email} deleted successfully`
    });
  } catch (error) {
    console.error('deleteDeveloperAccount error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete developer account', error: error.message });
  }
};

