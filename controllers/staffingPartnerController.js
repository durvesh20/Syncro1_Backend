// backend/controllers/staffingPartnerController.js
const StaffingPartner = require("../models/StaffingPartner");
const User = require("../models/User");
const Job = require("../models/Job");
const Candidate = require("../models/Candidate");
const Company = require("../models/Company");
const duplicateDetection = require("../services/duplicateDetectionService");
const notificationEngine = require("../services/notificationEngine");
const jobAccessService = require("../services/jobAccessService");
const candidateScoringService = require("../services/candidateScoringService");

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
      employeeCount,
    } = req.body;

    let finalOperatingAddress = operatingAddress;
    if (operatingAddress?.sameAsRegistered && registeredOfficeAddress) {
      finalOperatingAddress = {
        ...registeredOfficeAddress,
        sameAsRegistered: true,
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
      employeeCount,
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

    const ipAddress =
      req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const timestamp = new Date();

    const requiredClauses = [
      "noCvRecycling",
      "noFakeProfiles",
      "noDoubleRepresentation",
      "vendorCodeOfConduct",
      "dataPrivacyPolicy",
      "candidateConsentPolicy",
      "nonCircumventionClause",
      "commissionPayoutTerms",
      "replacementBackoutLiability",
    ];

    const allAccepted = requiredClauses.every(
      (clause) => syncrotechAgreement && syncrotechAgreement[clause] === true,
    );

    if (!allAccepted) {
      return res.status(400).json({
        success: false,
        message: "All compliance clauses must be accepted",
        data: {
          required: requiredClauses,
          received: syncrotechAgreement,
        },
      });
    }

    const complianceData = {
      syncrotechAgreement: {},
    };

    requiredClauses.forEach((clause) => {
      complianceData.syncrotechAgreement[clause] = {
        accepted: true,
        acceptedAt: timestamp,
        acceptedIp: ipAddress,
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

// @desc    Update Commercial & Payout Details
// @route   PUT /api/staffing-partners/profile/commercial-details
exports.updateCommercialDetails = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const {
      payoutEntityName,
      gstRegistration,
      tdsApplicable,
      bankAccountHolderName,
      bankName,
      accountNumber,
      ifscCode,
    } = req.body;

    partner.commercialDetails = {
      ...partner.commercialDetails,
      payoutEntityName,
      gstRegistration,
      tdsApplicable,
      bankAccountHolderName,
      bankName,
      accountNumber,
      ifscCode,
    };

    partner.profileCompletion.commercialDetails = true;
    await partner.save();

    res.json({
      success: true,
      message: "Commercial details updated successfully",
      data: partner.commercialDetails,
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

    if (partner.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to manage team members",
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

    if (partner.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to add team members",
      });
    }

    const { name, email, mobile, role, permissions } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required",
      });
    }

    const existingMember = partner.teamAccess.teamMembers.find(
      (m) => m.email === email,
    );

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: "Team member with this email already exists",
      });
    }

    partner.teamAccess.isTeamEnabled = true;
    partner.teamAccess.teamMembers.push({
      name,
      email,
      mobile,
      role: role || "Recruiter",
      permissions: permissions || {
        canViewJobs: true,
        canSubmitCandidates: true,
        canViewEarnings: false,
        canManageTeam: false,
      },
      addedAt: new Date(),
      isActive: true,
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

    if (partner.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to update team members",
      });
    }

    const { memberId } = req.params;
    const { name, email, mobile, role, permissions, isActive } = req.body;

    const memberIndex = partner.teamAccess.teamMembers.findIndex(
      (m) => m._id.toString() === memberId,
    );

    if (memberIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    if (email) {
      const existingMember = partner.teamAccess.teamMembers.find(
        (m) => m.email === email && m._id.toString() !== memberId,
      );

      if (existingMember) {
        return res.status(400).json({
          success: false,
          message: "Another team member with this email already exists",
        });
      }
    }

    if (name) partner.teamAccess.teamMembers[memberIndex].name = name;
    if (email) partner.teamAccess.teamMembers[memberIndex].email = email;
    if (mobile) partner.teamAccess.teamMembers[memberIndex].mobile = mobile;
    if (role) partner.teamAccess.teamMembers[memberIndex].role = role;
    if (permissions)
      partner.teamAccess.teamMembers[memberIndex].permissions = permissions;
    if (typeof isActive === "boolean")
      partner.teamAccess.teamMembers[memberIndex].isActive = isActive;

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

    if (partner.verificationStatus !== "APPROVED") {
      return res.status(403).json({
        success: false,
        message: "Partner must be verified to remove team members",
      });
    }

    const { memberId } = req.params;

    const memberExists = partner.teamAccess.teamMembers.some(
      (m) => m._id.toString() === memberId,
    );

    if (!memberExists) {
      return res.status(404).json({
        success: false,
        message: "Team member not found",
      });
    }

    partner.teamAccess.teamMembers = partner.teamAccess.teamMembers.filter(
      (m) => m._id.toString() !== memberId,
    );

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
        activeMembers: partner.teamAccess.teamMembers.filter((m) => m.isActive)
          .length,
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

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner profile not found'
      });
    }

    if (['PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(partner.verificationStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Profile already submitted for verification'
      });
    }

    // Check all required sections
    const required = [
      'basicInfo',
      'firmDetails',
      'Syncro1Competency',
      'geographicReach',
      'compliance',
      'commercialDetails',
      'documents'
    ];

    const incomplete = required.filter(
      section => !partner.profileCompletion?.[section]
    );

    if (incomplete.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required sections before submitting',
        incompleteSections: incomplete,
        hint: `Missing: ${incomplete.join(', ')}`
      });
    }

    // Bank check
    if (!partner.commercialDetails?.accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Bank account details are required for payouts'
      });
    }

    // Documents check
    const requiredDocs = ['panCard', 'gstCertificate'];

    const missingDocs = requiredDocs.filter(
      doc => !partner.documents?.[doc]
    );

    if (missingDocs.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Required documents missing',
        missingDocuments: missingDocs,
        hint: 'PAN card and GST certificate are mandatory'
      });
    }

    // Agreement check
    if (!partner.agreement?.agreed) {
      return res.status(400).json({
        success: false,
        message: 'Please read and accept the Master Staffing Partner Agreement before submitting'
      });
    }

    if (!partner.agreement?.pdfUrl) {
      return res.status(400).json({
        success: false,
        message: 'Agreement PDF not found. Please accept the agreement again.'
      });
    }

    // Update status
    partner.verificationStatus = 'UNDER_REVIEW';
    partner.submittedAt = new Date();
    await partner.save();

    // Update user
    const user = await User.findById(req.user._id);
    user.status = 'UNDER_VERIFICATION';
    await user.save();


    // ================= EMAIL (non-blocking safe execution) =================
    const sendAgreementEmail = async () => {
      try {
        const emailService = require('../services/emailService');

        await emailService.sendEmail({
          to: user.email,
          subject: '📋 Syncro1 — Your Signed Agreement Copy',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                          color: white; padding: 30px; border-radius: 10px 10px 0 0;">
                <h1 style="margin: 0; font-size: 22px;">Syncro1</h1>
                <p style="margin: 5px 0 0 0; opacity: 0.9;">
                  Master Staffing Partner Agreement
                </p>
              </div>

              <div style="padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb;">
                
                <p>Dear ${partner.firstName} ${partner.lastName},</p>

                <p>
                  Thank you for accepting the Master Staffing Partner Agreement and submitting your profile for verification.
                </p>

                <p>Please find your signed agreement copy below:</p>

                <div style="text-align: center; margin: 30px 0;">
                  <a href="${partner.agreement.pdfUrl}"
                     style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white; padding: 14px 28px;
                            text-decoration: none; border-radius: 8px;
                            font-weight: bold; display: inline-block;">
                    📥 Download Agreement
                  </a>
                </div>

                <div style="background: #dbeafe; border-left: 4px solid #3b82f6;
                            padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <strong>Agreement Details</strong><br><br>

                  <strong>Firm:</strong> ${partner.firmName}<br>
                  <strong>Signed by:</strong> ${partner.agreement.digitalSignature}<br>
                  <strong>Date:</strong> ${new Date(partner.agreement.agreedAt).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })}<br>
                  <strong>IP Address:</strong> ${partner.agreement.agreedIp || 'N/A'}
                </div>

                <div style="background: #fef3c7; border-left: 4px solid #f59e0b;
                            padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <strong>What happens next?</strong><br>
                  Our verification team will review your profile within 24–48 hours.
                </div>

                <p>Best regards,<br><strong>Team Syncro1</strong></p>
              </div>

              <div style="text-align: center; padding: 20px;
                          color: #6b7280; font-size: 12px;
                          background: #f3f4f6; border-radius: 0 0 10px 10px;">
                <p>© ${new Date().getFullYear()} Syncro1 Technologies Pvt Ltd.</p>
              </div>

            </div>
          `
        });

        console.log(`[AGREEMENT] Email sent → ${user.email}`);
      } catch (err) {
        console.error(`[AGREEMENT] Email failed: ${err.message}`);
      }
    };

    // fire-and-forget (non-blocking)
    sendAgreementEmail();

    return res.json({
      success: true,
      message: 'Profile submitted for verification. Agreement copy sent to email.',
      data: {
        verificationStatus: partner.verificationStatus,
        submittedAt: partner.submittedAt,
        agreementAccepted: true
      }
    });

  } catch (error) {
    console.error('[PARTNER] Submit profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit profile',
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
        message: "Profile not found",
      });
    }

    const partnerPlan = partner.subscription?.plan || "FREE";

    const result = await jobAccessService.getAccessibleJobs(
      partner._id,
      partnerPlan,
      {
        page: req.query.page,
        limit: req.query.limit,
        category: req.query.category,
        location: req.query.location,
        experienceLevel: req.query.experienceLevel,
        employmentType: req.query.employmentType,
        salaryMin: req.query.salaryMin,
        salaryMax: req.query.salaryMax,
        search: req.query.search,
        sortBy: req.query.sortBy,
        isUrgent: req.query.urgentOnly,
      },
    );

    if (result.jobs.length === 0) {
      const totalActiveJobs = await Job.countDocuments({ status: "ACTIVE" });
      const jobsForPlan = await Job.countDocuments({
        status: "ACTIVE",
        eligiblePlans: { $in: result.partnerAccess.accessiblePlans },
      });

      return res.json({
        success: true,
        data: {
          ...result,
          debug: {
            totalActiveJobsOnPlatform: totalActiveJobs,
            jobsAccessibleByYourPlan: jobsForPlan,
            yourPlan: partnerPlan,
            plansYouCanAccess: result.partnerAccess.accessiblePlans,
            filtersApplied: Object.keys(req.query).filter(
              (k) => !["page", "limit"].includes(k) && req.query[k],
            ),
            suggestion:
              totalActiveJobs > 0 && jobsForPlan === 0
                ? `There are ${totalActiveJobs} active jobs, but none are available for the ${partnerPlan} plan. Consider upgrading your plan.`
                : jobsForPlan > 0
                  ? "Jobs exist for your plan but your filters are too restrictive. Try removing some filters."
                  : "No active jobs on the platform at the moment. Check back later.",
          },
        },
      });
    }

    res.json({
      success: true,
      data: result,
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

    const partnerPlan = partner.subscription?.plan || "FREE";
    if (
      job.eligiblePlans &&
      job.eligiblePlans.length > 0 &&
      !job.eligiblePlans.includes(partnerPlan)
    ) {
      return res.status(403).json({
        success: false,
        message: `This job requires ${job.eligiblePlans.join(" or ")} plan. You are on ${partnerPlan} plan.`,
        requiredPlans: job.eligiblePlans,
        currentPlan: partnerPlan,
      });
    }

    const {
      firstName,
      lastName,
      email,
      mobile,
      consent,
      profile,
      forceSubmit,
    } = req.body;

    if (!firstName || !lastName || !email || !mobile) {
      return res.status(400).json({
        success: false,
        message: "Please provide firstName, lastName, email, and mobile",
      });
    }

    if (!consent) {
      return res.status(400).json({
        success: false,
        message: "Candidate consent is required before submission",
      });
    }

    const duplicateCheck = await duplicateDetection.checkBeforeSubmission(
      { email, mobile },
      job._id,
      partner._id,
    );

    if (!duplicateCheck.canSubmit) {
      return res.status(409).json({
        success: false,
        message:
          duplicateCheck.blocks[0]?.message || "Duplicate submission blocked",
        data: {
          blocks: duplicateCheck.blocks,
          warnings: duplicateCheck.warnings,
        },
      });
    }

    const highSeverityWarnings = duplicateCheck.warnings.filter(
      (w) => w.severity === "high",
    );

    if (highSeverityWarnings.length > 0 && !forceSubmit) {
      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        message:
          "Potential issues detected. Review warnings and resubmit with forceSubmit: true to proceed.",
        data: {
          warnings: duplicateCheck.warnings,
        },
      });
    }

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
        ipAddress: req.ip,
      },
      profile: profile || {},
      status: "SUBMITTED",
      statusHistory: [
        {
          status: "SUBMITTED",
          changedBy: req.user._id,
          notes:
            duplicateCheck.warnings.length > 0
              ? `Submitted with ${duplicateCheck.warnings.length} warning(s)`
              : "Initial submission",
        },
      ],
    });

    await Job.findByIdAndUpdate(job._id, {
      $inc: { "metrics.applications": 1 },
    });
    await StaffingPartner.findByIdAndUpdate(partner._id, {
      $inc: { "metrics.totalSubmissions": 1 },
    });

    const company = await Company.findById(job.company).populate("user", "_id");

    if (company?.user) {
      await notificationEngine.send({
        recipientId: company.user._id,
        type: "NEW_CANDIDATE_SUBMITTED",
        title: `New candidate for "${job.title}"`,
        message: `${partner.firmName} submitted ${firstName} ${lastName} for the ${job.title} position. Review their profile in your dashboard.`,
        data: {
          entityType: "Candidate",
          entityId: candidate._id,
          actionUrl: `/company/jobs/${job._id}/candidates`,
          metadata: {
            partnerName: `${partner.firstName} ${partner.lastName}`,
            firmName: partner.firmName,
            candidateName: `${firstName} ${lastName}`,
            candidateExperience: profile?.totalExperience,
            candidateLocation: profile?.currentLocation,
          },
        },
        channels: {
          inApp: true,
          email: true,
        },
        priority: job.isUrgent ? "high" : "medium",
      });
    }

    res.status(201).json({
      success: true,
      message:
        duplicateCheck.warnings.length > 0
          ? "Candidate submitted with warnings"
          : "Candidate submitted successfully",
      data: {
        candidate,
        warnings: duplicateCheck.warnings,
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

    const { limit = 10, status, cursor } = req.query;

    const query = { submittedBy: partner._id };
    if (status) query.status = status;
    if (cursor) query._id = { $lt: cursor };

    const submissions = await Candidate.find(query)
      .populate("job", "title company commission")
      .populate("company", "companyName")
      .sort({ _id: -1 })
      .limit(parseInt(limit) + 1);

    const hasMore = submissions.length > limit;
    const results = hasMore ? submissions.slice(0, limit) : submissions;
    const nextCursor =
      results.length > 0 ? results[results.length - 1]._id : null;

    res.json({
      success: true,
      data: {
        submissions: results,
        pagination: {
          nextCursor,
          hasMore,
          limit: parseInt(limit),
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
        message: 'Profile not found'
      });
    }

    const recentSubmissions = await Candidate.find({ submittedBy: partner._id })
      .populate('job', 'title')
      .populate('company', 'companyName')
      .sort({ createdAt: -1 })
      .limit(5);

    const statusBreakdown = await Candidate.aggregate([
      { $match: { submittedBy: partner._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const availableJobsCount = await Job.countDocuments({
      status: 'ACTIVE',
      eligiblePlans: partner.subscription?.plan || 'FREE'
    });

    const profileCompletion = partner.profileCompletion;
    const completedSections = Object.values(profileCompletion).filter(Boolean).length;
    const totalSections = Object.keys(profileCompletion).length;
    const completionPercentage = Math.round((completedSections / totalSections) * 100);

    const Payout = require('../models/Payout');
    const earningsSummary = {
      totalEarnings: partner.metrics.totalEarnings || 0,
      pendingPayouts: partner.metrics.pendingPayouts || 0,
      eligiblePayouts: partner.metrics.eligiblePayouts || 0,
      paidOut: partner.metrics.paidOut || 0,
      totalPlacements: partner.metrics.totalPlacements || 0
    };

    const upcomingDate = new Date();
    upcomingDate.setDate(upcomingDate.getDate() + 30);

    const upcomingPayouts = await Payout.find({
      staffingPartner: partner._id,
      status: 'PENDING',
      'replacementGuarantee.endDate': {
        $gte: new Date(),
        $lte: upcomingDate
      }
    })
      .populate('candidate', 'firstName lastName')
      .sort({ 'replacementGuarantee.endDate': 1 })
      .limit(5);

    const recentPayouts = await Payout.find({
      staffingPartner: partner._id,
      status: { $in: ['PAID', 'ELIGIBLE', 'APPROVED'] }
    })
      .populate('candidate', 'firstName lastName')
      .sort({ updatedAt: -1 })
      .limit(5);

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
        earnings: {
          summary: earningsSummary,
          upcomingPayouts: upcomingPayouts.map(p => ({
            _id: p._id,
            candidate: `${p.candidate.firstName} ${p.candidate.lastName}`,
            amount: p.amount.netPayable,
            eligibleDate: p.replacementGuarantee.endDate,
            daysRemaining: p.getDaysRemaining()
          })),
          recentPayouts: recentPayouts.map(p => ({
            _id: p._id,
            candidate: `${p.candidate.firstName} ${p.candidate.lastName}`,
            amount: p.amount.netPayable,
            status: p.status,
            paidAt: p.payment?.paidAt
          }))
        },
        recentSubmissions,
        statusBreakdown,
        availableJobsCount
      }
    });
  } catch (error) {
    console.error('[PARTNER] Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard',
      error: error.message
    });
  }
};

// @desc    Get Earnings/Payouts
// @route   GET /api/staffing-partners/earnings
// ✅ SINGLE KEPT VERSION - payout model based
exports.getEarnings = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { page = 1, limit = 20, status } = req.query;
    const sanitizedPage = Math.max(1, parseInt(page));
    const sanitizedLimit = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const query = { staffingPartner: partner._id };
    if (status) query.status = status;

    const [payouts, total] = await Promise.all([
      Payout.find(query)
        .populate('candidate', 'firstName lastName')
        .populate('job', 'title')
        .populate('company', 'companyName')
        .populate('partnerInvoice', 'invoiceNumber status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit),
      Payout.countDocuments(query)
    ]);

    const enrichedPayouts = payouts.map(p => ({
      ...p.toObject(),
      daysRemaining: p.getDaysRemaining(),
      isEligible: p.checkEligibility(),
      candidateName: `${p.candidate.firstName} ${p.candidate.lastName}`
    }));

    const summary = {
      totalEarnings: partner.metrics.totalEarnings || 0,
      pendingPayouts: partner.metrics.pendingPayouts || 0,
      eligiblePayouts: partner.metrics.eligiblePayouts || 0,
      paidOut: partner.metrics.paidOut || 0,
      forfeitedAmount: partner.metrics.forfeitedAmount || 0,
      totalPlacements: partner.metrics.totalPlacements || 0
    };

    const statusBreakdown = await Payout.aggregate([
      { $match: { staffingPartner: partner._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: { $sum: '$amount.netPayable' }
        }
      }
    ]);

    const upcomingDate = new Date();
    upcomingDate.setDate(upcomingDate.getDate() + 30);

    const upcomingEligible = await Payout.find({
      staffingPartner: partner._id,
      status: 'PENDING',
      'replacementGuarantee.endDate': {
        $gte: new Date(),
        $lte: upcomingDate
      }
    })
      .populate('candidate', 'firstName lastName')
      .populate('job', 'title')
      .sort({ 'replacementGuarantee.endDate': 1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        summary,
        statusBreakdown: statusBreakdown.reduce((acc, item) => {
          acc[item._id] = { count: item.count, amount: item.amount };
          return acc;
        }, {}),
        payouts: enrichedPayouts,
        upcomingEligible: upcomingEligible.map(p => ({
          _id: p._id,
          candidate: `${p.candidate.firstName} ${p.candidate.lastName}`,
          job: p.job.title,
          amount: p.amount.netPayable,
          eligibleDate: p.replacementGuarantee.endDate,
          daysRemaining: p.getDaysRemaining()
        })),
        pagination: {
          current: sanitizedPage,
          pages: Math.ceil(total / sanitizedLimit),
          total
        }
      }
    });
  } catch (error) {
    console.error('[PARTNER] Get earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings',
      error: error.message
    });
  }
};

// @desc    Get single payout details
// @route   GET /api/staffing-partners/earnings/:id
exports.getPayoutDetails = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const payout = await Payout.findOne({
      _id: req.params.id,
      staffingPartner: partner._id
    })
      .populate('candidate', 'firstName lastName email offer joining')
      .populate('job', 'title company')
      .populate('company', 'companyName')
      .populate('partnerInvoice');

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    res.json({
      success: true,
      data: {
        payout: {
          ...payout.toObject(),
          daysRemaining: payout.getDaysRemaining(),
          isEligible: payout.checkEligibility()
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payout details',
      error: error.message
    });
  }
};

// @desc    Get partner invoices
// @route   GET /api/staffing-partners/invoices
exports.getInvoices = async (req, res) => {
  try {
    const Invoice = require('../models/Invoice');
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { page = 1, limit = 20, status } = req.query;
    const sanitizedPage = Math.max(1, parseInt(page));
    const sanitizedLimit = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const query = {
      staffingPartner: partner._id,
      invoiceType: 'PARTNER_TO_SYNCRO1'
    };
    if (status) query.status = status;

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .populate('candidate', 'firstName lastName')
        .populate('job', 'title')
        .populate('company', 'companyName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit),
      Invoice.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        invoices,
        pagination: {
          current: sanitizedPage,
          pages: Math.ceil(total / sanitizedLimit),
          total
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message
    });
  }
};

// @desc    Get single invoice
// @route   GET /api/staffing-partners/invoices/:id
exports.getInvoice = async (req, res) => {
  try {
    const Invoice = require('../models/Invoice');
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const invoice = await Invoice.findOne({
      _id: req.params.id,
      staffingPartner: partner._id
    })
      .populate('candidate', 'firstName lastName email offer joining commission')
      .populate('job', 'title')
      .populate('company', 'companyName')
      .populate('linkedPayout');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    res.json({
      success: true,
      data: invoice
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: error.message
    });
  }
};

// @desc    Withdraw Candidate
// @route   PUT /api/staffing-partners/submissions/:id/withdraw
exports.withdrawCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const { reason } = req.body;

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner profile not found",
      });
    }

    const candidate = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id,
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: "Submission not found or does not belong to you",
      });
    }

    const candidateLifecycleService = require("../services/candidateLifecycleService");

    try {
      const updated = await candidateLifecycleService.updateStatus(
        candidate._id,
        "WITHDRAWN",
        req.user._id,
        "staffing_partner",
        reason || "Withdrawn by staffing partner",
      );

      res.json({
        success: true,
        message: "Candidate withdrawn successfully",
        data: {
          candidateId: updated._id,
          previousStatus: candidate.status,
          newStatus: "WITHDRAWN",
        },
      });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          success: false,
          message: error.message,
          currentStatus: candidate.status,
          allowedTransitions: error.allowedTransitions,
        });
      }
      throw error;
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Withdrawal failed",
      error: error.message,
    });
  }
};