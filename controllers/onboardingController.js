// controllers/onboardingController.js
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const { validateEmail, validateMobile, validateGST, validatePAN } = require('../utils/validators');

// Helper function to get completed fields
const getCompletedFields = (partner, fields) => {
    return fields.filter(field => {
        const value = field.split('.').reduce((obj, key) => obj?.[key], partner);
        return value !== undefined && value !== null && value !== '';
    });
};

// @desc Get Onboarding Status
// @route GET /api/onboarding/status
exports.getOnboardingStatus = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOne({ user: req.user._id });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found'
            });
        }

        const steps = [
            {
                step: 1,
                name: 'Basic Information',
                completed: partner.profileCompletion.basicInfo,
                fields: ['firstName', 'lastName', 'firmName', 'designation', 'city', 'state'],
                completedFields: getCompletedFields(partner, ['firstName', 'lastName', 'firmName', 'designation', 'city', 'state']),
                required: true,
                canSkip: false
            },
            {
                step: 2,
                name: 'Firm Details',
                completed: partner.profileCompletion.firmDetails,
                fields: ['firmDetails.gstNumber', 'firmDetails.panNumber', 'firmDetails.yearEstablished', 'firmDetails.teamSize'],
                completedFields: getCompletedFields(partner, ['firmDetails.gstNumber', 'firmDetails.panNumber', 'firmDetails.yearEstablished', 'firmDetails.teamSize']),
                required: true,
                canSkip: false
            },
            {
                step: 3,
                name: 'Syncro1 Competency',
                completed: partner.profileCompletion.Syncro1Competency,
                fields: ['Syncro1Competency.industries', 'Syncro1Competency.functionalDomains', 'Syncro1Competency.hiringTypes'],
                completedFields: getCompletedFields(partner, ['Syncro1Competency.industries', 'Syncro1Competency.functionalDomains', 'Syncro1Competency.hiringTypes']),
                required: true,
                canSkip: false
            },
            {
                step: 4,
                name: 'Geographic Reach',
                completed: partner.profileCompletion.geographicReach,
                fields: ['geographicReach.primaryRegions', 'geographicReach.cities'],
                completedFields: getCompletedFields(partner, ['geographicReach.primaryRegions', 'geographicReach.cities']),
                required: true,
                canSkip: false
            },
            {
                step: 5,
                name: 'Compliance',
                completed: partner.profileCompletion.compliance,
                fields: ['compliance.dataProtectionAgreed', 'compliance.termsAccepted'],
                completedFields: getCompletedFields(partner, ['compliance.dataProtectionAgreed', 'compliance.termsAccepted']),
                required: true,
                canSkip: false
            },
            {
                step: 6,
                name: 'Commercial Details',
                completed: partner.profileCompletion.commercialDetails,
                fields: ['commercialDetails.bankAccountNumber', 'commercialDetails.ifscCode', 'commercialDetails.bankName'],
                completedFields: getCompletedFields(partner, ['commercialDetails.bankAccountNumber', 'commercialDetails.ifscCode', 'commercialDetails.bankName']),
                required: true,
                canSkip: false
            },
            {
                step: 7,
                name: 'Documents',
                completed: partner.profileCompletion.documents,
                fields: ['documents.panCard', 'documents.gstCertificate'],
                completedFields: getCompletedFields(partner, ['documents.panCard', 'documents.gstCertificate']),
                required: true,
                canSkip: false
            }
        ];

        const currentStep = steps.findIndex(s => !s.completed) + 1;

        res.json({
            success: true,
            data: {
                currentStep: currentStep || steps.length + 1,
                totalSteps: steps.length,
                steps,
                canSubmit: steps.every(s => s.completed),
                nextAction: steps[currentStep - 1]?.name || 'Submit for Verification'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get onboarding status',
            error: error.message
        });
    }
};

