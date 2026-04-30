// backend/controllers/adminController.js
const User = require('../models/User');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const { PERMISSIONS } = require('../utils/permissions');
const emailService = require('../services/emailService');
const auditService = require('../services/auditService');
const hasPermission = (user, permission) => {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'sub_admin') return false;

  const permissions = user.permissions || [];
  return permissions.includes(permission);
};

// @desc    Get Dashboard Overview
// @route   GET /api/admin/dashboard
exports.getDashboard = async (req, res) => {
  try {
    const stats = {
      users: await User.countDocuments(),
      staffingPartners: await StaffingPartner.countDocuments(),
      companies: await Company.countDocuments(),
      activeJobs: await Job.countDocuments({ status: 'ACTIVE' }),
      totalCandidates: await Candidate.countDocuments(),
      pendingVerifications: {
        partners: await StaffingPartner.countDocuments({ verificationStatus: 'UNDER_REVIEW' }),
        companies: await Company.countDocuments({ verificationStatus: 'UNDER_REVIEW' })
      }
    };

    const recentRegistrations = await User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('email role status createdAt');

    const recentPlacements = await Candidate.find({ status: 'JOINED' })
      .populate('job', 'title')
      .populate('company', 'companyName')
      .sort({ 'joining.confirmedAt': -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        stats,
        recentRegistrations,
        recentPlacements
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

// @desc    Get Pending Verifications
// @route   GET /api/admin/verifications
exports.getPendingVerifications = async (req, res) => {
  try {
    const { type } = req.query;

    let partners = [];
    let companies = [];

    if (!type || type === 'partners') {
      partners = await StaffingPartner.find({
        verificationStatus: { $in: ['PENDING', 'UNDER_REVIEW'] }
      }).populate('user', 'email mobile createdAt')
        .sort({ createdAt: 1 });
    }

    if (!type || type === 'companies') {
      companies = await Company.find({ verificationStatus: 'UNDER_REVIEW' })
        .populate('user', 'email mobile createdAt')
        .sort({ createdAt: 1 });
    }

    res.json({
      success: true,
      data: { partners, companies }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch verifications',
      error: error.message
    });
  }
};

// @desc    Verify Staffing Partner
// @route   PUT /api/admin/verify/partner/:id
exports.verifyPartner = async (req, res) => {
  try {
    const { action, notes, rejectionReason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "approve" or "reject"'
      });
    }

    if (action === 'approve' && !hasPermission(req.user, PERMISSIONS.APPROVE_PARTNER)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve staffing partners'
      });
    }

    if (action === 'reject' && !hasPermission(req.user, PERMISSIONS.REJECT_PARTNER)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject staffing partners'
      });
    }

    const partner = await StaffingPartner.findById(req.params.id);

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Staffing partner not found'
      });
    }

    const user = await User.findById(partner.user);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Associated user not found'
      });
    }

    if (action === 'approve') {
      partner.verificationStatus = 'APPROVED';
      partner.verifiedBy = req.user._id;
      partner.verifiedAt = new Date();
      partner.verificationNotes = notes || '';

      user.status = 'VERIFIED';

      await emailService.sendVerificationApproved(
        user.email,
        `${partner.firstName} ${partner.lastName}`,
        'staffing_partner'
      );
    } else {
      if (!rejectionReason || rejectionReason.trim().length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required (minimum 5 characters)'
        });
      }

      partner.verificationStatus = 'REJECTED';
      partner.rejectionReason = rejectionReason.trim();
      partner.verificationNotes = notes || '';
      user.status = 'REJECTED';
    }

    await partner.save();
    await user.save();

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: action === 'approve' ? 'PARTNER_APPROVED' : 'PARTNER_REJECTED',
      entityType: 'StaffingPartner',
      entityId: partner._id,
      description: `Partner ${action}d: ${partner.firmName}`,
      notes: action === 'approve' ? notes : rejectionReason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: `Partner ${action}d successfully`,
      data: partner
    });
  } catch (error) {
    console.error('[ADMIN] Verify partner error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification action failed',
      error: error.message
    });
  }
};

// @desc    Verify Company
// @route   PUT /api/admin/verify/company/:id
exports.verifyCompany = async (req, res) => {
  try {
    const { action, notes, rejectionReason } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Use "approve" or "reject"'
      });
    }

    if (action === 'approve' && !hasPermission(req.user, PERMISSIONS.APPROVE_COMPANY)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to approve companies'
      });
    }

    if (action === 'reject' && !hasPermission(req.user, PERMISSIONS.REJECT_COMPANY)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to reject companies'
      });
    }

    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const user = await User.findById(company.user);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Associated user not found'
      });
    }

    if (action === 'approve') {
      company.verificationStatus = 'APPROVED';
      company.verifiedBy = req.user._id;
      company.verifiedAt = new Date();
      company.verificationNotes = notes || '';

      user.status = 'VERIFIED';

      await emailService.sendVerificationApproved(
        user.email,
        company.decisionMakerName,
        'company'
      );
    } else {
      if (!rejectionReason || rejectionReason.trim().length < 5) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required (minimum 5 characters)'
        });
      }

      company.verificationStatus = 'REJECTED';
      company.rejectionReason = rejectionReason.trim();
      company.verificationNotes = notes || '';
      user.status = 'REJECTED';
    }

    await company.save();
    await user.save();
    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: action === 'approve' ? 'COMPANY_APPROVED' : 'COMPANY_REJECTED',
      entityType: 'Company',
      entityId: company._id,
      description: `Company ${action}d: ${company.companyName}`,
      notes: action === 'approve' ? notes : rejectionReason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.json({
      success: true,
      message: `Company ${action}d successfully`,
      data: company
    });
  } catch (error) {
    console.error('[ADMIN] Verify company error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification action failed',
      error: error.message
    });
  }
};

