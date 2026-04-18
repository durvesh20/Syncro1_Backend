// backend/controllers/agreementController.js
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const agreementPdfService = require('../services/agreementPdfService');

/**
 * Build partner data for agreement template
 */
const buildPartnerData = (partner, user, signature, ip) => {
    return {
        firmName: partner.firmName,
        registeredName: partner.firmDetails?.registeredName || partner.firmName,
        entityType: partner.firmDetails?.entityType,
        registeredAddress: partner.firmDetails?.registeredOfficeAddress,
        firstName: partner.firstName,
        lastName: partner.lastName,
        designation: partner.designation,
        panNumber: partner.firmDetails?.panNumber,
        gstNumber: partner.firmDetails?.gstNumber,
        cinNumber: partner.firmDetails?.cinNumber,
        city: partner.city,
        state: partner.state,
        documents: partner.documents,
        agreementDate: new Date(),
        digitalSignature: signature || `${partner.firstName} ${partner.lastName}`,
        signedAt: new Date(),
        signedIp: ip || 'N/A',
        email: user?.email
    };
};

// @desc    Get agreement status
// @route   GET /api/agreements/status
// @access  Staffing Partner
exports.getAgreementStatus = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOne({ user: req.user._id });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found'
            });
        }

        res.json({
            success: true,
            data: {
                hasAgreed: !!partner.agreement?.agreed,
                agreedAt: partner.agreement?.agreedAt || null,
                pdfUrl: partner.agreement?.pdfUrl || null,
                digitalSignature: partner.agreement?.digitalSignature || null
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch agreement status',
            error: error.message
        });
    }
};

// @desc    Accept agreement — generates ONE PDF, saves, done
// @route   POST /api/agreements/accept
// @access  Staffing Partner
exports.acceptAgreement = async (req, res) => {
    try {
        const { digitalSignature, agreed } = req.body;

        if (!agreed) {
            return res.status(400).json({
                success: false,
                message: 'You must agree to the terms'
            });
        }

        if (!digitalSignature || digitalSignature.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Digital signature is required (type your full name)'
            });
        }

        const partner = await StaffingPartner.findOne({ user: req.user._id });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found'
            });
        }

        if (partner.agreement?.agreed) {
            return res.json({
                success: true,
                message: 'Agreement already accepted',
                data: {
                    agreed: true,
                    agreedAt: partner.agreement.agreedAt,
                    pdfUrl: partner.agreement.pdfUrl,
                    digitalSignature: partner.agreement.digitalSignature
                }
            });
        }

        const ipAddress =
            req.ip ||
            req.headers['x-forwarded-for'] ||
            req.connection.remoteAddress;
        const timestamp = new Date();

        const user = await User.findById(req.user._id);

        // Build data and generate ONE PDF
        const partnerData = buildPartnerData(
            partner,
            user,
            digitalSignature.trim(),
            ipAddress
        );

        const pdfResult = await agreementPdfService.generatePartnerAgreement(partnerData);

        // Save agreement — ONE record, ONE PDF
        partner.agreement = {
            agreed: true,
            agreedAt: timestamp,
            agreedIp: ipAddress,
            digitalSignature: digitalSignature.trim(),
            pdfUrl: pdfResult.url,
            pdfPublicId: pdfResult.publicId,
            generatedAt: pdfResult.generatedAt
        };

        await partner.save();

        res.json({
            success: true,
            message: 'Agreement accepted and PDF generated',
            data: {
                agreed: true,
                agreedAt: timestamp,
                pdfUrl: pdfResult.url,
                digitalSignature: digitalSignature.trim()
            }
        });
    } catch (error) {
        console.error('[AGREEMENT] Accept error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to accept agreement',
            error: error.message
        });
    }
};
// @desc    Admin regenerates agreement PDF for a partner (design update)
// @route   POST /api/agreements/regenerate/:partnerId
// @access  Admin only
exports.regenerateAgreementPdf = async (req, res) => {
    try {
        const StaffingPartner = require('../models/StaffingPartner');
        const User = require('../models/User');
        const agreementPdfService = require('../services/agreementPdfService');

        const partner = await StaffingPartner.findById(req.params.partnerId);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found'
            });
        }

        if (!partner.agreement?.agreed) {
            return res.status(400).json({
                success: false,
                message: 'Partner has not accepted the agreement yet'
            });
        }

        const user = await User.findById(partner.user);

        // Use original agreement details (not new ones)
        const partnerData = {
            firmName: partner.firmName,
            registeredName: partner.firmDetails?.registeredName || partner.firmName,
            entityType: partner.firmDetails?.entityType,
            registeredAddress: partner.firmDetails?.registeredOfficeAddress,
            firstName: partner.firstName,
            lastName: partner.lastName,
            designation: partner.designation,
            panNumber: partner.firmDetails?.panNumber,
            gstNumber: partner.firmDetails?.gstNumber,
            cinNumber: partner.firmDetails?.cinNumber,
            city: partner.city,
            state: partner.state,
            documents: partner.documents,
            // Keep original signing details
            agreementDate: partner.agreement.agreedAt,
            digitalSignature: partner.agreement.digitalSignature,
            signedAt: partner.agreement.agreedAt,
            signedIp: partner.agreement.agreedIp,
            email: user?.email
        };

        console.log(`[AGREEMENT] Regenerating PDF for: ${partner.firmName}`);
        const pdfResult = await agreementPdfService.generatePartnerAgreement(partnerData);

        // Update only the PDF URL — keep all agreement acceptance details unchanged
        partner.agreement.pdfUrl = pdfResult.url;
        partner.agreement.pdfPublicId = pdfResult.publicId;
        partner.agreement.regeneratedAt = new Date();
        await partner.save();

        console.log(`[AGREEMENT] ✅ PDF regenerated: ${pdfResult.url}`);

        res.json({
            success: true,
            message: 'Agreement PDF regenerated successfully',
            data: {
                pdfUrl: pdfResult.url,
                regeneratedAt: partner.agreement.regeneratedAt,
                originalAgreedAt: partner.agreement.agreedAt,
                digitalSignature: partner.agreement.digitalSignature
            }
        });
    } catch (error) {
        console.error('[AGREEMENT] Regenerate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to regenerate agreement PDF',
            error: error.message
        });
    }
};
