// backend/controllers/invoiceController.js — PAYOUT/COMMISSION DISABLED

const Invoice = require('../models/Invoice');
const Company = require('../models/Company');
const Candidate = require('../models/Candidate');
const StaffingPartner = require('../models/StaffingPartner');

/* ========== AUTO-GENERATE INVOICE - DISABLED ==========
/**
 * Auto-generate invoice when candidate joins
 * Called internally by candidateLifecycleService
 * DISABLED: Payout/Commission system not active
 */
/*
exports.generateInvoice = async (candidateId) => {
  try {
    const candidate = await Candidate.findById(candidateId)
      .populate('job', 'title commission')
      .populate('company', 'companyName billing kyc')
      .populate('submittedBy', 'firstName lastName firmName');

    if (!candidate || candidate.status !== 'JOINED') {
      throw new Error('Candidate must have JOINED status');
    }

    // Check if invoice already exists
    const existing = await Invoice.findOne({ candidate: candidateId });
    if (existing) return existing;

    // Calculate amounts
    const baseAmount = candidate.payout?.commissionAmount || 0;
    const gstPercentage = 18;
    const gstAmount = Math.round(baseAmount * gstPercentage / 100);
    const totalAmount = baseAmount + gstAmount;

    // Due date based on company payment terms
    const termDays = {
      'Immediate': 0, 'Net 15': 15, 'Net 30': 30, 'Net 45': 45, 'Net 60': 60
    };
    const days = termDays[candidate.company?.billing?.paymentTerms] || 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    const invoice = await Invoice.create({
      company: candidate.company._id,
      candidate: candidate._id,
      job: candidate.job._id,
      staffingPartner: candidate.submittedBy._id,
      amount: {
        baseAmount,
        gstPercentage,
        gstAmount,
        totalAmount,
        currency: 'INR'
      },
      billingDetails: {
        companyName: candidate.company.billing?.billingEntityName || candidate.company.companyName,
        companyAddress: formatAddress(candidate.company.billing?.billingAddress || candidate.company.kyc?.registeredAddress),
        companyGST: candidate.company.billing?.gstNumber || candidate.company.kyc?.gstNumber,
        companyPAN: candidate.company.billing?.panNumber || candidate.company.kyc?.panNumber
      },
      dueDate,
      status: 'DRAFT'
    });

    console.log(`[INVOICE] Generated ${invoice.invoiceNumber} — ₹${totalAmount.toLocaleString('en-IN')}`);
    return invoice;
  } catch (error) {
    console.error('[INVOICE] Generation error:', error.message);
    throw error;
  }
};
*/
// ========== END AUTO-GENERATE INVOICE ========== */

/**
 * Auto-generate invoice — STUB
 * Returns null (invoice system disabled)
 */
exports.generateInvoice = async (candidateId) => {
  console.log(`[INVOICE] Invoice generation is disabled (payout system inactive) — Candidate ID: ${candidateId}`);
  return null;
};

/**
 * Get invoices — STUB
 * Returns empty array (invoice system disabled)
 */
exports.getInvoices = async (req, res) => {
  res.json({
    success: true,
    message: 'Invoice system is currently disabled',
    data: {
      invoices: [],
      summary: [],
      pagination: {
        current: 1,
        pages: 0,
        total: 0
      }
    }
  });
};

/**
 * Get single invoice — STUB
 * Returns 404 (invoice system disabled)
 */
exports.getInvoice = async (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Invoice system is currently disabled'
  });
};

/**
 * Mark invoice as sent — STUB
 * Returns 404 (invoice system disabled)
 */
exports.sendInvoice = async (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Invoice system is currently disabled'
  });
};

/**
 * Record payment for invoice — STUB
 * Returns 404 (invoice system disabled)
 */
exports.recordPayment = async (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Invoice system is currently disabled'
  });
};

/* ========== ORIGINAL IMPLEMENTATIONS - COMMENTED OUT ==========

// Get invoices — role-based filtering
exports.getInvoices = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === 'company') {
      const company = await Company.findOne({ user: req.user._id });
      if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
      query.company = company._id;
    } else if (req.user.role === 'staffing_partner') {
      const partner = await StaffingPartner.findOne({ user: req.user._id });
      if (!partner) return res.status(404).json({ success: false, message: 'Partner not found' });
      query.staffingPartner = partner._id;
    }
    // Admin sees all

    const { status, page = 1, limit = 20 } = req.query;
    if (status) query.status = status;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, parseInt(limit));
    const skip = (pageNum - 1) * limitNum;

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .populate('company', 'companyName')
        .populate('candidate', 'firstName lastName')
        .populate('job', 'title')
        .populate('staffingPartner', 'firstName lastName firmName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Invoice.countDocuments(query)
    ]);

    // Summary
    const summary = await Invoice.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount.totalAmount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        invoices,
        summary,
        pagination: {
          current: pageNum,
          pages: Math.ceil(total / limitNum),
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

// Get single invoice
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('company', 'companyName kyc billing')
      .populate('candidate', 'firstName lastName email offer joining')
      .populate('job', 'title commission')
      .populate('staffingPartner', 'firstName lastName firmName firmDetails');

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Authorization check
    if (req.user.role === 'company') {
      const company = await Company.findOne({ user: req.user._id });
      if (invoice.company._id.toString() !== company._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    } else if (req.user.role === 'staffing_partner') {
      const partner = await StaffingPartner.findOne({ user: req.user._id });
      if (invoice.staffingPartner._id.toString() !== partner._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    }

    res.json({ success: true, data: invoice });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoice',
      error: error.message
    });
  }
};

// Mark invoice as sent (Admin only)
exports.sendInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    invoice.status = 'SENT';
    await invoice.save();

    // Send email notification to company
    const emailService = require('../services/emailService');
    const company = await Company.findById(invoice.company).populate('user', 'email');

    if (company?.user?.email) {
      await emailService.sendEmail({
        to: company.user.email,
        subject: `Invoice ${invoice.invoiceNumber} — Syncro1`,
        html: `
          <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
            <h2>Invoice ${invoice.invoiceNumber}</h2>
            <p><strong>Amount:</strong> ₹${invoice.amount.totalAmount.toLocaleString('en-IN')}</p>
            <p><strong>Due Date:</strong> ${invoice.dueDate.toDateString()}</p>
            <p>Please review and process the payment from your dashboard.</p>
          </div>
        `
      });
    }

    res.json({
      success: true,
      message: 'Invoice sent successfully',
      data: invoice
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send invoice',
      error: error.message
    });
  }
};

// Record payment for invoice (Admin or Company)
exports.recordPayment = async (req, res) => {
  try {
    const { transactionId, paymentMethod, notes } = req.body;

    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    invoice.status = 'PAID';
    invoice.payment = {
      paidAt: new Date(),
      transactionId,
      paymentMethod,
      notes
    };
    await invoice.save();

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      data: invoice
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  }
};

// Helper
function formatAddress(addr) {
  if (!addr) return '';
  return [addr.street, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
}

========== END ORIGINAL IMPLEMENTATIONS ========== */