// backend/controllers/agreementController.js
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const agreementPdfService = require('../services/agreementPdfService');

const buildPartnerData = (partner, user, ip) => {
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
        agreedAt: new Date(),
        agreedIp: ip || 'N/A',
        email: user?.email
    };
};

// @desc    Get agreement status
// @route   GET /api/agreements/status
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
                pdfUrl: partner.agreement?.pdfUrl || null
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

// @desc    Accept agreement — generates PDF, no signature required
// @route   POST /api/agreements/accept
exports.acceptAgreement = async (req, res) => {
    try {
        const { agreed } = req.body;

        if (!agreed) {
            return res.status(400).json({
                success: false,
                message: 'You must agree to the terms'
            });
        }

        const partner = await StaffingPartner.findOne({ user: req.user._id });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found'
            });
        }

        // Already accepted
        if (partner.agreement?.agreed && partner.agreement?.pdfUrl) {
            return res.json({
                success: true,
                message: 'Agreement already accepted',
                data: {
                    agreed: true,
                    agreedAt: partner.agreement.agreedAt,
                    pdfUrl: partner.agreement.pdfUrl
                }
            });
        }

        // Check profile completion
        const required = [
            'basicInfo', 'firmDetails', 'Syncro1Competency',
            'geographicReach', 'compliance', 'commercialDetails', 'documents'
        ];
        const incomplete = required.filter(s => !partner.profileCompletion[s]);

        if (incomplete.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Complete all profile sections before accepting the agreement',
                incompleteSections: incomplete
            });
        }

        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const timestamp = new Date();
        const user = await User.findById(req.user._id);

        // Generate PDF
        const partnerData = buildPartnerData(partner, user, ipAddress);
        partnerData.agreementDate = timestamp;
        partnerData.agreedAt = timestamp;

        const pdfResult = await agreementPdfService.generatePartnerAgreement(partnerData);

        // Save agreement
        partner.agreement = {
            agreed: true,
            agreedAt: timestamp,
            agreedIp: ipAddress,
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
                pdfUrl: pdfResult.url
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

// @desc    Admin regenerates PDF with updated design
// @route   POST /api/agreements/regenerate/:partnerId
exports.regenerateAgreementPdf = async (req, res) => {
    try {
        const partner = await StaffingPartner.findById(req.params.partnerId);

        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found' });
        }

        if (!partner.agreement?.agreed) {
            return res.status(400).json({
                success: false,
                message: 'Partner has not accepted the agreement yet'
            });
        }

        const user = await User.findById(partner.user);
        const ipAddress = partner.agreement.agreedIp;
        const timestamp = partner.agreement.agreedAt;

        const partnerData = buildPartnerData(partner, user, ipAddress);
        partnerData.agreementDate = timestamp;
        partnerData.agreedAt = timestamp;

        const pdfResult = await agreementPdfService.generatePartnerAgreement(partnerData);

        partner.agreement.pdfUrl = pdfResult.url;
        partner.agreement.pdfPublicId = pdfResult.publicId;
        partner.agreement.regeneratedAt = new Date();
        await partner.save();

        res.json({
            success: true,
            message: 'Agreement PDF regenerated',
            data: {
                pdfUrl: pdfResult.url,
                regeneratedAt: partner.agreement.regeneratedAt
            }
        });
    } catch (error) {
        console.error('[AGREEMENT] Regenerate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to regenerate',
            error: error.message
        });
    }
};