// backend/controllers/staffingPartnerController.js
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const duplicateDetection = require('../services/duplicateDetectionService');
const notificationEngine = require('../services/notificationEngine');
const jobAccessService = require('../services/jobAccessService');
const candidateScoringService = require('../services/candidateScoringService');
const JobInterest = require('../models/JobInterest');
const InterviewSlot = require('../models/InterviewSlot');
const candidateQueueService = require('../services/candidateQueueService');
const whatsappService = require('../services/whatsappService');

// ============================================================
// PROFILE ROUTES
// ============================================================

// @desc    Get Staffing Partner Profile
// @route   GET /api/staffing-partners/profile
exports.getProfile = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({
      user: req.user._id
    }).populate('user', 'email mobile status emailVerified mobileVerified');

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

    const {
      firstName,
      lastName,
      firmName,
      designation,
      linkedinProfile,
      city,
      state,
      email,
      mobile
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
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
            message: 'Email is already registered by another user'
          });
        }

        // Custom domain check: only one staffing partner allowed per custom domain
        const domain = normalizedEmail.split('@')[1];
        const genericEmailDomains = new Set([
          'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
          'icloud.com', 'zoho.com', 'protonmail.com', 'yandex.com', 'proton.me',
          'mail.com', 'gmx.com', 'live.com', 'msn.com'
        ]);
        if (!genericEmailDomains.has(domain)) {
          const domainExists = await User.findOne({
            role: 'staffing_partner',
            email: new RegExp(`@${domain}$`, 'i'),
            _id: { $ne: req.user._id }
          });
          if (domainExists) {
            return res.status(400).json({
              success: false,
              message: `The email domain ${domain} is already registered by another Talent partner.`
            });
          }
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
            message: 'Mobile/WhatsApp number is already registered by another user'
          });
        }
        user.mobile = normalizedMobile;
      }
    }

    await user.save();

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

// @desc    Update Compliance & Ethical Declarations
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

    const { syncrotechAgreement, digitalSignature } = req.body;

    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const timestamp = new Date();

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
        message: 'All compliance clauses must be accepted',
        data: {
          required: requiredClauses,
          received: syncrotechAgreement
        }
      });
    }

    const complianceData = { syncrotechAgreement: {} };

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
      message: 'Compliance updated successfully',
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

// @desc    Update Commercial & Payout Details
// @route   PUT /api/staffing-partners/profile/commercial-details
exports.updateCommercialDetails = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const {
      payoutEntityName,
      gstRegistration,
      tdsApplicable,
      bankAccountHolderName,
      bankName,
      accountNumber,
      ifscCode
    } = req.body;

    partner.commercialDetails = {
      ...partner.commercialDetails,
      payoutEntityName,
      gstRegistration,
      tdsApplicable,
      bankAccountHolderName,
      bankName,
      accountNumber,
      ifscCode
    };

    partner.profileCompletion.commercialDetails = true;
    await partner.save();

    res.json({
      success: true,
      message: 'Commercial details updated successfully',
      data: partner.commercialDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Update failed',
      error: error.message
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
        message: 'Profile not found'
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Partner must be verified to manage team members'
      });
    }

    const { isTeamEnabled } = req.body;

    partner.teamAccess.isTeamEnabled = isTeamEnabled || false;
    await partner.save();

    res.json({
      success: true,
      message: 'Team access updated',
      data: partner.teamAccess
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
// @route   POST /api/staffing-partners/profile/team-access/member
exports.addTeamMember = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Partner must be verified to add team members'
      });
    }

    const { name, email, mobile, role, permissions } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    const existingMember = partner.teamAccess.teamMembers.find(
      m => m.email === email
    );

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: 'Team member with this email already exists'
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
      message: 'Team member added successfully',
      data: partner.teamAccess
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to add team member',
      error: error.message
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
        message: 'Profile not found'
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Partner must be verified to update team members'
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
        message: 'Team member not found'
      });
    }

    if (email) {
      const existingMember = partner.teamAccess.teamMembers.find(
        m => m.email === email && m._id.toString() !== memberId
      );

      if (existingMember) {
        return res.status(400).json({
          success: false,
          message: 'Another team member with this email already exists'
        });
      }
    }

    if (name) partner.teamAccess.teamMembers[memberIndex].name = name;
    if (email) partner.teamAccess.teamMembers[memberIndex].email = email;
    if (mobile) partner.teamAccess.teamMembers[memberIndex].mobile = mobile;
    if (role) partner.teamAccess.teamMembers[memberIndex].role = role;
    if (permissions) partner.teamAccess.teamMembers[memberIndex].permissions = permissions;
    if (typeof isActive === 'boolean') {
      partner.teamAccess.teamMembers[memberIndex].isActive = isActive;
    }

    await partner.save();

    res.json({
      success: true,
      message: 'Team member updated successfully',
      data: partner.teamAccess
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update team member',
      error: error.message
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
        message: 'Profile not found'
      });
    }

    if (partner.verificationStatus !== 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Partner must be verified to remove team members'
      });
    }

    const { memberId } = req.params;

    const memberExists = partner.teamAccess.teamMembers.some(
      m => m._id.toString() === memberId
    );

    if (!memberExists) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found'
      });
    }

    partner.teamAccess.teamMembers = partner.teamAccess.teamMembers.filter(
      m => m._id.toString() !== memberId
    );

    if (partner.teamAccess.teamMembers.length === 0) {
      partner.teamAccess.isTeamEnabled = false;
    }

    await partner.save();

    res.json({
      success: true,
      message: 'Team member removed successfully',
      data: partner.teamAccess
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to remove team member',
      error: error.message
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
        message: 'Profile not found'
      });
    }

    res.json({
      success: true,
      data: {
        isTeamEnabled: partner.teamAccess.isTeamEnabled,
        teamMembers: partner.teamAccess.teamMembers,
        totalMembers: partner.teamAccess.teamMembers.length,
        activeMembers: partner.teamAccess.teamMembers.filter(m => m.isActive).length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch team members',
      error: error.message
    });
  }
};

