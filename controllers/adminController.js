// backend/controllers/adminController.js
const User = require('../models/User');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const Payout = require('../models/Payout');
const emailService = require('../services/emailService');

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
      },
      pendingPayouts: await Payout.countDocuments({ status: 'PENDING' })
    };

    // Recent activities
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
      partners = await StaffingPartner.find({ verificationStatus: 'UNDER_REVIEW' })
        .populate('user', 'email mobile createdAt')
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
    const partner = await StaffingPartner.findById(req.params.id);
    const user = await User.findById(partner.user);

    if (action === 'approve') {
      partner.verificationStatus = 'APPROVED';
      partner.verifiedBy = req.user._id;
      partner.verifiedAt = new Date();
      partner.verificationNotes = notes;
      
      user.status = 'VERIFIED';
      
      // Send approval email
      await emailService.sendVerificationApproved(user.email, partner.fullName, 'staffing_partner');
    } else if (action === 'reject') {
      partner.verificationStatus = 'REJECTED';
      partner.rejectionReason = rejectionReason;
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
    const company = await Company.findById(req.params.id);
    const user = await User.findById(company.user);

    if (action === 'approve') {
      company.verificationStatus = 'APPROVED';
      company.verifiedBy = req.user._id;
      company.verifiedAt = new Date();
      company.verificationNotes = notes;
      
      user.status = 'VERIFIED';
      
      // ✅ Use decisionMakerName directly
      await emailService.sendVerificationApproved(
        user.email, 
        company.decisionMakerName,  // ✅ Full name
        'company'
      );
    } else if (action === 'reject') {
      company.verificationStatus = 'REJECTED';
      company.rejectionReason = rejectionReason;
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
    res.status(500).json({
      success: false,
      message: 'Verification action failed',
      error: error.message
    });
  }
};


// @desc    Manage Payouts
// @route   GET /api/admin/payouts
exports.getPayouts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;

    const payouts = await Payout.find(query)
      .populate('staffingPartner', 'firstName lastName firmName financeDetails')
      .populate('candidate', 'firstName lastName')
      .populate('job', 'title')
      .populate('company', 'companyName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await Payout.countDocuments(query);

    res.json({
      success: true,
      data: {
        payouts,
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
      message: 'Failed to fetch payouts',
      error: error.message
    });
  }
};

// @desc    Process Payout
// @route   PUT /api/admin/payouts/:id
exports.processPayout = async (req, res) => {
  try {
    const { action, transactionId, utrNumber, rejectionReason } = req.body;
    const payout = await Payout.findById(req.params.id);

    if (action === 'approve') {
      payout.status = 'APPROVED';
      payout.approvedBy = req.user._id;
      payout.approvedAt = new Date();
    } else if (action === 'process') {
      payout.status = 'PROCESSING';
    } else if (action === 'complete') {
      payout.status = 'PAID';
      payout.paymentDetails.transactionId = transactionId;
      payout.paymentDetails.utrNumber = utrNumber;
      payout.paymentDetails.paidAt = new Date();

      // Update partner metrics
      const partner = await StaffingPartner.findById(payout.staffingPartner);
      partner.metrics.totalEarnings += payout.amount.net;
      partner.metrics.pendingPayouts -= payout.amount.gross;
      await partner.save();
    } else if (action === 'reject') {
      payout.status = 'REJECTED';
      payout.rejectionReason = rejectionReason;
    }

    await payout.save();

    res.json({
      success: true,
      message: `Payout ${action} successfully`,
      data: payout
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Payout action failed',
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

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
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

    // Calculate date range
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

    // Registration trends
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

    // Placement trends
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
          count: { $sum: 1 },
          totalValue: { $sum: '$payout.commissionAmount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Top performing partners
    const topPartners = await StaffingPartner.find()
      .sort({ 'metrics.totalPlacements': -1 })
      .limit(10)
      .select('firstName lastName firmName metrics');

    // Top hiring companies
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