// @desc Save Step Data
// @route PUT /api/onboarding/step/:stepNumber
exports.saveStep = async (req, res) => {
    try {
        const stepNumber = parseInt(req.params.stepNumber);

        switch (stepNumber) {
            case 1:
                return exports.updateBasicInfo(req, res);
            case 2:
                return exports.updateFirmDetails(req, res);
            case 3:
                return exports.updateSyncro1Competency(req, res);
            case 4:
                return exports.updateGeographicReach(req, res);
            case 5:
                return exports.updateCompliance(req, res);
            case 6:
                return exports.updateCommercialDetails(req, res);
            case 7:
                return exports.updateDocuments(req, res);
            default:
                return res.status(400).json({
                    success: false,
                    message: 'Invalid step number'
                });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save step',
            error: error.message
        });
    }
};

// Step 1: Update Basic Info
exports.updateBasicInfo = async (req, res) => {
    try {
        const { firstName, lastName, firmName, designation, linkedinProfile, city, state } = req.body;

        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                firstName,
                lastName,
                firmName,
                designation,
                linkedinProfile,
                city,
                state,
                'profileCompletion.basicInfo': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Basic information saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save basic info',
            error: error.message
        });
    }
};

// Step 2: Update Firm Details
exports.updateFirmDetails = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                firmDetails: req.body,
                'profileCompletion.firmDetails': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Firm details saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save firm details',
            error: error.message
        });
    }
};

// Step 3: Update Syncro1 Competency
exports.updateSyncro1Competency = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                Syncro1Competency: req.body,
                'profileCompletion.Syncro1Competency': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Syncro1 competency saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save Syncro1 competency',
            error: error.message
        });
    }
};

// Step 4: Update Geographic Reach
exports.updateGeographicReach = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                geographicReach: req.body,
                'profileCompletion.geographicReach': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Geographic reach saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save geographic reach',
            error: error.message
        });
    }
};

// Step 5: Update Compliance
exports.updateCompliance = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                compliance: req.body,
                'profileCompletion.compliance': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Compliance details saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save compliance',
            error: error.message
        });
    }
};

// Step 6: Update Commercial Details
exports.updateCommercialDetails = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                commercialDetails: req.body,
                'profileCompletion.commercialDetails': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Commercial details saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save commercial details',
            error: error.message
        });
    }
};

// Step 7: Update Documents
exports.updateDocuments = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOneAndUpdate(
            { user: req.user._id },
            {
                documents: req.body,
                'profileCompletion.documents': true
            },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Documents saved',
            data: partner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to save documents',
            error: error.message
        });
    }
};

// @desc Validate Field (Real-time validation)
// @route POST /api/onboarding/validate-field
exports.validateField = async (req, res) => {
    try {
        const { field, value } = req.body;

        const validators = {
            email: async (val) => {
                if (!validateEmail(val)) {
                    return { valid: false, message: 'Invalid email format' };
                }
                const exists = await User.findOne({ email: val });
                if (exists) {
                    return { valid: false, message: 'Email already registered' };
                }
                return { valid: true };
            },

            firmName: async (val) => {
                const exists = await StaffingPartner.findOne({
                    firmName: new RegExp(`^${val.trim()}$`, 'i')
                });
                if (exists) {
                    return { valid: false, message: 'Firm name already registered' };
                }
                return { valid: true };
            },

            gstNumber: async (val) => {
                if (!validateGST(val)) {
                    return { valid: false, message: 'Invalid GST format' };
                }
                const exists = await StaffingPartner.findOne({
                    'firmDetails.gstNumber': val
                });
                if (exists) {
                    return { valid: false, message: 'GST number already registered' };
                }
                return { valid: true };
            },

            panNumber: async (val) => {
                if (!validatePAN(val)) {
                    return { valid: false, message: 'Invalid PAN format' };
                }
                const exists = await StaffingPartner.findOne({
                    'firmDetails.panNumber': val
                });
                if (exists) {
                    return { valid: false, message: 'PAN number already registered' };
                }
                return { valid: true };
            },

            mobile: async (val) => {
                if (!validateMobile(val)) {
                    return { valid: false, message: 'Invalid mobile number. Please provide 10-digit number' };
                }
                const exists = await User.findOne({ mobile: val });
                if (exists) {
                    return { valid: false, message: 'Mobile number already registered' };
                }
                return { valid: true };
            }
        };

        const validator = validators[field];
        if (!validator) {
            return res.status(400).json({
                success: false,
                message: 'Unknown field'
            });
        }

        const result = await validator(value);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Validation failed',
            error: error.message
        });
    }
};