// @desc    Get Profile Completion Status
// @route   GET /api/staffing-partners/profile/completion
exports.getProfileCompletion = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id }).populate(
      'user',
      'emailVerified mobileVerified'
    );

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const completion = partner.profileCompletion ? (partner.profileCompletion.toObject ? partner.profileCompletion.toObject() : partner.profileCompletion) : {};
    
    // Force basicInfo to false if email or mobile is not verified
    if (!partner.user?.emailVerified || !partner.user?.mobileVerified) {
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
          completion.firmDetails &&
          completion.Syncro1Competency &&
          completion.geographicReach &&
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
        message: 'Partner profile not found'
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

    if (['VERIFIED', 'UNDER_REVIEW', 'APPROVED'].includes(partner.verificationStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Profile already submitted for verification'
      });
    }

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

    if (!partner.commercialDetails?.accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Bank account details are required for payouts'
      });
    }

    const requiredDocs = ['panCard', 'gstCertificate'];
    const missingDocs = requiredDocs.filter(doc => !partner.documents?.[doc]);

    if (missingDocs.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Required documents missing',
        missingDocuments: missingDocs,
        hint: 'PAN card and GST certificate are mandatory'
      });
    }

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

    partner.verificationStatus = 'UNDER_REVIEW';
    partner.submittedAt = new Date();
    await partner.save();

    user.status = 'UNDER_VERIFICATION';
    await user.save();

    // Send agreement copy email (fire and forget)
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
                <p style="margin: 5px 0 0 0; opacity: 0.9;">Master Staffing Partner Agreement</p>
              </div>
              <div style="padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb;">
                <p>Dear ${partner.firstName} ${partner.lastName},</p>
                <p>Thank you for accepting the Master Staffing Partner Agreement
                   and submitting your profile for verification.</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${partner.agreement.pdfUrl}"
                     style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white; padding: 14px 28px;
                            text-decoration: none; border-radius: 8px;
                            font-weight: bold; display: inline-block;">
                    📥 Download Agreement
                  </a>
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

// ============================================================
// JOBS ROUTES
// ============================================================

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

    const partnerPlan = partner.subscription?.plan || 'FREE';

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
        isUrgent: req.query.urgentOnly
      }
    );

    if (result.jobs.length === 0) {
      const totalActiveJobs = await Job.countDocuments({ status: 'ACTIVE' });
      const jobsForPlan = await Job.countDocuments({
        status: 'ACTIVE',
        eligiblePlans: { $in: result.partnerAccess.accessiblePlans }
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
              k => !['page', 'limit'].includes(k) && req.query[k]
            ),
            suggestion:
              totalActiveJobs > 0 && jobsForPlan === 0
                ? `There are ${totalActiveJobs} active jobs, but none are available for the ${partnerPlan} plan.`
                : jobsForPlan > 0
                  ? 'Jobs exist for your plan but filters are too restrictive. Try removing some filters.'
                  : 'No active jobs on the platform at the moment. Check back later.'
          }
        }
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch jobs',
      error: error.message
    });
  }
};