// ==================== PAYOUT MANAGEMENT ====================

// @desc    Get all payouts
// @route   GET /api/admin/payouts
exports.getPayouts = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const { status, page = 1, limit = 20, partnerId } = req.query;

    const query = {};
    if (status) query.status = status;
    if (partnerId) query.staffingPartner = partnerId;

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [payouts, total] = await Promise.all([
      Payout.find(query)
        .populate('staffingPartner', 'firstName lastName firmName commercialDetails user')
        .populate('candidate', 'firstName lastName')
        .populate('job', 'title')
        .populate('company', 'companyName')
        .populate('approvedBy', 'email')
        .populate('partnerInvoice', 'invoiceNumber')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit),
      Payout.countDocuments(query)
    ]);

    const enrichedPayouts = payouts.map(p => ({
      ...p.toObject(),
      daysRemaining: p.getDaysRemaining(),
      isEligible: p.checkEligibility()
    }));

    const summary = await Payout.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount.netPayable' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        payouts: enrichedPayouts,
        summary: summary.reduce((acc, item) => {
          acc[item._id] = { count: item.count, amount: item.totalAmount };
          return acc;
        }, {}),
        pagination: {
          current: sanitizedPage,
          pages: Math.ceil(total / sanitizedLimit),
          total
        }
      }
    });
  } catch (error) {
    console.error('[ADMIN] Get payouts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payouts',
      error: error.message
    });
  }
};

// @desc    Get single payout details
// @route   GET /api/admin/payouts/:id
exports.getPayout = async (req, res) => {
  try {
    const Payout = require('../models/Payout');

    const payout = await Payout.findById(req.params.id)
      .populate('staffingPartner', 'firstName lastName firmName commercialDetails user')
      .populate('candidate', 'firstName lastName email offer joining commission')
      .populate('job', 'title company')
      .populate('company', 'companyName')
      .populate('approvedBy', 'email')
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
      message: 'Failed to fetch payout',
      error: error.message
    });
  }
};

// @desc    Approve payout
// @route   PUT /api/admin/payouts/:id/approve
exports.approvePayout = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const { notes } = req.body;

    const payout = await Payout.findById(req.params.id)
      .populate('staffingPartner', 'firstName lastName firmName user')
      .populate('candidate', 'firstName lastName');

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    if (payout.status !== 'ELIGIBLE') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve payout with status: ${payout.status}`,
        hint: payout.status === 'PENDING'
          ? `Wait until ${payout.replacementGuarantee.endDate.toDateString()} (${payout.getDaysRemaining()} days remaining)`
          : null
      });
    }

    payout.approve(req.user._id, notes);
    await payout.save();
    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'PAYOUT_APPROVED',
      entityType: 'Payout',
      entityId: payout._id,
      description: `Payout approved: Rs.${payout.amount.netPayable}`,
      notes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });


    const notificationEngine = require('../services/notificationEngine');
    if (payout.staffingPartner.user) {
      await notificationEngine.send({
        recipientId: payout.staffingPartner.user._id || payout.staffingPartner.user,
        type: 'PAYOUT_APPROVED',
        title: '✅ Payout Approved!',
        message: `Your payout of ₹${payout.amount.netPayable.toLocaleString('en-IN')} for ${payout.candidate.firstName} ${payout.candidate.lastName} has been approved and will be processed soon.`,
        data: {
          entityType: 'Payout',
          entityId: payout._id,
          actionUrl: '/partner/earnings'
        },
        channels: { inApp: true, email: true },
        priority: 'high'
      });
    }

    res.json({
      success: true,
      message: 'Payout approved successfully',
      data: payout
    });
  } catch (error) {
    console.error('[ADMIN] Approve payout error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve payout'
    });
  }
};

// @desc    Process payout (mark as paid)
// @route   PUT /api/admin/payouts/:id/process
exports.processPayout = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const Candidate = require('../models/Candidate');
    const commissionService = require('../services/commissionService');

    const { transactionId, utrNumber, paymentMethod, notes } = req.body;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }

    const payout = await Payout.findById(req.params.id)
      .populate('staffingPartner', 'firstName lastName firmName user commercialDetails')
      .populate('candidate', 'firstName lastName');

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    if (payout.status !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        message: `Cannot process payout with status: ${payout.status}. Must be APPROVED first.`
      });
    }

    payout.markPaid({
      method: paymentMethod || 'BANK_TRANSFER',
      transactionId,
      utrNumber,
      bankDetails: payout.staffingPartner.commercialDetails
    }, req.user._id);

    if (notes) payout.notes = notes;
    await payout.save();

    await Candidate.findByIdAndUpdate(payout.candidate._id, {
      'payout.status': 'PAID',
      'payout.paidAt': new Date(),
      'payout.transactionId': transactionId,
      'payout.utrNumber': utrNumber,
      'payout.paymentMethod': paymentMethod || 'BANK_TRANSFER'
    });

    await commissionService._updatePartnerMetrics(
      payout.staffingPartner._id,
      payout.amount.netPayable,
      'mark_paid'
    );

    const notificationEngine = require('../services/notificationEngine');
    if (payout.staffingPartner.user) {
      await notificationEngine.send({
        recipientId: payout.staffingPartner.user._id || payout.staffingPartner.user,
        type: 'PAYOUT_PAID',
        title: '💰 Payment Credited!',
        message: `₹${payout.amount.netPayable.toLocaleString('en-IN')} has been transferred to your bank account.\n\nTransaction ID: ${transactionId}\n${utrNumber ? `UTR: ${utrNumber}` : ''}`,
        data: {
          entityType: 'Payout',
          entityId: payout._id,
          actionUrl: '/partner/earnings',
          metadata: {
            amount: payout.amount.netPayable,
            transactionId,
            utrNumber
          }
        },
        channels: { inApp: true, email: true, whatsapp: true },
        priority: 'urgent'
      });
    }

    res.json({
      success: true,
      message: 'Payout processed successfully',
      data: payout
    });
  } catch (error) {
    console.error('[ADMIN] Process payout error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to process payout'
    });
  }
};

// @desc    Put payout on hold
// @route   PUT /api/admin/payouts/:id/hold
exports.holdPayout = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Hold reason is required'
      });
    }

    const payout = await Payout.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    if (!['PENDING', 'ELIGIBLE', 'APPROVED'].includes(payout.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot hold payout with status: ${payout.status}`
      });
    }

    payout.status = 'ON_HOLD';
    payout.heldBy = req.user._id;
    payout.heldAt = new Date();
    payout.holdReason = reason;
    payout.addHistory('HELD', req.user._id, reason);
    await payout.save();

    res.json({
      success: true,
      message: 'Payout put on hold',
      data: payout
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to hold payout',
      error: error.message
    });
  }
};

