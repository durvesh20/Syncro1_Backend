// backend/controllers/invoiceController.js - COMPLETE REWRITE

const Invoice = require('../models/Invoice');
const Company = require('../models/Company');
const Candidate = require('../models/Candidate');
const StaffingPartner = require('../models/StaffingPartner');

// Commission configuration
const COMMISSION_CONFIG = {
  PARTNER_RATE: 5,
  GST_RATE: 18,
  TDS_RATE: 10,
  HSN_SAC_CODE: '998519'
};

/**
 * Auto-generate partner invoice when candidate joins
 * Called by commissionService
 */
exports.generatePartnerInvoice = async (candidateId, payoutId) => {
  try {
    const candidate = await Candidate.findById(candidateId)
      .populate('job', 'title')
      .populate('company', 'companyName billing kyc')
      .populate({
        path: 'submittedBy',
        select: 'firstName lastName firmName commercialDetails firmDetails',
        populate: { path: 'user', select: 'email mobile' }
      });

    if (!candidate || candidate.status !== 'JOINED') {
      throw new Error('Candidate must have JOINED status');
    }

    if (!candidate.commission || !candidate.commission.commissionAmount) {
      throw new Error('Commission not calculated for candidate');
    }

    // Check if invoice already exists
    const existing = await Invoice.findOne({
      candidate: candidateId,
      invoiceType: 'PARTNER_TO_SYNCRO1'
    });

    if (existing) {
      console.log(`[INVOICE] Partner invoice already exists: ${existing.invoiceNumber}`);
      return existing;
    }

    const partner = candidate.submittedBy;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    // Build invoice
    const invoice = await Invoice.create({
      invoiceType: 'PARTNER_TO_SYNCRO1',

      from: {
        entityType: 'PARTNER',
        entityId: partner._id,
        name: partner.commercialDetails?.payoutEntityName || partner.firmName,
        address: formatAddress(partner.firmDetails?.registeredOfficeAddress),
        gstin: partner.firmDetails?.gstNumber,
        pan: partner.firmDetails?.panNumber,
        email: partner.user?.email,
        phone: partner.user?.mobile
      },

      to: {
        entityType: 'SYNCRO1',
        name: process.env.SYNCRO1_COMPANY_NAME || 'Syncro1 Technologies Pvt Ltd',
        address: process.env.SYNCRO1_ADDRESS || '',
        gstin: process.env.SYNCRO1_GSTIN || '',
        pan: process.env.SYNCRO1_PAN || ''
      },

      candidate: candidate._id,
      job: candidate.job._id || candidate.job,
      staffingPartner: partner._id,
      company: candidate.company._id || candidate.company,

      candidateDetails: {
        name: `${candidate.firstName} ${candidate.lastName}`,
        position: candidate.job.title,
        joiningDate: candidate.joining?.actualJoiningDate,
        annualCTC: candidate.commission.baseAmount
      },

      lineItems: [
        {
          description: `Recruitment Services - Placement of ${candidate.firstName} ${candidate.lastName}`,
          quantity: 1,
          rate: candidate.commission.commissionAmount,
          amount: candidate.commission.commissionAmount,
          hsnSac: COMMISSION_CONFIG.HSN_SAC_CODE
        },
        {
          description: `Position: ${candidate.job.title}`,
          quantity: 1,
          rate: 0,
          amount: 0,
          hsnSac: ''
        },
        {
          description: `Annual CTC: ₹${candidate.commission.baseAmount.toLocaleString('en-IN')}`,
          quantity: 1,
          rate: 0,
          amount: 0,
          hsnSac: ''
        }
      ],

      amount: {
        subtotal: candidate.commission.commissionAmount,
        discountPercentage: 0,
        discountAmount: 0,
        taxableAmount: candidate.commission.commissionAmount,
        cgstPercentage: 9,
        cgstAmount: Math.round(candidate.commission.gstAmount / 2),
        sgstPercentage: 9,
        sgstAmount: Math.round(candidate.commission.gstAmount / 2),
        igstPercentage: 0,
        igstAmount: 0,
        tdsPercentage: COMMISSION_CONFIG.TDS_RATE,
        tdsAmount: candidate.commission.tdsAmount,
        totalGst: candidate.commission.gstAmount,
        grandTotal: candidate.commission.grossAmount,
        amountPayable: candidate.commission.netPayable
      },

      dueDate,
      serviceFromDate: candidate.joining?.actualJoiningDate,
      serviceToDate: candidate.joining?.actualJoiningDate,
      status: 'GENERATED',

      bankDetails: {
        accountHolderName: partner.commercialDetails?.bankAccountHolderName,
        bankName: partner.commercialDetails?.bankName,
        accountNumber: partner.commercialDetails?.accountNumber,
        ifscCode: partner.commercialDetails?.ifscCode
      },

      linkedPayout: payoutId,

      termsAndConditions: `
1. This invoice is raised for recruitment services as per the agreement with Syncro1.
2. Commission Rate: ${COMMISSION_CONFIG.PARTNER_RATE}% of Annual CTC
3. GST @ ${COMMISSION_CONFIG.GST_RATE}% is applicable on the commission amount.
4. TDS @ ${COMMISSION_CONFIG.TDS_RATE}% will be deducted at source.
5. Payment subject to 90-day replacement guarantee period.
6. Payment will be processed after candidate completes 90 days in the organization.
      `.trim(),

      notes: `Placement Fee for ${candidate.firstName} ${candidate.lastName} joining ${candidate.company.companyName}`
    });

    // Convert amount to words
    invoice.convertAmountToWords();
    await invoice.save();

    console.log(`[INVOICE] ✅ Generated partner invoice: ${invoice.invoiceNumber}`);
    return invoice;

  } catch (error) {
    console.error('[INVOICE] Generation error:', error.message);
    throw error;
  }
};