// @desc    Get Job Details
// @route   GET /api/staffing-partners/jobs/:id
exports.getJobDetails = async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).populate(
      'company',
      [
        'companyName',
        'kyc.logo',
        'kyc.industry',
        'kyc.companyType',
        'kyc.yearEstablished',
        'kyc.employeeCount',
        'kyc.description',
        'kyc.website',
        'city',
        'state',
        'hiringPreferences.workModePreference',
        'hiringPreferences.typicalCtcBand',
        'hiringPreferences.avgMonthlyHiringVolume',
        'metrics.totalHires',
        'metrics.totalJobsPosted'
      ].join(' ')
    );

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check plan eligibility
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner profile not found'
      });
    }

    const partnerPlan = partner.subscription?.plan || 'FREE';
    const isEligible = await jobAccessService.isPlanEligibleForJob(partnerPlan, job);
    if (!isEligible) {
      return res.status(403).json({
        success: false,
        message: `This job is not accessible on your ${partnerPlan} plan. Please upgrade your subscription.`,
        requiredPlans: job.eligiblePlans,
        currentPlan: partnerPlan
      });
    }

    job.metrics.views += 1;
    await job.save();

    const company = job.company;
    const safeCompanyInfo = company
      ? {
        companyName: company.companyName,
        logo: company.kyc?.logo || null,
        industry: company.kyc?.industry || null,
        companyType: company.kyc?.companyType || null,
        yearEstablished: company.kyc?.yearEstablished || null,
        employeeCount: company.kyc?.employeeCount || null,
        description: company.kyc?.description || null,
        website: company.kyc?.website || null,
        location: {
          city: company.city || null,
          state: company.state || null
        },
        workMode: company.hiringPreferences?.workModePreference || null,
        typicalCtcBand: company.hiringPreferences?.typicalCtcBand || null,
        hiringVolume: company.hiringPreferences?.avgMonthlyHiringVolume || null,
        platformStats: {
          totalHires: company.metrics?.totalHires || 0,
          totalJobsPosted: company.metrics?.totalJobsPosted || 0
        }
      }
      : null;

    const jobData = job.toObject();
    delete jobData.company;

    res.json({
      success: true,
      data: {
        job: { ...jobData, company: safeCompanyInfo },
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

// ============================================================
// CANDIDATE SUBMISSION
// ============================================================

// @desc    Submit candidate WITH resume — single multipart/form-data request
// @route   POST /api/staffing-partners/jobs/:jobId/candidates
//
// Request:  multipart/form-data
// Required fields:
//   firstName, lastName, email, mobile, location,
//   totalExperience, relevantExperience, noticePeriod,
//   currentSalary, expectedSalary
//   resume  ← file (PDF / DOC / DOCX, max 10MB)
// Optional fields:
//   middleName, writeup, profile (JSON), forceSubmit
//
// Flow:
//   multer uploads file → Cloudinary
//   req.file.path = Cloudinary URL
//   req.file.originalname = original filename
exports.submitCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const job = await Job.findById(req.params.jobId).populate('company', 'companyName');

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

    // ✅ STEP 1: Check partner has shown interest in this job
    const interest = await JobInterest.findOne({
      partner: partner._id,
      job: job._id,
      status: 'ACTIVE'
    });

    if (!interest) {
      return res.status(403).json({
        success: false,
        message: 'Please show interest in this job before submitting candidates',
        action: 'SHOW_INTEREST_FIRST'
      });
    }

    // ✅ STEP 2: Check submission limit
    if (interest.submissionCount >= interest.submissionLimit) {
      return res.status(403).json({
        success: false,
        message: `You have reached your submission limit of ${interest.submissionLimit} for this job`,
        data: {
          submissionCount: interest.submissionCount,
          submissionLimit: interest.submissionLimit,
          action: 'REQUEST_EXTENSION'
        }
      });
    }

    // ✅ STEP 3: Check plan eligibility
    const partnerPlan = partner.subscription?.plan || 'FREE';
    const isEligible = await jobAccessService.isPlanEligibleForJob(partnerPlan, job);
    if (!isEligible) {
      return res.status(403).json({
        success: false,
        message: `This job is not accessible on your ${partnerPlan} plan. Please upgrade your subscription.`,
        requiredPlans: job.eligiblePlans,
        currentPlan: partnerPlan
      });
    }

    // ✅ STEP 4: Extract form fields
    // NOTE: Request is multipart/form-data — text fields come from req.body
    //       Resume file comes from req.file (processed by multer middleware)
    const {
      firstName,
      middleName,
      lastName,
      email,
      mobile,
      location,
      totalExperience,
      relevantExperience,
      noticePeriod,
      currentSalary,
      expectedSalary,
      writeup,
      profile,
      forceSubmit
    } = req.body;

    // Resume comes from multer (uploaded to Cloudinary before this runs)
    const resumeFile = req.file;
    const resumeUrl = resumeFile?.path || null;           // Cloudinary URL
    const resumeFileName = resumeFile?.originalname || null;

    // ✅ STEP 5: Validate required text fields
    const missingFields = [];
    if (!firstName || !firstName.trim()) missingFields.push('firstName');
    if (!lastName || !lastName.trim()) missingFields.push('lastName');
    if (!email || !email.trim()) missingFields.push('email');
    if (!mobile || !mobile.trim()) missingFields.push('mobile');

    // ✅ FIX: Location validation — trim and check properly
    if (!location || !location.trim()) missingFields.push('location');

    // ✅ FIX: Experience — comes as string from form-data
    if (totalExperience === undefined || totalExperience === null || totalExperience === '') {
      missingFields.push('totalExperience');
    }
    if (relevantExperience === undefined || relevantExperience === null || relevantExperience === '') {
      missingFields.push('relevantExperience');
    }

    if (!noticePeriod || !noticePeriod.trim()) missingFields.push('noticePeriod');

    // ✅ FIX: Salary — comes as string, check for empty string too
    if (currentSalary === undefined || currentSalary === null || currentSalary === '') {
      missingFields.push('currentSalary');
    }
    if (expectedSalary === undefined || expectedSalary === null || expectedSalary === '') {
      missingFields.push('expectedSalary');
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Please fill all required fields',
        missingFields
      });
    }

    // ✅ STEP 6: Validate resume file (uploaded via multer)
    if (!resumeFile || !resumeUrl) {
      return res.status(400).json({
        success: false,
        message: 'Resume is required. Please attach a PDF, DOC or DOCX file.',
        hint: 'Send request as multipart/form-data with field name "resume"'
      });
    }

    // Validate file type via mimetype
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!allowedMimes.includes(resumeFile.mimetype)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only PDF, DOC and DOCX are allowed.',
        receivedType: resumeFile.mimetype
      });
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (resumeFile.size > maxSize) {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.',
        receivedSize: `${(resumeFile.size / (1024 * 1024)).toFixed(2)} MB`
      });
    }

    // ✅ STEP 7: Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    // ✅ STEP 8: Validate and normalize mobile (keep last 10 digits)
    const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);
    if (normalizedMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number. Must be 10 digits.'
      });
    }

    // ✅ FIX: Parse numbers correctly from form-data strings

    // Experience validation
    const parsedTotalExp = parseFloat(String(totalExperience).trim());
    const parsedRelevantExp = parseFloat(String(relevantExperience).trim());

    if (isNaN(parsedTotalExp) || parsedTotalExp < 0) {
      return res.status(400).json({
        success: false,
        message: 'Total experience must be a valid number (years)'
      });
    }

    if (isNaN(parsedRelevantExp) || parsedRelevantExp < 0) {
      return res.status(400).json({
        success: false,
        message: 'Relevant experience must be a valid number (years)'
      });
    }

    if (parsedRelevantExp > parsedTotalExp) {
      return res.status(400).json({
        success: false,
        message: 'Relevant experience cannot be greater than total experience'
      });
    }

    // ✅ FIX: Salary validation — parse from string properly
    const parsedCurrentSalary = parseInt(String(currentSalary).trim().replace(/,/g, ''));
    const parsedExpectedSalary = parseInt(String(expectedSalary).trim().replace(/,/g, ''));

    if (isNaN(parsedCurrentSalary) || parsedCurrentSalary < 0) {
      return res.status(400).json({
        success: false,
        message: 'Current salary must be a valid number'
      });
    }

    if (isNaN(parsedExpectedSalary) || parsedExpectedSalary < 0) {
      return res.status(400).json({
        success: false,
        message: 'Expected salary must be a valid number'
      });
    }

    // ✅ STEP 11: Validate notice period
    const validNoticePeriods = [
      'Immediate',
      '15 days',
      '30 days',
      '45 days',
      '60 days',
      '90 days',
      'More than 90 days'
    ];

    if (!validNoticePeriods.includes(noticePeriod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid notice period. Must be one of: ${validNoticePeriods.join(', ')}`
      });
    }

    // ✅ STEP 12: Validate writeup length if provided
    if (writeup && writeup.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Writeup cannot exceed 1000 characters'
      });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // ✅ STEP 13: Duplicate check
    const duplicateCheck = await duplicateDetection.checkBeforeSubmission(
      { email: normalizedEmail, mobile: normalizedMobile },
      job._id,
      partner._id
    );

    if (!duplicateCheck.canSubmit) {
      return res.status(409).json({
        success: false,
        message: duplicateCheck.blocks[0]?.message || 'Duplicate submission blocked',
        data: {
          blocks: duplicateCheck.blocks,
          warnings: duplicateCheck.warnings
        }
      });
    }

    // High severity warnings block unless forceSubmit is true
    const highWarnings = duplicateCheck.warnings.filter(w => w.severity === 'high');
    if (highWarnings.length > 0 && !forceSubmit) {
      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        message: 'Potential issues detected. Set forceSubmit: true to proceed.',
        data: { warnings: duplicateCheck.warnings }
      });
    }

    // ✅ STEP 14: Generate WhatsApp consent token (valid 48 hours)
    const crypto = require('crypto');
    const consentToken = crypto.randomBytes(32).toString('hex');
    const consentExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);

    // Parse profile JSON string if sent as string from form-data
    let parsedProfile = {};
    if (profile) {
      try {
        parsedProfile = typeof profile === 'string' ? JSON.parse(profile) : profile;
      } catch {
        parsedProfile = {};
      }
    }

    // ✅ STEP 15: Create candidate in DRAFT status with resume from Cloudinary
    const candidate = await Candidate.create({
      submittedBy: partner._id,
      job: job._id,
      company: job.company,

      firstName: firstName.trim(),
      middleName: middleName?.trim() || '',
      lastName: lastName.trim(),
      email: normalizedEmail,
      mobile: normalizedMobile,

      // Resume URL comes from Cloudinary via multer
      resume: {
        url: resumeUrl,
        fileName: resumeFileName,
        uploadedAt: new Date()
      },

      // Build profile from individual form fields
      profile: {
        middleName: middleName?.trim() || '',
        location: location.trim(),           // ✅ trimmed
        currentLocation: location.trim(),    // ✅ trimmed
        totalExperience: parsedTotalExp,     // ✅ parsed float
        relevantExperience: parsedRelevantExp, // ✅ parsed float
        noticePeriod,
        currentSalary: parsedCurrentSalary,  // ✅ parsed int (no comma issue)
        expectedSalary: parsedExpectedSalary, // ✅ parsed int (no comma issue)
        writeup: writeup?.trim() || '',
        currentCompany: parsedProfile?.currentCompany || '',
        currentDesignation: parsedProfile?.currentDesignation || '',
        skills: parsedProfile?.skills || [],
        education: parsedProfile?.education || [],
        preferredLocations: parsedProfile?.preferredLocations || [],
        canRelocate: parsedProfile?.canRelocate || false,
        linkedinProfile: parsedProfile?.linkedinProfile || '',
        portfolioUrl: parsedProfile?.portfolioUrl || ''
      },


      consent: {
        given: false,
        consentStatus: 'PENDING_CONFIRMATION'
      },

      whatsappConsent: {
        sentAt: new Date(),
        sentTo: normalizedMobile,
        token: consentToken,
        expiresAt: consentExpiry,
        status: 'PENDING'
      },

      status: 'DRAFT',

      statusHistory: [{
        status: 'DRAFT',
        changedBy: req.user._id,
        notes: 'Candidate profile created by partner'
      }]
    });

    // ✅ STEP 16: Increment interest submission count
    await JobInterest.findByIdAndUpdate(interest._id, {
      $inc: { submissionCount: 1 }
    });

    // ✅ STEP 17: Update job metrics
    await Job.findByIdAndUpdate(job._id, {
      $inc: { 'metrics.applications': 1 }
    });

    // ✅ STEP 18: Update partner metrics
    await StaffingPartner.findByIdAndUpdate(partner._id, {
      $inc: { 'metrics.totalSubmissions': 1 }
    });

    // ✅ STEP 19: Send WhatsApp consent message (fire and forget)
    // Uses approved template: candidate_consent
    // Button URLs use consentToken as dynamic suffix
    const sendWhatsAppConsent = async () => {
      try {
        const whatsappService = require('../services/whatsappService');

        const company = await Company.findById(job.company).select('companyName');
        const companyName = company?.companyName || 'a leading company';

        const result = await whatsappService.sendCandidateConsent(
          normalizedMobile,
          firstName.trim(),   // {{1}} candidate name
          job.title,          // {{2}} job role
          companyName,        // {{3}} company name
          consentToken        // dynamic URL suffix for both buttons
        );

        if (result.success) {
          // Move candidate to CONSENT_PENDING after WhatsApp sent
          await Candidate.findByIdAndUpdate(candidate._id, {
            status: 'CONSENT_PENDING',
            $push: {
              statusHistory: {
                status: 'CONSENT_PENDING',
                changedAt: new Date(),
                notes: `WhatsApp consent template sent to +91${normalizedMobile}`
              }
            }
          });
          console.log(`[CONSENT] ✅ Sent to +91${normalizedMobile}`);
        } else {
          console.error(`[CONSENT] ❌ Failed: ${result.error}`);
          // Candidate stays in DRAFT — admin can manually follow up
        }
      } catch (err) {
        console.error('[CONSENT] WhatsApp error:', err.message);
      }
    };

    sendWhatsAppConsent();

    // ✅ STEP 20: Notify partner in-app (fire and forget)
    const notifyPartner = async () => {
      try {
        await notificationEngine.send({
          recipientId: req.user._id,
          type: 'SYSTEM_ANNOUNCEMENT',
          title: '✅ Candidate profile created',
          message: `${firstName} ${lastName}'s profile has been created for "${job.title}". WhatsApp consent sent. Profile will be processed once candidate confirms.`,
          data: {
            entityType: 'Candidate',
            entityId: candidate._id,
            actionUrl: `/partner/submissions/${candidate._id}`
          },
          channels: { inApp: true },
          priority: 'medium'
        });
      } catch (err) {
        console.error('[NOTIFY] Partner notification failed:', err.message);
      }
    };

    notifyPartner();

    // NOTE: AI parse + scoring + admin queue is triggered ONLY after candidate
    // confirms WhatsApp consent via GET /api/candidates/consent/agree/:token
    // DO NOT call processAfterConsent() here — candidate has not consented yet.

    // ✅ Success response
    res.status(201).json({
      success: true,
      message: 'Candidate profile created. WhatsApp consent request sent to candidate.',
      data: {
        candidateId: candidate._id,
        candidateName: `${firstName.trim()} ${lastName.trim()}`,
        status: 'CONSENT_PENDING',
        resume: {
          fileName: resumeFileName,
          uploadedAt: candidate.resume.uploadedAt
        },
        whatsapp: {
          sentTo: normalizedMobile,
          expiresAt: consentExpiry
        },
        nextStep: 'Waiting for candidate WhatsApp consent',
        warnings: duplicateCheck.warnings
      }
    });

  } catch (error) {
    console.error('[PARTNER] Submit candidate error:', error);
    res.status(500).json({
      success: false,
      message: 'Submission failed',
      error: error.message
    });
  }
};

