// backend/controllers/adminController.js
const User = require('../models/User');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const { PERMISSIONS } = require('../utils/permissions');
const emailService = require('../services/emailService');

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

        // Navigate and set the value
        let target = job;
        for (let i = 0; i < keys.length - 1; i++) {
          if (target[keys[i]] === undefined || target[keys[i]] === null) {
            target[keys[i]] = {};
          }
          target = target[keys[i]];
        }

        const lastKey = keys[keys.length - 1];
        const oldValue = JSON.parse(JSON.stringify(target[lastKey] ?? null));
        target[lastKey] = change.new;

        appliedChanges[field] = {
          old: oldValue,
          new: change.new
        };

        // Mark nested fields as modified for Mongoose
        const topLevelKey = keys[0];
        job.markModified(topLevelKey);

      } catch (err) {
        console.error(`[EDIT REQUEST] Failed to apply field ${field}:`, err.message);
      }
    }

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