/**
 * Generate Syncro1 → Company invoice (Admin only)
 * This is for what Syncro1 charges the company (can be different %)
 */
exports.generateCompanyInvoice = async (req, res) => {
  try {
    const { candidateId, commissionRate, additionalCharges, notes } = req.body;

    const candidate = await Candidate.findById(candidateId)
      .populate('job', 'title')
      .populate('company', 'companyName billing kyc user')
      .populate('submittedBy', 'firstName lastName firmName');

    if (!candidate || candidate.status !== 'JOINED') {
      return res.status(400).json({
        success: false,
        message: 'Candidate must have JOINED status'
      });
    }

    // Check if company invoice already exists
    const existing = await Invoice.findOne({
      candidate: candidateId,
      invoiceType: 'SYNCRO1_TO_COMPANY'
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Company invoice already exists',
        data: { invoiceNumber: existing.invoiceNumber }
      });
    }

    // Calculate amounts (company rate can differ from partner rate)
    const annualCTC = candidate.offer.salary;
    const rate = commissionRate || 8.33; // Default 8.33% for company
    const baseAmount = Math.round(annualCTC * rate / 100);
    const additional = additionalCharges || 0;
    const subtotal = baseAmount + additional;
    const gstAmount = Math.round(subtotal * 18 / 100);
    const grandTotal = subtotal + gstAmount;

    // Due date based on company payment terms
    const termDays = {
      'Immediate': 0,
      'Net 15': 15,
      'Net 30': 30,
      'Net 45': 45,
      'Net 60': 60
    };
    const days = termDays[candidate.company.billing?.paymentTerms] || 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    const invoice = await Invoice.create({
      invoiceType: 'SYNCRO1_TO_COMPANY',

      from: {
        entityType: 'SYNCRO1',
        name: process.env.SYNCRO1_COMPANY_NAME || 'Syncro1 Technologies Pvt Ltd',
        address: process.env.SYNCRO1_ADDRESS || '',
        gstin: process.env.SYNCRO1_GSTIN || '',
        pan: process.env.SYNCRO1_PAN || ''
      },

      to: {
        entityType: 'COMPANY',
        entityId: candidate.company._id,
        name: candidate.company.billing?.billingEntityName || candidate.company.companyName,
        address: formatAddress(candidate.company.billing?.billingAddress || candidate.company.kyc?.registeredAddress),
        gstin: candidate.company.billing?.gstNumber || candidate.company.kyc?.gstNumber,
        pan: candidate.company.billing?.panNumber || candidate.company.kyc?.panNumber
      },

      candidate: candidate._id,
      job: candidate.job._id || candidate.job,
      staffingPartner: candidate.submittedBy._id,
      company: candidate.company._id,

      candidateDetails: {
        name: `${candidate.firstName} ${candidate.lastName}`,
        position: candidate.job.title,
        joiningDate: candidate.joining?.actualJoiningDate,
        annualCTC
      },

      lineItems: [
        {
          description: `Professional Recruitment Services - ${candidate.firstName} ${candidate.lastName}`,
          quantity: 1,
          rate: baseAmount,
          amount: baseAmount,
          hsnSac: COMMISSION_CONFIG.HSN_SAC_CODE
        },
        {
          description: `Position: ${candidate.job.title}`,
          quantity: 1,
          rate: 0,
          amount: 0,
          hsnSac: ''
        }
      ],

      amount: {
        subtotal,
        taxableAmount: subtotal,
        cgstPercentage: 9,
        cgstAmount: Math.round(gstAmount / 2),
        sgstPercentage: 9,
        sgstAmount: Math.round(gstAmount / 2),
        igstPercentage: 0,
        igstAmount: 0,
        totalGst: gstAmount,
        grandTotal,
        amountPayable: grandTotal
      },

      dueDate,
      serviceFromDate: candidate.joining?.actualJoiningDate,
      serviceToDate: candidate.joining?.actualJoiningDate,
      status: 'DRAFT',

      generatedBy: req.user._id,
      notes,

      termsAndConditions: `
1. Payment due within ${days} days of invoice date.
2. This invoice is for professional recruitment services.
3. GST @ 18% is applicable.
4. Please quote invoice number in all correspondence.
5. Bank details for payment are provided below.
      `.trim()
    });

    invoice.convertAmountToWords();
    await invoice.save();

    res.status(201).json({
      success: true,
      message: 'Company invoice generated',
      data: invoice
    });

  } catch (error) {
    console.error('[INVOICE] Company invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate company invoice',
      error: error.message
    });
  }
};