// PARTNER: Get all available slots for a job
// GET /api/partners/jobs/:jobId/interview-slots
exports.getAvailableSlotsForPartner = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }

    const job = await Job.findById(req.params.jobId).populate('company', 'companyName');
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    // Get all ACTIVE slots for this job
    const slots = await InterviewSlot.find({
      job: req.params.jobId,
      status: 'ACTIVE',
    }).sort({ date: 1, startTime: 1 });

    const now = new Date();

    // Helper to combine date and time string
    const getSlotDateTime = (date, timeStr) => {
      const d = new Date(date);
      const [time, modifier] = timeStr.split(' ');
      let [hours, minutes] = time.split(':');
      hours = parseInt(hours);
      minutes = parseInt(minutes);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      d.setHours(hours, minutes, 0, 0);
      return d;
    };

    // Get partner's shortlisted candidates for this job
    const partnerCandidates = await Candidate.find({
      job: req.params.jobId,
      submittedBy: partner._id,
      status: 'SHORTLISTED', // Only shortlisted ones can be assigned
    }).select('firstName lastName email mobile status assignedSlot profile.currentDesignation');

    // For each slot show what partner needs to know
    const formattedSlots = slots.map((slot) => {
      // Which of THIS partner's candidates are already in this slot
      const partnerBookingsInSlot = slot.bookedCandidates.filter(
        (b) =>
          b.partner.toString() === partner._id.toString() &&
          b.bookingStatus === 'BOOKED'
      );

      return {
        slotId: slot._id,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxCandidates: slot.maxCandidates,
        availableSpots: slot.availableSpots,
        isFull: slot.availableSpots === 0,
        notes: slot.notes,
        interviewMode: slot.interviewMode || '',
        // How many of YOUR candidates are in this slot
        yourCandidatesBooked: partnerBookingsInSlot.length,
        isPast: getSlotDateTime(slot.date, slot.startTime) < now
      };
    });

    // Only show slots that are NOT in the past
    const futureSlots = formattedSlots.filter(s => !s.isPast);

    res.json({
      success: true,
      data: {
        jobId: job._id,
        jobTitle: job.title,
        company: job.company?.companyName,
        jobDeadline: job.applicationDeadline,

        // Slots available for booking
        availableSlots: futureSlots.filter((s) => !s.isFull),
        fullSlots: futureSlots.filter((s) => s.isFull),
        totalSlots: futureSlots.length,

        // Partner's candidates eligible for slot assignment
        yourShortlistedCandidates: partnerCandidates.map((c) => ({
          candidateId: c._id,
          name: `${c.firstName} ${c.lastName}`,
          email: c.email,
          designation: c.profile?.currentDesignation,
          status: c.status,
          alreadyAssigned: !!c.assignedSlot,
          assignedSlotId: c.assignedSlot,
        })),
      },
    });
  } catch (error) {
    console.error('[PARTNER] Get available slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get interview slots',
      error: error.message,
    });
  }
};