// @desc    Release payout from hold
// @route   PUT /api/admin/payouts/:id/release
exports.releasePayout = async (req, res) => {
  try {
    const Payout = require('../models/Payout');
    const { notes } = req.body;

    const payout = await Payout.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    if (payout.status !== 'ON_HOLD') {
      return res.status(400).json({
        success: false,
        message: 'Payout is not on hold'
      });
    }

    const newStatus = payout.checkEligibility() ? 'ELIGIBLE' : 'PENDING';

    payout.status = newStatus;
    payout.releasedBy = req.user._id;
    payout.releasedAt = new Date();
    payout.addHistory('RELEASED', req.user._id, notes || 'Released from hold');
    await payout.save();

    res.json({
      success: true,
      message: `Payout released, status: ${newStatus}`,
      data: payout
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to release payout',
      error: error.message
    });
  }
};

// @desc    Mark candidate as left early (forfeit payout)
// @route   POST /api/admin/payouts/:id/forfeit
exports.forfeitPayout = async (req, res) => {
  try {
    const commissionService = require('../services/commissionService');
    const Payout = require('../models/Payout');
    const { leftDate } = req.body;

    if (!leftDate) {
      return res.status(400).json({
        success: false,
        message: 'Left date is required'
      });
    }

    const payout = await Payout.findById(req.params.id);
    if (!payout) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }

    if (payout.status === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Cannot forfeit already paid payout'
      });
    }

    const result = await commissionService.handleCandidateLeftEarly(
      payout.candidate,
      leftDate,
      req.user._id
    );

    res.json({
      success: true,
      message: 'Payout forfeited due to candidate early exit',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to forfeit payout'
    });
  }
};

// @desc    Run eligibility check
// @route   POST /api/admin/payouts/check-eligibility
exports.checkPayoutEligibility = async (req, res) => {
  try {
    const commissionService = require('../services/commissionService');
    const result = await commissionService.checkEligiblePayouts();

    res.json({
      success: true,
      message: `Processed ${result.processed} payouts`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check eligibility',
      error: error.message
    });
  }
};

// @desc    Get All Users
// @route   GET /api/admin/users
exports.getUsers = async (req, res) => {
  try {
    const { role, status, page = 1, limit = 20, search } = req.query;

    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { email: new RegExp(search, 'i') },
        { mobile: new RegExp(search, 'i') }
      ];
    }

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((sanitizedPage - 1) * sanitizedLimit)
      .limit(sanitizedLimit);

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
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
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

// @desc    Suspend/Activate User
// @route   PUT /api/admin/users/:id/status
exports.updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );


    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_ACTIVATED',
      entityType: 'User',
      entityId: req.params.id,
      description: `User status changed to ${status}`,
      after: { status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });


    res.json({
      success: true,
      message: 'User status updated',
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Status update failed',
      error: error.message
    });
  }
};