/**
 * Get invoices (role-based)
 */
exports.getInvoices = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === 'company') {
      const company = await Company.findOne({ user: req.user._id });
      if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }
      query = {
        company: company._id,
        invoiceType: 'SYNCRO1_TO_COMPANY'
      };
    } else if (req.user.role === 'staffing_partner') {
      const partner = await StaffingPartner.findOne({ user: req.user._id });
      if (!partner) {
        return res.status(404).json({ success: false, message: 'Partner not found' });
      }
      query = {
        staffingPartner: partner._id,
        invoiceType: 'PARTNER_TO_SYNCRO1'
      };
    }
    // Admin sees all

    const { status, invoiceType, page = 1, limit = 20 } = req.query;
    if (status) query.status = status;
    if (invoiceType && req.user.role === 'admin') query.invoiceType = invoiceType;

    const sanitizedPage = Math.max(1, Math.min(1000, parseInt(page)));
    const sanitizedLimit = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (sanitizedPage - 1) * sanitizedLimit;

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .populate('company', 'companyName')
        .populate('candidate', 'firstName lastName')
        .populate('job', 'title')
        .populate('staffingPartner', 'firstName lastName firmName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(sanitizedLimit),
      Invoice.countDocuments(query)
    ]);

    // Summary by status
    const summary = await Invoice.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount.grandTotal' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        invoices,
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: error.message
    });
  }
};

/**
 * Get single invoice
 */