// PARTNER: Assign a shortlisted candidate to a slot
// POST /api/partners/jobs/:jobId/interview-slots/:slotId/assign
exports.assignCandidateToSlot = async (req, res) => {
  try {
    const { candidateId } = req.body;

    if (!candidateId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide candidateId',
      });
    }

    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }

    // ── Validate candidate ────────────────────────────────────────────
    const candidate = await Candidate.findById(candidateId);
    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Candidate not found' });
    }

    // Candidate must belong to this partner
    if (candidate.submittedBy.toString() !== partner._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'This candidate does not belong to you',
      });
    }

    // Candidate must be for this job
    if (candidate.job.toString() !== req.params.jobId) {
      return res.status(400).json({
        success: false,
        message: 'Candidate is not applied for this job',
      });
    }

    // Candidate must be SHORTLISTED
    if (candidate.status !== 'SHORTLISTED') {
      return res.status(400).json({
        success: false,
        message: `Only SHORTLISTED candidates can be assigned to slots. Current status: ${candidate.status}`,
      });
    }

    // Candidate must not already be assigned to a slot
    if (candidate.assignedSlot) {
      return res.status(400).json({
        success: false,
        message: 'Candidate is already assigned to a slot',
        assignedSlotId: candidate.assignedSlot,
        hint: 'Remove candidate from current slot before reassigning',
      });
    }

    // ── Validate slot ─────────────────────────────────────────────────
    const slot = await InterviewSlot.findOne({
      _id: req.params.slotId,
      job: req.params.jobId,
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found' });
    }

    if (slot.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Slot is not available. Status: ${slot.status}`,
      });
    }

    // ── Check if slot is in the past ──────────────────────────────────
    const getSlotDateTime = (date, timeStr) => {
      const d = new Date(date);
      const [time, modifier] = timeStr.split(' ');
      let [hours, minutes] = time.split(':');
      hours = parseInt(hours);
      minutes = parseInt(minutes);
      if (modifier === 'PM' && hours < 12) hours += 12;
      if (modifier === 'AM' && hours === 12) hours = 0;
      d.setHours(hours, minutes, 0, 0);
      return d;
    };

    if (getSlotDateTime(slot.date, slot.startTime) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign candidate to a past interview slot',
      });
    }

    if (slot.availableSpots <= 0) {
      return res.status(400).json({
        success: false,
        message: 'This slot is full. Please choose another slot.',
        availableSpots: 0,
      });
    }

    // ── Check if candidate already in this slot (duplicate check) ─────
    const alreadyInSlot = slot.bookedCandidates.some(
      (b) =>
        b.candidate.toString() === candidateId &&
        b.bookingStatus === 'BOOKED'
    );

    if (alreadyInSlot) {
      return res.status(400).json({
        success: false,
        message: 'Candidate is already booked in this slot',
      });
    }

    // ── Book the candidate ────────────────────────────────────────────
    slot.bookedCandidates.push({
      candidate: candidateId,
      partner: partner._id,
      bookedAt: new Date(),
      bookingStatus: 'BOOKED',
    });

    // Decrease available spots
    slot.availableSpots -= 1;

    // Mark slot as FULL if no spots remain
    if (slot.availableSpots === 0) {
      slot.status = 'FULL';
    }

    await slot.save();

    // ── Update candidate ──────────────────────────────────────────────
    candidate.assignedSlot = slot._id;
    candidate.status = 'SLOT_ASSIGNED';

    // Record in interviews array for history
    candidate.interviews.push({
      round: candidate.interviews.length + 1,
      slot: slot._id,
      scheduledAt: slot.date,
      type: 'Video', // Defaulting to Video for now
      result: 'PENDING'
    });

    candidate.statusHistory.push({
      status: 'SLOT_ASSIGNED',
      changedBy: req.user._id,
      changedAt: new Date(),
      changedByRole: 'PARTNER',
      notes: `Assigned to interview slot on ${new Date(slot.date).toDateString()} ${slot.startTime} - ${slot.endTime}`,
      metadata: {
        slotId: slot._id,
        slotDate: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      },
    });

    await candidate.save();

    res.status(201).json({
      success: true,
      message: 'Candidate assigned to interview slot successfully',
      data: {
        candidate: {
          id: candidate._id,
          name: `${candidate.firstName} ${candidate.lastName}`,
          status: candidate.status,
        },
        slot: {
          slotId: slot._id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          remainingSpots: slot.availableSpots,
          slotStatus: slot.status,
        },
      },
    });
  } catch (error) {
    console.error('[PARTNER] Assign candidate to slot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign candidate to slot',
      error: error.message,
    });
  }
};

// PARTNER: Remove candidate from a slot (unassign)
// DELETE /api/partners/jobs/:jobId/interview-slots/:slotId/assign/:candidateId
exports.removeCandidateFromSlot = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner not found' });
    }

    const slot = await InterviewSlot.findOne({
      _id: req.params.slotId,
      job: req.params.jobId,
    });

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found' });
    }

    // Find the booking
    const booking = slot.bookedCandidates.find(
      (b) =>
        b.candidate.toString() === req.params.candidateId &&
        b.partner.toString() === partner._id.toString() &&
        b.bookingStatus === 'BOOKED'
    );

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found or already cancelled',
      });
    }

    // Cancel booking
    booking.bookingStatus = 'CANCELLED';
    booking.cancelledAt = new Date();
    booking.cancelReason = req.body.reason || 'Partner removed candidate';

    // Restore available spot
    slot.availableSpots += 1;

    // Reactivate slot if it was FULL
    if (slot.status === 'FULL') {
      slot.status = 'ACTIVE';
    }

    await slot.save();

    // Update candidate status back to SHORTLISTED
    await Candidate.findByIdAndUpdate(req.params.candidateId, {
      $set: {
        assignedSlot: null,
        status: 'SHORTLISTED',
      },
      $push: {
        statusHistory: {
          status: 'SHORTLISTED',
          changedBy: req.user._id,
          changedAt: new Date(),
          changedByRole: 'PARTNER',
          notes: 'Removed from interview slot — back to shortlisted',
          metadata: { removedFromSlot: slot._id },
        },
      },
    });

    res.json({
      success: true,
      message: 'Candidate removed from slot successfully',
      data: {
        slotId: slot._id,
        availableSpots: slot.availableSpots,
        slotStatus: slot.status,
      },
    });
  } catch (error) {
    console.error('[PARTNER] Remove candidate from slot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove candidate from slot',
      error: error.message,
    });
  }
};
// ============================================================
// RESUME UPDATE (after submission — separate route)
// ============================================================

// @desc    Update resume for an existing candidate
// @route   POST /api/staffing-partners/candidates/:id/resume
// @body    multipart/form-data — field name: "resume"
// @note    Only the partner who submitted the candidate can update
exports.uploadResume = async (req, res) => {
  try {
    // Resume file must be attached (processed by multer before this runs)
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please attach a PDF, DOC or DOCX file.',
        hint: 'Send as multipart/form-data with field name "resume"'
      });
    }

    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner profile not found'
      });
    }

    // Ownership check — partner can only update their own submissions
    const candidate = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found or does not belong to you'
      });
    }

    // Cloudinary URL from multer
    const resumeUrl = req.file.path;
    const fileName = req.file.originalname;

    if (!resumeUrl) {
      return res.status(500).json({
        success: false,
        message: 'File upload to Cloudinary failed. Please try again.'
      });
    }

    candidate.resume = {
      url: resumeUrl,
      fileName: fileName,
      uploadedAt: new Date()
    };

    await candidate.save();

    res.json({
      success: true,
      message: 'Resume updated successfully',
      data: {
        url: resumeUrl,
        fileName: fileName,
        uploadedAt: candidate.resume.uploadedAt
      }
    });

  } catch (error) {
    console.error('[RESUME] Upload error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Resume upload failed',
      error: error.message
    });
  }
};

// ============================================================
// SUBMISSIONS
// ============================================================

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

    const { page = 1, limit = 10, status, search } = req.query;
    const parsedPage = parseInt(page, 10) || 1;
    const parsedLimit = parseInt(limit, 10) || 10;
    const skip = (parsedPage - 1) * parsedLimit;

    const query = { submittedBy: partner._id };
    if (status) query.status = status;

    if (search && search.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      
      // Find matching jobs
      const matchingJobs = await Job.find({ title: rx }).select('_id');
      const jobIds = matchingJobs.map(j => j._id);
      
      // Find matching companies
      const matchingCompanies = await Company.find({ companyName: rx }).select('_id');
      const companyIds = matchingCompanies.map(c => c._id);
      
      query.$or = [
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { mobile: rx },
        { job: { $in: jobIds } },
        { company: { $in: companyIds } }
      ];
    }

    const [submissions, total] = await Promise.all([
      Candidate.find(query)
        .populate('job', 'title company commission')
        .populate('company', 'companyName')
        .sort({ _id: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .select(
          'firstName middleName lastName email mobile status ' +
          'profile.location profile.totalExperience profile.relevantExperience ' +
          'profile.noticePeriod profile.currentSalary profile.expectedSalary ' +
          'profile.writeup profile.currentCompany profile.currentDesignation ' +
          'resume interviewConfig whatsappConsent.status resumeAnalysis.profileScore ' +
          'resumeAnalysis.matchLevel createdAt job company assignedSlot'
        )
        .populate('assignedSlot', 'date startTime endTime status interviewMode'),
      Candidate.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        submissions,
        pagination: {
          total,
          page: parsedPage,
          current: parsedPage,
          limit: parsedLimit,
          pages: Math.ceil(total / parsedLimit)
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
      .populate('company', 'companyName')
      .populate('assignedSlot', 'date startTime endTime status interviewMode');

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

// @desc    Update Candidate Submission Details (Before Consent Confirmation)
// @route   PUT /api/staffing-partners/submissions/:id
exports.updateSubmission = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner profile not found' });
    }

    const submission = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    });

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    // Check status lock
    const CONSENT_LOCKED_STATUSES = ['CONSENT_CONFIRMED', 'ADMIN_REVIEW', 'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_CONFIRMED', 'INTERVIEWED', 'OFFERED', 'OFFER_ACCEPTED', 'JOINED'];
    if (CONSENT_LOCKED_STATUSES.includes(submission.status)) {
      return res.status(403).json({
        success: false,
        message: 'Editing is locked because the candidate has already confirmed consent or is in active stages.'
      });
    }

    // Update main identity info
    const {
      firstName,
      middleName,
      lastName,
      email,
      mobile,
      location,
      willingToRelocate,
      totalExperience,
      relevantExperience,
      noticePeriod,
      currentSalary,
      expectedSalary,
      writeup
    } = req.body;

    if (firstName) submission.firstName = firstName.trim();
    if (middleName !== undefined) submission.middleName = middleName.trim();
    if (lastName) submission.lastName = lastName.trim();
    
    if (email) {
      submission.email = email.trim().toLowerCase();
    }
    
    if (mobile) {
      submission.mobile = mobile.trim();
      // Update whatsappConsent sentTo if it was pending
      if (submission.whatsappConsent && submission.status === 'CONSENT_PENDING') {
        submission.whatsappConsent.sentTo = mobile.trim();
      }
    }

    // Update profile object
    if (!submission.profile) submission.profile = {};
    if (location !== undefined) submission.profile.location = location.trim();
    if (willingToRelocate !== undefined && willingToRelocate !== null && willingToRelocate !== '') {
      submission.profile.willingToRelocate = willingToRelocate === 'true' || willingToRelocate === true;
    }
    if (totalExperience !== undefined && totalExperience !== '') submission.profile.totalExperience = Number(totalExperience);
    if (relevantExperience !== undefined && relevantExperience !== '') submission.profile.relevantExperience = Number(relevantExperience);
    if (noticePeriod !== undefined) submission.profile.noticePeriod = noticePeriod;
    if (currentSalary !== undefined && currentSalary !== '') submission.profile.currentSalary = Number(currentSalary);
    if (expectedSalary !== undefined && expectedSalary !== '') submission.profile.expectedSalary = Number(expectedSalary);
    if (writeup !== undefined) submission.profile.writeup = writeup.trim();

    // If new resume file uploaded
    if (req.file && req.file.path) {
      submission.resume = {
        url: req.file.path,
        fileName: req.file.originalname,
        uploadedAt: new Date()
      };
    }

    await submission.save();

    // Also update pool candidate if referenced
    if (submission.poolCandidateRef) {
      const PartnerCandidate = require('../models/PartnerCandidate');
      const poolCandidate = await PartnerCandidate.findOne({
        _id: submission.poolCandidateRef,
        partner: partner._id
      });

      if (poolCandidate) {
        if (firstName) poolCandidate.firstName = firstName.trim();
        if (middleName !== undefined) poolCandidate.middleName = middleName.trim();
        if (lastName) poolCandidate.lastName = lastName.trim();
        if (email) poolCandidate.email = email.trim().toLowerCase();
        if (mobile) poolCandidate.mobile = mobile.trim();
        if (location !== undefined) poolCandidate.location = location.trim();
        if (willingToRelocate !== undefined && willingToRelocate !== null && willingToRelocate !== '') {
          poolCandidate.willingToRelocate = willingToRelocate === 'true' || willingToRelocate === true;
        }
        if (totalExperience !== undefined && totalExperience !== '') poolCandidate.totalExperience = Number(totalExperience);
        if (relevantExperience !== undefined && relevantExperience !== '') poolCandidate.relevantExperience = Number(relevantExperience);
        if (noticePeriod !== undefined) poolCandidate.noticePeriod = noticePeriod;
        if (currentSalary !== undefined && currentSalary !== '') poolCandidate.currentSalary = Number(currentSalary);
        if (expectedSalary !== undefined && expectedSalary !== '') poolCandidate.expectedSalary = Number(expectedSalary);
        if (writeup !== undefined) poolCandidate.writeup = writeup.trim();
        
        if (req.file && req.file.path) {
          poolCandidate.resume = {
            url: req.file.path,
            fileName: req.file.originalname,
            uploadedAt: new Date()
          };
        }

        if (req.body.tags !== undefined) {
          let tagsArray = [];
          if (Array.isArray(req.body.tags)) {
            tagsArray = req.body.tags;
          } else if (typeof req.body.tags === 'string') {
            tagsArray = req.body.tags.split(',').map(t => t.trim()).filter(Boolean);
          }
          poolCandidate.tags = tagsArray;
        }

        await poolCandidate.save();
      }
    }

    res.json({
      success: true,
      message: 'Candidate details updated successfully',
      data: submission
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update candidate details',
      error: error.message
    });
  }
};


// ============================================================
// RESEND WHATSAPP CONSENT
// ============================================================

// @desc    Resend WhatsApp consent to candidate
// @route   POST /api/staffing-partners/submissions/:id/resend-consent
// @access  Staffing Partner — only when candidate status is CONSENT_PENDING
exports.resendConsent = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({ success: false, message: 'Partner profile not found' });
    }

    const candidate = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    }).populate('job', 'title company');

    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    // Only allow resend if consent is still pending
    if (candidate.status !== 'CONSENT_PENDING') {
      return res.status(400).json({
        success: false,
        message: candidate.status === 'CONSENT_CONFIRMED'
          ? 'Candidate has already confirmed consent. Resend is not allowed.'
          : `Cannot resend consent. Current status is: ${candidate.status}`
      });
    }

    const whatsappService = require('../services/whatsappService');
    const Company = require('../models/Company');

    const company = await Company.findById(candidate.job?.company || candidate.company).select('companyName');
    const companyName = company?.companyName || 'a leading company';
    const consentToken = candidate.whatsappConsent?.token;

    if (!consentToken) {
      return res.status(400).json({ success: false, message: 'Consent token missing. Cannot resend.' });
    }

    const result = await whatsappService.sendCandidateConsent(
      candidate.mobile,
      candidate.firstName,
      candidate.job?.title || 'the role',
      companyName,
      consentToken
    );

    if (!result.success) {
      return res.status(500).json({ success: false, message: 'Failed to resend WhatsApp consent', error: result.error });
    }

    // Update resent timestamp
    candidate.whatsappConsent.resentAt = new Date();
    candidate.whatsappConsent.sentAt = new Date();
    candidate.statusHistory.push({
      status: 'CONSENT_PENDING',
      changedBy: req.user._id,
      changedAt: new Date(),
      notes: 'WhatsApp consent resent by partner'
    });
    await candidate.save();

    console.log(`[CONSENT] 🔄 Resent to ${candidate.mobile} by partner ${partner._id}`);

    res.json({
      success: true,
      message: `WhatsApp consent resent to ${candidate.firstName} (${candidate.mobile})`
    });

  } catch (error) {
    console.error('[CONSENT] Resend error:', error);
    res.status(500).json({ success: false, message: 'Failed to resend consent', error: error.message });
  }
};

// ============================================================
// WITHDRAW CANDIDATE
// ============================================================

// @desc    Withdraw Candidate
// @route   PUT /api/staffing-partners/submissions/:id/withdraw
exports.withdrawCandidate = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const { reason } = req.body;

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner profile not found'
      });
    }

    const candidate = await Candidate.findOne({
      _id: req.params.id,
      submittedBy: partner._id
    });

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found or does not belong to you'
      });
    }

    // Early-stage candidates bypass lifecycle service
    // These statuses haven't reached the company yet
    const earlyStageStatuses = [
      'DRAFT',
      'CONSENT_PENDING',
      'CONSENT_CONFIRMED',
      'ADMIN_REVIEW',
      'ADMIN_REJECTED',
      'CONSENT_DENIED'
    ];

    if (earlyStageStatuses.includes(candidate.status)) {
      const previousStatus = candidate.status;

      candidate.status = 'WITHDRAWN';
      candidate.statusHistory.push({
        status: 'WITHDRAWN',
        changedBy: req.user._id,
        changedAt: new Date(),
        notes: reason || 'Withdrawn by staffing partner'
      });
      await candidate.save();

      return res.json({
        success: true,
        message: 'Candidate withdrawn successfully',
        data: {
          candidateId: candidate._id,
          previousStatus,
          newStatus: 'WITHDRAWN'
        }
      });
    }

    // For candidates already visible to company — use lifecycle service
    const candidateLifecycleService = require('../services/candidateLifecycleService');

    try {
      const updated = await candidateLifecycleService.updateStatus(
        candidate._id,
        'WITHDRAWN',
        req.user._id,
        'staffing_partner',
        reason || 'Withdrawn by staffing partner'
      );

      res.json({
        success: true,
        message: 'Candidate withdrawn successfully',
        data: {
          candidateId: updated._id,
          previousStatus: candidate.status,
          newStatus: 'WITHDRAWN'
        }
      });
    } catch (error) {
      if (error.statusCode === 400) {
        return res.status(400).json({
          success: false,
          message: error.message,
          currentStatus: candidate.status,
          allowedTransitions: error.allowedTransitions
        });
      }
      throw error;
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Withdrawal failed',
      error: error.message
    });
  }
};

// ============================================================
// DASHBOARD
// ============================================================

// @desc    Get Dashboard Stats
// @route   GET /api/staffing-partners/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id }).populate(
      'user',
      'emailVerified mobileVerified'
    );

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const PartnerCandidate = require('../models/PartnerCandidate');

    // 1. Worked Jobs Count (unique jobs partner has submitted candidate(s) to)
    const workedJobs = await Candidate.distinct('job', { submittedBy: partner._id });
    const totalWorkedJobs = workedJobs.length;

    // 2. Shortlisted Jobs Count (unique jobs with shortlisted/interview/joined candidate)
    const shortlistedJobs = await Candidate.distinct('job', {
      submittedBy: partner._id,
      status: { $in: ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEW_CONFIRMED', 'INTERVIEWED', 'SLOT_ASSIGNED', 'OFFERED', 'OFFER_ACCEPTED', 'JOINED'] }
    });
    const totalShortlistedJobs = shortlistedJobs.length;

    // 3. Total Candidates in Partner's Candidate Pool
    const totalPoolCandidates = await PartnerCandidate.countDocuments({ partner: partner._id });

    // 4. Total Manual Candidates submitted to jobs (where poolCandidateRef is null/undefined)
    const totalManualSubmissions = await Candidate.countDocuments({
      submittedBy: partner._id,
      $or: [
        { poolCandidateRef: null },
        { poolCandidateRef: { $exists: false } }
      ]
    });

    // 5. Active Interviews count
    const activeInterviewsCount = await Candidate.countDocuments({
      submittedBy: partner._id,
      status: { $in: ['INTERVIEW_SCHEDULED', 'INTERVIEW_CONFIRMED', 'INTERVIEWED', 'SLOT_ASSIGNED'] }
    });

    // 6. Calculate monthly placements for the last 6 months dynamically
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const monthlyPlacements = await Candidate.aggregate([
      {
        $match: {
          submittedBy: partner._id,
          status: { $in: ['JOINED', 'OFFER_ACCEPTED', 'HIRED', 'PLACED'] },
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const placementData = [];
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const year = d.getFullYear();
      const monthIndex = d.getMonth(); // 0-11
      const label = `${monthNames[monthIndex]} ${year}`;
      
      const match = monthlyPlacements.find(item => item._id.year === year && item._id.month === (monthIndex + 1));
      placementData.push({
        month: label,
        placements: match ? match.count : 0
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

    const availableJobsCount = await jobAccessService.getAccessibleJobsCount(partner.subscription?.plan || 'FREE');

    const profileCompletion = partner.profileCompletion ? (partner.profileCompletion.toObject ? partner.profileCompletion.toObject() : partner.profileCompletion) : {};
    
    // Force basicInfo to false if email or mobile is not verified
    if (!partner.user?.emailVerified || !partner.user?.mobileVerified) {
      profileCompletion.basicInfo = false;
    }

    const completionKeys = Object.keys(profileCompletion).filter(k => !k.startsWith('$') && k !== '_id' && k !== 'id');
    const totalSections = completionKeys.length;
    const completedSections = completionKeys.filter(k => !!profileCompletion[k]).length;
    const completionPercentage = totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0;

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
        metrics: {
          ...partner.metrics,
          totalWorkedJobs,
          totalShortlistedJobs,
          totalPoolCandidates,
          totalManualSubmissions,
          activeInterviewsCount
        },
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
        availableJobsCount,
        placementData
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

// ============================================================
// EARNINGS & PAYOUTS
// ============================================================

// @desc    Get Earnings / Payouts list
// @route   GET /api/staffing-partners/earnings
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

// ============================================================
// INVOICES
// ============================================================

// @desc    Get partner invoices list
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

// @desc    Get Worked Jobs (Jobs the partner has submitted candidates to)
// @route   GET /api/staffing-partners/worked-jobs
exports.getWorkedJobs = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    const { limit = 10, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Aggregate unique jobs this partner has submitted candidates to
    const pipeline = [
      { $match: { submittedBy: partner._id } },
      { $group: {
          _id: "$job",
          submissionCount: { $sum: 1 },
          lastSubmittedAt: { $max: "$createdAt" },
          statusCounts: {
            $push: "$status"
          }
      }},
      { $lookup: {
          from: "jobs",
          localField: "_id",
          foreignField: "_id",
          as: "jobDetails"
      }},
      { $unwind: "$jobDetails" },
      { $lookup: {
          from: "companies",
          localField: "jobDetails.company",
          foreignField: "_id",
          as: "companyDetails"
      }},
      { $unwind: { path: "$companyDetails", preserveNullAndEmptyArrays: true } },
      { $sort: { lastSubmittedAt: -1 } },
      { $facet: {
          metadata: [ { $count: "total" } ],
          data: [ { $skip: skip }, { $limit: parseInt(limit) } ]
      }}
    ];

    const Candidate = require('../models/Candidate');
    const aggregationResult = await Candidate.aggregate(pipeline);

    const total = aggregationResult[0].metadata[0]?.total || 0;
    const items = aggregationResult[0].data.map(item => {
      const statuses = item.statusCounts || [];
      const hired = statuses.filter(s => s === 'HIRED').length;
      const rejected = statuses.filter(s => s === 'REJECTED').length;
      const interviewing = statuses.filter(s => ['SLOT_ASSIGNED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED'].includes(s)).length;
      const active = statuses.length - hired - rejected - interviewing;
      return {
        job: {
          _id: item.jobDetails._id,
          title: item.jobDetails.title,
          category: item.jobDetails.category,
          employmentType: item.jobDetails.employmentType,
          status: item.jobDetails.status,
          approvalStatus: item.jobDetails.approvalStatus,
          location: item.jobDetails.location,
          salary: item.jobDetails.salary,
          uniqueId: item.jobDetails.uniqueId
        },
        company: {
          companyName: item.companyDetails?.companyName || "N/A"
        },
        stats: {
          total: item.submissionCount,
          active,
          interviewing,
          hired,
          rejected
        },
        lastSubmittedAt: item.lastSubmittedAt
      };
    });

    res.json({
      success: true,
      data: {
        jobs: items,
        pagination: {
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          total
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch worked jobs',
      error: error.message
    });
  }
};