// @desc    Get Analytics
// @route   GET /api/admin/analytics
exports.getAnalytics = async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    const endDate = new Date();
    let startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const registrationTrends = await User.aggregate([
      { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            role: '$role'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    const placementTrends = await Candidate.aggregate([
      {
        $match: {
          status: 'JOINED',
          'joining.confirmedAt': { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$joining.confirmedAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const topPartners = await StaffingPartner.find()
      .sort({ 'metrics.totalPlacements': -1 })
      .limit(10)
      .select('firstName lastName firmName metrics');

    const topCompanies = await Company.find()
      .sort({ 'metrics.totalHires': -1 })
      .limit(10)
      .select('companyName metrics');

    res.json({
      success: true,
      data: {
        registrationTrends,
        placementTrends,
        topPartners,
        topCompanies
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
};

// ==================== JOB APPROVAL WORKFLOW ====================

// @desc    Get pending jobs for approval
// @route   GET /api/admin/jobs/pending
exports.getPendingJobs = async (req, res) => {
  try {
    const { page = 1, limit = 20, sortBy = 'createdAt' } = req.query;

    const query = { approvalStatus: 'PENDING_APPROVAL' };

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));

    const jobs = await Job.find(query)
      .populate('company', 'companyName kyc.industry kyc.employeeCount')
      .populate('postedBy', 'email')
      .sort({ createdAt: sortBy === 'oldest' ? 1 : -1 })
      .skip((sanitizedPage - 1) * sanitizedLimit)
      .limit(sanitizedLimit);

    const total = await Job.countDocuments(query);

    const jobsWithAge = jobs.map(job => ({
      ...job.toObject(),
      submittedAge: Math.floor((Date.now() - job.createdAt) / (1000 * 60 * 60)),
      isStale: (Date.now() - job.createdAt) > (7 * 24 * 60 * 60 * 1000)
    }));

    res.json({
      success: true,
      data: {
        jobs: jobsWithAge,
        pagination: {
          current: sanitizedPage,
          pages: Math.ceil(total / sanitizedLimit),
          total
        },
        stats: {
          pending: total,
          stale: jobsWithAge.filter(j => j.isStale).length
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending jobs',
      error: error.message
    });
  }
};

// @desc    Approve job
// @route   PUT /api/admin/jobs/:id/approve
exports.approveJob = async (req, res) => {
  try {
    const { notes } = req.body;

    const job = await Job.findById(req.params.id)
      .populate('company', 'companyName user');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.approvalStatus !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve job with status: ${job.approvalStatus}`,
        currentStatus: job.approvalStatus
      });
    }

    job.approvalStatus = 'ACTIVE';
    job.status = 'ACTIVE';
    job.approvedBy = req.user._id;
    job.approvedAt = new Date();
    job.addToHistory('APPROVED', req.user._id, {}, notes || 'Job approved by admin');
    await job.save();

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'JOB_APPROVED',
      entityType: 'Job',
      entityId: job._id,
      description: `Job approved: ${job.title}`,
      notes,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const notificationEngine = require('../services/notificationEngine');

    if (job.company.user) {
      await notificationEngine.send({
        recipientId: job.company.user,
        type: 'JOB_APPROVED',
        title: `Job approved: "${job.title}"`,
        message: `Great news! Your job posting "${job.title}" has been approved and is now visible to talent partners.${notes ? `\n\nAdmin note: ${notes}` : ''}`,
        data: {
          entityType: 'Job',
          entityId: job._id,
          actionUrl: `/company/jobs/${job._id}`,
          metadata: {
            jobTitle: job.title,
            approvedAt: job.approvedAt,
            adminNotes: notes
          }
        },
        channels: { inApp: true, email: true },
        priority: 'high'
      });

      await emailService.sendJobApproved(
        job.company.user.email,
        job.company.companyName,
        job.title,
        job._id,
        notes
      );
    }

    res.json({
      success: true,
      message: 'Job approved successfully',
      data: {
        jobId: job._id,
        title: job.title,
        approvalStatus: 'ACTIVE',
        approvedAt: job.approvedAt,
        isVisibleToPartners: true
      }
    });
  } catch (error) {
    console.error('Approve job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve job',
      error: error.message
    });
  }
};

// @desc    Reject job
// @route   PUT /api/admin/jobs/:id/reject
exports.rejectJob = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide rejection reason (minimum 10 characters)'
      });
    }

    const job = await Job.findById(req.params.id)
      .populate('company', 'companyName user');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.approvalStatus !== 'PENDING_APPROVAL') {
      return res.status(400).json({
        success: false,
        message: `Cannot reject job with status: ${job.approvalStatus}`
      });
    }

    job.approvalStatus = 'REJECTED';
    job.status = 'DRAFT';
    job.rejectionReason = reason.trim();
    job.rejectedAt = new Date();
    job.addToHistory('REJECTED', req.user._id, {}, reason);
    await job.save();

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'JOB_REJECTED',
      entityType: 'Job',
      entityId: job._id,
      description: `Job rejected: ${job.title}`,
      notes: reason,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const notificationEngine = require('../services/notificationEngine');

    if (job.company.user) {
      await notificationEngine.send({
        recipientId: job.company.user,
        type: 'JOB_REJECTED',
        title: `Job requires revision: "${job.title}"`,
        message: `Your job posting "${job.title}" needs some updates before approval.\n\nReason: ${reason}\n\nPlease edit and resubmit for review.`,
        data: {
          entityType: 'Job',
          entityId: job._id,
          actionUrl: `/company/jobs/${job._id}/edit`,
          metadata: {
            jobTitle: job.title,
            rejectionReason: reason,
            rejectedAt: job.rejectedAt
          }
        },
        channels: { inApp: true, email: true },
        priority: 'high'
      });

      await emailService.sendJobRejected(
        job.company.user.email,
        job.company.companyName,
        job.title,
        reason,
        job._id
      );
    }

    res.json({
      success: true,
      message: 'Job rejected. Company has been notified to revise and resubmit.',
      data: {
        jobId: job._id,
        title: job.title,
        approvalStatus: 'REJECTED',
        rejectionReason: reason,
        rejectedAt: job.rejectedAt
      }
    });
  } catch (error) {
    console.error('Reject job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject job',
      error: error.message
    });
  }
};

// ==================== EDIT REQUEST WORKFLOW ====================

// @desc    Get pending edit requests
// @route   GET /api/admin/edit-requests/pending
exports.getPendingEditRequests = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');
    const { page = 1, limit = 20, priority, sortBy = 'priority' } = req.query;

    const query = { status: 'PENDING' };
    if (priority) query.priority = priority;

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));

    let sort = {};
    if (sortBy === 'priority') {
      sort = { createdAt: 1 };
    } else if (sortBy === 'oldest') {
      sort = { createdAt: 1 };
    } else {
      sort = { createdAt: -1 };
    }

    const editRequests = await JobEditRequest.find(query)
      .populate('job', 'title approvalStatus category location')
      .populate('company', 'companyName')
      .populate('requestedBy', 'email')
      .sort(sort)
      .skip((sanitizedPage - 1) * sanitizedLimit)
      .limit(sanitizedLimit);

    const total = await JobEditRequest.countDocuments(query);

    let sortedRequests = editRequests.map(req => ({
      ...req.toObject(),
      ageHours: Math.floor((Date.now() - req.createdAt) / (1000 * 60 * 60)),
      isStale: req.isStale()
    }));

    if (sortBy === 'priority') {
      const priorityOrder = { URGENT: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
      sortedRequests.sort((a, b) => {
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.createdAt - b.createdAt;
      });
    }

    const priorityStats = await JobEditRequest.aggregate([
      { $match: query },
      { $group: { _id: '$priority', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        editRequests: sortedRequests,
        pagination: {
          current: sanitizedPage,
          pages: Math.ceil(total / sanitizedLimit),
          total
        },
        stats: {
          total,
          stale: sortedRequests.filter(r => r.isStale).length,
          byPriority: priorityStats.reduce((acc, curr) => {
            acc[curr._id] = curr.count;
            return acc;
          }, {})
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch edit requests',
      error: error.message
    });
  }
};

// @desc    Get single edit request details
// @route   GET /api/admin/edit-requests/:id
exports.getEditRequest = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');

    const editRequest = await JobEditRequest.findById(req.params.id)
      .populate('job')
      .populate('company', 'companyName kyc user')
      .populate('requestedBy', 'email')
      .populate('reviewedBy', 'email');

    if (!editRequest) {
      return res.status(404).json({
        success: false,
        message: 'Edit request not found'
      });
    }

    const allEditRequests = await JobEditRequest.find({
      job: editRequest.job._id
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        editRequest: {
          ...editRequest.toObject(),
          ageHours: Math.floor((Date.now() - editRequest.createdAt) / (1000 * 60 * 60)),
          isStale: editRequest.isStale()
        },
        jobEditHistory: allEditRequests,
        jobStats: editRequest.job.getEditStats()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch edit request',
      error: error.message
    });
  }
};

// @desc    Approve edit request
// @route   PUT /api/admin/edit-requests/:id/approve
exports.approveEditRequest = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');
    const { notes } = req.body;

    const editRequest = await JobEditRequest.findById(req.params.id)
      .populate('job')
      .populate('company', 'companyName user');

    if (!editRequest) {
      return res.status(404).json({
        success: false,
        message: 'Edit request not found'
      });
    }

    if (editRequest.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Edit request is already ${editRequest.status.toLowerCase()}`,
        currentStatus: editRequest.status
      });
    }
    const job = editRequest.job;
    const changes = editRequest.requestedChanges;
    const appliedChanges = {};

    for (const [field, change] of Object.entries(changes)) {
      try {
        const keys = field.split('.');
        let target = job;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]]) target[keys[i]] = {};
          target = target[keys[i]];
        }

        const lastKey = keys[keys.length - 1];
        const oldValue = target[lastKey];

        appliedChanges[field] = {
          old: oldValue,
          new: change.new
        };

        target[lastKey] = change.new;
      } catch (err) {
        console.error(`Failed to apply change for field ${field}:`, err);
      }
    }

    job.applyEditChanges(appliedChanges);

    // Also mark all top level keys as modified
    const topLevelKeys = [...new Set(Object.keys(changes).map(f => f.split('.')[0]))];
    topLevelKeys.forEach(key => job.markModified(key));

    job.applyEditChanges(appliedChanges);
    job.approvalStatus = 'ACTIVE';
    job.approvedEditCount += 1;
    job.addToHistory('EDIT_APPROVED', req.user._id, appliedChanges, notes || 'Edit request approved');
    await job.save();

    editRequest.status = 'APPROVED';
    editRequest.reviewedBy = req.user._id;
    editRequest.reviewedAt = new Date();
    editRequest.adminResponse = notes;
    editRequest.appliedAt = new Date();
    editRequest.appliedChanges = appliedChanges;
    await editRequest.save();

    const notificationEngine = require('../services/notificationEngine');

    if (editRequest.company.user) {
      await notificationEngine.send({
        recipientId: editRequest.company.user,
        type: 'JOB_EDIT_APPROVED',
        title: `Edit approved for "${job.title}"`,
        message: `Your requested changes to "${job.title}" have been approved and applied.${notes ? `\n\nAdmin note: ${notes}` : ''}`,
        data: {
          entityType: 'Job',
          entityId: job._id,
          actionUrl: `/company/jobs/${job._id}`,
          metadata: {
            jobTitle: job.title,
            appliedChanges: Object.keys(appliedChanges),
            changeCount: Object.keys(appliedChanges).length
          }
        },
        channels: { inApp: true, email: true },
        priority: 'high'
      });

      await emailService.sendEditRequestApproved(
        editRequest.company.user.email,
        editRequest.company.companyName,
        job.title,
        appliedChanges,
        notes,
        job._id
      );
    }

    res.json({
      success: true,
      message: 'Edit request approved and changes applied successfully',
      data: {
        editRequestId: editRequest._id,
        jobId: job._id,
        appliedChanges,
        changeCount: Object.keys(appliedChanges).length,
        jobStats: job.getEditStats()
      }
    });
  } catch (error) {
    console.error('Approve edit request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve edit request',
      error: error.message
    });
  }
};

// @desc    Reject edit request
// @route   PUT /api/admin/edit-requests/:id/reject
exports.rejectEditRequest = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide detailed rejection reason (minimum 10 characters)'
      });
    }

    const editRequest = await JobEditRequest.findById(req.params.id)
      .populate('job')
      .populate('company', 'companyName user');

    if (!editRequest) {
      return res.status(404).json({
        success: false,
        message: 'Edit request not found'
      });
    }

    if (editRequest.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Edit request is already ${editRequest.status.toLowerCase()}`
      });
    }

    const job = editRequest.job;

    editRequest.status = 'REJECTED';
    editRequest.reviewedBy = req.user._id;
    editRequest.reviewedAt = new Date();
    editRequest.adminResponse = reason.trim();
    await editRequest.save();

    job.approvalStatus = 'ACTIVE';
    job.rejectedEditCount += 1;
    job.addToHistory('EDIT_REJECTED', req.user._id, editRequest.requestedChanges, reason);
    await job.save();

    const jobStats = job.getEditStats();
    const shouldWarn = job.rejectedEditCount >= 3;
    const shouldDiscontinue = job.rejectedEditCount >= 5;

    const notificationEngine = require('../services/notificationEngine');

    let warningMessage = '';
    if (shouldDiscontinue) {
      warningMessage = '\n\n🚨 CRITICAL: This job has 5+ rejected edit requests. It may be discontinued. Please create a new job posting with finalized requirements.';
    } else if (shouldWarn) {
      warningMessage = '\n\n⚠️ Warning: This job has 3+ rejected edit requests. Further rejections may result in discontinuation.';
    }

    if (editRequest.company.user) {
      await notificationEngine.send({
        recipientId: editRequest.company.user,
        type: 'JOB_EDIT_REJECTED',
        title: `Edit request rejected for "${job.title}"`,
        message: `Your edit request for "${job.title}" could not be approved.\n\nReason: ${reason}${warningMessage}`,
        data: {
          entityType: 'Job',
          entityId: job._id,
          actionUrl: `/company/jobs/${job._id}`,
          metadata: {
            jobTitle: job.title,
            rejectionReason: reason,
            rejectedEditCount: job.rejectedEditCount,
            warning: shouldWarn,
            critical: shouldDiscontinue,
            jobStats
          }
        },
        channels: { inApp: true, email: true },
        priority: shouldDiscontinue ? 'urgent' : (shouldWarn ? 'high' : 'medium')
      });

      await emailService.sendEditRequestRejected(
        editRequest.company.user.email,
        editRequest.company.companyName,
        job.title,
        reason,
        job.rejectedEditCount,
        shouldWarn,
        job._id
      );
    }

    res.json({
      success: true,
      message: 'Edit request rejected',
      data: {
        editRequestId: editRequest._id,
        jobId: job._id,
        rejectionReason: reason,
        jobStats,
        warning: shouldWarn ? {
          level: shouldDiscontinue ? 'CRITICAL' : 'WARNING',
          message: shouldDiscontinue
            ? '5+ rejected edits. Consider discontinuing this job.'
            : '3+ rejected edits. Monitor for excessive edit requests.',
          rejectedEditCount: job.rejectedEditCount
        } : null
      }
    });
  } catch (error) {
    console.error('Reject edit request error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject edit request',
      error: error.message
    });
  }
};

// @desc    Discontinue job
// @route   POST /api/admin/jobs/:id/discontinue
exports.discontinueJob = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason || reason.trim().length < 20) {
      return res.status(400).json({
        success: false,
        message: 'Please provide detailed discontinuation reason (minimum 20 characters)'
      });
    }

    const job = await Job.findById(req.params.id)
      .populate('company', 'companyName user');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.approvalStatus === 'DISCONTINUED') {
      return res.status(400).json({
        success: false,
        message: 'Job is already discontinued'
      });
    }

    job.approvalStatus = 'DISCONTINUED';
    job.status = 'CLOSED';
    job.discontinuedReason = reason.trim();
    job.discontinuedBy = req.user._id;
    job.discontinuedAt = new Date();
    job.addToHistory('DISCONTINUED', req.user._id, {}, reason);
    await job.save();

    const JobEditRequest = require('../models/JobEditRequest');
    await JobEditRequest.updateMany(
      { job: job._id, status: 'PENDING' },
      { status: 'SUPERSEDED' }
    );

    const notificationEngine = require('../services/notificationEngine');

    if (job.company.user) {
      await notificationEngine.send({
        recipientId: job.company.user,
        type: 'JOB_DISCONTINUED',
        title: `Job discontinued: "${job.title}"`,
        message: `Your job posting "${job.title}" has been discontinued.\n\nReason: ${reason}\n\n📝 Next steps: Please create a new job posting with finalized and clear requirements.`,
        data: {
          entityType: 'Job',
          entityId: job._id,
          actionUrl: `/company/jobs/create`,
          metadata: {
            jobTitle: job.title,
            discontinuedReason: reason,
            discontinuedAt: job.discontinuedAt,
            editStats: job.getEditStats()
          }
        },
        channels: { inApp: true, email: true },
        priority: 'urgent'
      });

      await emailService.sendJobDiscontinued(
        job.company.user.email,
        job.company.companyName,
        job.title,
        reason,
        job.getEditStats()
      );
    }

    res.json({
      success: true,
      message: 'Job discontinued successfully. Company has been notified.',
      data: {
        jobId: job._id,
        title: job.title,
        approvalStatus: 'DISCONTINUED',
        discontinuedReason: reason,
        discontinuedAt: job.discontinuedAt,
        pendingEditRequestsCancelled: await JobEditRequest.countDocuments({
          job: job._id,
          status: 'SUPERSEDED'
        })
      }
    });
  } catch (error) {
    console.error('Discontinue job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to discontinue job',
      error: error.message
    });
  }
};

// @desc    Get job edit history
// @route   GET /api/admin/jobs/:id/edit-history
exports.getJobEditHistory = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');

    const job = await Job.findById(req.params.id)
      .populate('company', 'companyName')
      .populate('approvedBy', 'email')
      .populate('discontinuedBy', 'email');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const editRequests = await JobEditRequest.find({ job: job._id })
      .populate('requestedBy', 'email')
      .populate('reviewedBy', 'email')
      .sort({ createdAt: -1 });

    const changeHistory = job.changeHistory.sort((a, b) => b.changedAt - a.changedAt);

    res.json({
      success: true,
      data: {
        job: {
          id: job._id,
          title: job.title,
          approvalStatus: job.approvalStatus,
          createdAt: job.createdAt,
          approvedAt: job.approvedAt,
          discontinuedAt: job.discontinuedAt
        },
        stats: job.getEditStats(),
        editRequests,
        changeHistory,
        timeline: exports._buildTimeline(job, editRequests, changeHistory)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch edit history',
      error: error.message
    });
  }
};

// Helper: Build combined timeline
exports._buildTimeline = (job, editRequests, changeHistory) => {
  const events = [];

  events.push({
    type: 'CREATED',
    timestamp: job.createdAt,
    description: 'Job created'
  });

  changeHistory.forEach(change => {
    events.push({
      type: change.changeType,
      timestamp: change.changedAt,
      description: change.notes || `Job ${change.changeType.toLowerCase()}`,
      changes: change.changes
    });
  });

  editRequests.forEach(req => {
    events.push({
      type: 'EDIT_REQUEST_CREATED',
      timestamp: req.createdAt,
      description: `Edit request created (${req.priority})`,
      editRequestId: req._id,
      status: req.status
    });

    if (req.reviewedAt) {
      events.push({
        type: `EDIT_REQUEST_${req.status}`,
        timestamp: req.reviewedAt,
        description: `Edit request ${req.status.toLowerCase()}`,
        editRequestId: req._id
      });
    }
  });

  return events.sort((a, b) => b.timestamp - a.timestamp);
};

// ==================== ADMIN REGISTRY ENDPOINTS ====================

// @desc    Get all jobs (admin full registry)
// @route   GET /api/admin/jobs
exports.getAllJobs = async (req, res) => {
  try {
    const {
      status,
      approvalStatus,
      company,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (approvalStatus) query.approvalStatus = approvalStatus;
    if (company) query.company = company;
    if (search) {
      query.$or = [
        { title: new RegExp(search, 'i') },
        { category: new RegExp(search, 'i') }
      ];
    }

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('company', 'companyName kyc.industry uniqueId')
        .populate('postedBy', 'email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit),
      Job.countDocuments(query)
    ]);

    const statusSummary = await Job.aggregate([
      { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        jobs,
        summary: statusSummary.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
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
      message: 'Failed to fetch jobs',
      error: error.message
    });
  }
};

// @desc    Get single job full detail (admin)
// @route   GET /api/admin/jobs/:id/detail
exports.getJobDetail = async (req, res) => {
  try {
    const JobEditRequest = require('../models/JobEditRequest');

    const job = await Job.findById(req.params.id)
      .populate('company', 'companyName kyc billing uniqueId verificationStatus')
      .populate('postedBy', 'email mobile')
      .populate('approvedBy', 'email role')
      .populate('discontinuedBy', 'email role');

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const candidates = await Candidate.find({ job: job._id })
      .populate('submittedBy', 'firmName firstName lastName')
      .sort({ createdAt: -1 })
      .select('firstName lastName status createdAt submittedBy');

    const editRequests = await JobEditRequest.find({ job: job._id })
      .populate('requestedBy', 'email')
      .populate('reviewedBy', 'email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        job,
        candidates: {
          total: candidates.length,
          list: candidates
        },
        editRequests,
        stats: job.getEditStats()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job detail',
      error: error.message
    });
  }
};

// @desc    Admin: Get Candidates for Review
// @route   GET /api/admin/jobs/:jobId/candidates
exports.getCandidatesForReview = async (req, res) => {
  try {
    const { jobId } = req.params;
    // Only Admins should access this (Ensure Middleware)
    
    const candidates = await Candidate.find({ job: jobId })
      .populate('submittedBy', 'firmName')
      .select('firstName lastName email mobile status consent.consentStatus resume totalExperience location')
      .sort({ createdAt: -1 });

    res.json({ success: true, count: candidates.length, data: candidates });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Admin: Select Candidates & Share with Client
// @route   POST /api/admin/candidates/forward-to-client
exports.forwardCandidatesToClient = async (req, res) => {
  try {
    const { candidateIds } = req.body; // Array of IDs

    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ success: false, message: "Please select at least one candidate" });
    }

    const candidates = await Candidate.find({ _id: { $in: candidateIds } }).populate('job company');

    const validCandidates = [];
    const errors = [];

    for (const candidate of candidates) {
      // CONSTRAINT: Resume must be uploaded before sharing with client
      if (!candidate.resume || !candidate.resume.url) {
        errors.push({
          id: candidate._id,
          name: `${candidate.firstName} ${candidate.lastName}`,
          reason: "Resume not uploaded. Cannot share with client."
        });
        continue;
      }

      // CONSTRAINT: Consent must be Agreed
      if (candidate.status !== 'SUBMITTED') {
        errors.push({
          id: candidate._id,
          name: `${candidate.firstName} ${candidate.lastName}`,
          reason: `Invalid status: ${candidate.status}. Only agreed candidates can be shared.`
        });
        continue;
      }

      validCandidates.push(candidate);
    }

    if (validCandidates.length === 0) {
      return res.status(400).json({ success: false, message: "No candidates eligible for forwarding", errors });
    }

    // Update Status & Notify Client
    const updatePromises = validCandidates.map(async (cand) => {
      cand.status = 'FORWARDED_TO_CLIENT';
      cand.statusHistory.push({
        status: 'FORWARDED_TO_CLIENT',
        changedBy: req.user._id, // Admin ID
        notes: 'Selected by Admin for Client Review'
      });
      await cand.save();

      // Notify Company/Client
      if (cand.company) {
        await notificationEngine.send({
          recipientId: cand.company.user, // Assuming company has user ref
          type: "NEW_CANDIDATE_FROM_ADMIN",
          title: `Shortlisted Candidate: ${cand.firstName} ${cand.lastName}`,
          message: `Admin has forwarded a candidate for ${cand.job.title}. Resume attached.`,
          data: { entityId: cand._id, actionUrl: `/company/jobs/${cand.job._id}/candidates` },
          channels: { inApp: true, email: true }
        });
      }
    });

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: `${validCandidates.length} candidates forwarded to client successfully.`,
      data: { forwarded: validCandidates.length, failed: errors }
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all candidates (admin registry)
// @route   GET /api/admin/candidates
exports.getAllCandidates = async (req, res) => {
  try {
    const {
      status,
      job,
      company,
      partner,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const query = {};
    if (status) query.status = status;
    if (job) query.job = job;
    if (company) query.company = company;
    if (partner) query.submittedBy = partner;
    if (search) {
      query.$or = [
        { firstName: new RegExp(search, 'i') },
        { lastName: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
        { mobile: new RegExp(search, 'i') }
      ];
    }

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [candidates, total] = await Promise.all([
      Candidate.find(query)
        .populate('submittedBy', 'firmName firstName lastName uniqueId')
        .populate('job', 'title uniqueId')
        .populate('company', 'companyName uniqueId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit)
        .select('-statusHistory -notes -qualityCheck'),
      Candidate.countDocuments(query)
    ]);

    const statusSummary = await Candidate.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        candidates,
        summary: statusSummary.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
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
      message: 'Failed to fetch candidates',
      error: error.message
    });
  }
};

// @desc    Get single candidate full detail (admin)
// @route   GET /api/admin/candidates/:id
exports.getCandidateDetail = async (req, res) => {
  try {
    const candidate = await Candidate.findById(req.params.id)
      .populate('submittedBy', 'firmName firstName lastName uniqueId commercialDetails')
      .populate('job', 'title uniqueId company')
      .populate('company', 'companyName uniqueId')
      .populate('statusHistory.changedBy', 'email role');

    if (!candidate) {
      return res.status(404).json({
        success: false,
        message: 'Candidate not found'
      });
    }

    res.json({
      success: true,
      data: candidate
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch candidate',
      error: error.message
    });
  }
};

// @desc    Get all partners (admin registry)
// @route   GET /api/admin/partners
exports.getAllPartners = async (req, res) => {
  try {
    const {
      verificationStatus,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const query = {};
    if (verificationStatus) query.verificationStatus = verificationStatus;
    if (search) {
      query.$or = [
        { firmName: new RegExp(search, 'i') },
        { firstName: new RegExp(search, 'i') },
        { lastName: new RegExp(search, 'i') }
      ];
    }

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [partners, total] = await Promise.all([
      StaffingPartner.find(query)
        .populate('user', 'email mobile status lastLogin')
        .populate('verifiedBy', 'email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit)
        .select('-documents -compliance'),
      StaffingPartner.countDocuments(query)
    ]);

    const statusSummary = await StaffingPartner.aggregate([
      { $group: { _id: '$verificationStatus', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        partners,
        summary: statusSummary.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
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
      message: 'Failed to fetch partners',
      error: error.message
    });
  }
};

// @desc    Get single partner full detail (admin)
// @route   GET /api/admin/partners/:id
exports.getPartnerDetail = async (req, res) => {
  try {
    const partner = await StaffingPartner.findById(req.params.id)
      .populate('user', 'email mobile status lastLogin createdAt')
      .populate('verifiedBy', 'email role');

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Partner not found'
      });
    }

    // Get submission and placement stats
    const submissionStats = await Candidate.aggregate([
      { $match: { submittedBy: partner._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Get recent submissions
    const recentSubmissions = await Candidate.find({ submittedBy: partner._id })
      .populate('job', 'title')
      .populate('company', 'companyName')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('firstName lastName status job company createdAt');

    // Get payout info
    const Payout = require('../models/Payout');
    const payoutSummary = await Payout.aggregate([
      { $match: { staffingPartner: partner._id } },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount.netPayable' } } }
    ]);

    res.json({
      success: true,
      data: {
        partner,
        submissionStats: submissionStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        payoutSummary: payoutSummary.reduce((acc, item) => {
          acc[item._id] = { count: item.count, amount: item.amount };
          return acc;
        }, {}),
        recentSubmissions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch partner detail',
      error: error.message
    });
  }
};

// @desc    Get all companies (admin registry)
// @route   GET /api/admin/companies
exports.getAllCompanies = async (req, res) => {
  try {
    const {
      verificationStatus,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const query = {};
    if (verificationStatus) query.verificationStatus = verificationStatus;
    if (search) {
      query.$or = [
        { companyName: new RegExp(search, 'i') },
        { 'kyc.industry': new RegExp(search, 'i') }
      ];
    }

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [companies, total] = await Promise.all([
      Company.find(query)
        .populate('user', 'email mobile status lastLogin')
        .populate('verifiedBy', 'email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit)
        .select('-documents -legalConsents -billing'),
      Company.countDocuments(query)
    ]);

    const statusSummary = await Company.aggregate([
      { $group: { _id: '$verificationStatus', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        companies,
        summary: statusSummary.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
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
      message: 'Failed to fetch companies',
      error: error.message
    });
  }
};

// @desc    Get single company full detail (admin)
// @route   GET /api/admin/companies/:id
exports.getCompanyDetail = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id)
      .populate('user', 'email mobile status lastLogin createdAt')
      .populate('verifiedBy', 'email role');

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Get job stats
    const jobStats = await Job.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: '$approvalStatus', count: { $sum: 1 } } }
    ]);

    // Get recent jobs
    const recentJobs = await Job.find({ company: company._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('title approvalStatus status createdAt vacancies');

    // Get candidate pipeline
    const candidateStats = await Candidate.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        company,
        jobStats: jobStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        candidateStats: candidateStats.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {}),
        recentJobs
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company detail',
      error: error.message
    });
  }
};

// ==================== AUDIT LOG ====================

// @desc    Get audit logs
// @route   GET /api/admin/audit-logs
exports.getAuditLogs = async (req, res) => {
  try {
    const AdminActionLog = require('../models/AdminActionLog');
    const {
      actor,
      action,
      entityType,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};
    if (actor) query.actor = actor;
    if (action) query.action = action;
    if (entityType) query.entityType = entityType;

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [logs, total] = await Promise.all([
      AdminActionLog.find(query)
        .populate('actor', 'email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit),
      AdminActionLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        logs,
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
      message: 'Failed to fetch audit logs',
      error: error.message
    });
  }
};