exports.getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('company', 'companyName kyc billing user')
      .populate('candidate', 'firstName lastName email offer joining commission')
      .populate('job', 'title')
      .populate('staffingPartner', 'firstName lastName firmName commercialDetails firmDetails')
      .populate('linkedPayout')
      .populate('generatedBy', 'email');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    // Authorization check
    if (req.user.role === 'company') {
      const company = await Company.findOne({ user: req.user._id });
      if (!company || invoice.company._id.toString() !== company._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    } else if (req.user.role === 'staffing_partner') {
      const partner = await StaffingPartner.findOne({ user: req.user._id });
      if (!partner || invoice.staffingPartner._id.toString() !== partner._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
    }

    // Mark as viewed if first time
    if (!invoice.viewedAt && req.user.role !== 'admin') {
      invoice.viewedAt = new Date();
      await invoice.save();
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

/**
 * Send invoice (Admin only)
 */
exports.sendInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('company', 'companyName user')
      .populate('staffingPartner', 'firmName user')
      .populate('candidate', 'firstName lastName')
      .populate('job', 'title');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Invoice already paid'
      });
    }

    invoice.status = 'SENT';
    invoice.sentAt = new Date();
    invoice.sentBy = req.user._id;
    await invoice.save();

    // Send email notification
    const emailService = require('../services/emailService');
    const User = require('../models/User');

    let recipientEmail;
    let recipientName;

    if (invoice.invoiceType === 'SYNCRO1_TO_COMPANY') {
      const companyUser = await User.findById(invoice.company.user);
      recipientEmail = companyUser?.email;
      recipientName = invoice.company.companyName;
    } else {
      const partnerUser = await User.findById(invoice.staffingPartner.user);
      recipientEmail = partnerUser?.email;
      recipientName = invoice.staffingPartner.firmName;
    }

    if (recipientEmail) {
      await emailService.sendEmail({
        to: recipientEmail,
        subject: `Invoice ${invoice.invoiceNumber} - Syncro1`,
        html: `
          <div style="font-family: Arial; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0;">
              <h1 style="margin: 0;">Invoice ${invoice.invoiceNumber}</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb;">
              <p>Dear ${recipientName},</p>
              <p>Please find below the invoice details:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Invoice Number:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${invoice.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Candidate:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${invoice.candidate.firstName} ${invoice.candidate.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Position:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${invoice.job.title}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Amount:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; font-size: 18px; color: #667eea;">
                    <strong>₹${invoice.amount.grandTotal.toLocaleString('en-IN')}</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;"><strong>Due Date:</strong></td>
                  <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">${invoice.dueDate.toDateString()}</td>
                </tr>
              </table>
              
              <p style="text-align: center; margin-top: 30px;">
                <a href="${process.env.FRONTEND_URL}/invoices/${invoice._id}" 
                   style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                  View Full Invoice
                </a>
              </p>
            </div>
            <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 12px;">
              © ${new Date().getFullYear()} Syncro1. All rights reserved.
            </div>
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
    console.error('[INVOICE] Send error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send invoice',
      error: error.message
    });
  }
};

/**
 * Record payment for invoice
 */
exports.recordPayment = async (req, res) => {
  try {
    const { amount, transactionId, utrNumber, paymentMethod, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment amount is required'
      });
    }

    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Invoice already fully paid'
      });
    }

    // Record payment
    invoice.recordPayment({
      amount,
      transactionId,
      utrNumber,
      paymentMethod: paymentMethod || 'BANK_TRANSFER',
      notes
    }, req.user._id);

    await invoice.save();

    // If company invoice is paid, update company metrics
    if (invoice.invoiceType === 'SYNCRO1_TO_COMPANY' && invoice.status === 'PAID') {
      await Company.findByIdAndUpdate(invoice.company, {
        $inc: { 'metrics.totalSpent': invoice.amount.grandTotal }
      });
    }

    res.json({
      success: true,
      message: invoice.status === 'PAID' ? 'Invoice fully paid' : 'Partial payment recorded',
      data: {
        invoice,
        totalPaid: invoice.totalPaid,
        balanceDue: invoice.balanceDue
      }
    });
  } catch (error) {
    console.error('[INVOICE] Payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  }
};

/**
 * Cancel invoice (Admin only)
 */
exports.cancelInvoice = async (req, res) => {
  try {
    const { reason } = req.body;

    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Invoice not found'
      });
    }

    if (invoice.status === 'PAID') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel paid invoice'
      });
    }

    invoice.status = 'CANCELLED';
    invoice.internalNotes = `Cancelled: ${reason || 'No reason provided'}`;
    await invoice.save();

    res.json({
      success: true,
      message: 'Invoice cancelled',
      data: invoice
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cancel invoice',
      error: error.message
    });
  }
};

// Helper function
function formatAddress(addr) {
  if (!addr) return '';
  return [addr.street, addr.city, addr.state, addr.pincode, addr.country]
    .filter(Boolean)
    .join(', ');
}

module.exports = exports;