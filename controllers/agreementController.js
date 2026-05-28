// backend/controllers/agreementController.js
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const AgreementQuery = require('../models/AgreementQuery');
const agreementPdfService = require('../services/agreementPdfService');

const buildPartnerData = (partner, user, ip, timestamp) => {
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
        agreementDate: timestamp || new Date(),
        agreedAt: timestamp || new Date(),
        agreedIp: ip || 'N/A',
        email: user?.email
    };
};

// ================================================================
// PARTNER ROUTES
// ================================================================

// @desc    Get agreement status + queries
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

        // Get queries
        const queries = await AgreementQuery.find({ partner: partner._id })
            .populate('respondedBy', 'email role')
            .sort({ createdAt: -1 });

        const pendingQueries = queries.filter(q => q.status === 'PENDING').length;
        const respondedQueries = queries.filter(q => q.status === 'RESPONDED').length;

        res.json({
            success: true,
            data: {
                hasAgreed: !!partner.agreement?.agreed,
                agreedAt: partner.agreement?.agreedAt || null,
                pdfUrl: partner.agreement?.pdfUrl || null,

                // Review and discuss fields
                isReviewAndDiscuss: queries.length > 0,
                hasOpenQueries: pendingQueries > 0,
                hasPendingQueries: pendingQueries > 0,
                hasRespondedQueries: respondedQueries > 0,
                querySummary: {
                    total: queries.length,
                    pending: pendingQueries,
                    responded: respondedQueries,
                    closed: queries.filter(q => q.status === 'CLOSED').length
                },
                queries: queries
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

// @desc    Partner submits a query about a clause
// @route   POST /api/agreements/query
// @access  Staffing Partner
exports.submitQuery = async (req, res) => {
    try {
        const { clauseReference, query } = req.body;

        if (!clauseReference || !clauseReference.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Clause reference is required (e.g. Clause 9.1, Article 5)'
            });
        }

        if (!query || query.trim().length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Query must be at least 10 characters'
            });
        }

        const partner = await StaffingPartner.findOne({ user: req.user._id });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found'
            });
        }

        // Cannot submit query after agreement is accepted
        if (partner.agreement?.agreed) {
            return res.status(400).json({
                success: false,
                message: 'Agreement already accepted. Cannot submit queries after acceptance.'
            });
        }

        const agreementQuery = await AgreementQuery.create({
            partner: partner._id,
            user: req.user._id,
            clauseReference: clauseReference.trim(),
            query: query.trim(),
            status: 'PENDING'
        });

        // Notify admin — fire and forget
        const notifyAdmin = async () => {
            try {
                const notificationEngine = require('../services/notificationEngine');
                const adminUsers = await User.find({ role: 'admin' });
                for (const admin of adminUsers) {
                    await notificationEngine.send({
                        recipientId: admin._id,
                        type: 'SYSTEM_ANNOUNCEMENT',
                        title: `Agreement query from ${partner.firmName}`,
                        message: `${partner.firstName} ${partner.lastName} (${partner.firmName}) has raised a query on ${clauseReference}: "${query.trim().substring(0, 100)}..."`,
                        data: {
                            entityType: 'AgreementQuery',
                            entityId: agreementQuery._id,
                            actionUrl: `/admin/agreement-queries/${agreementQuery._id}`
                        },
                        channels: { inApp: true, email: false },
                        priority: 'medium'
                    });
                }
            } catch (err) {
                console.error('[AGREEMENT QUERY] Admin notification failed:', err.message);
            }
        };

        notifyAdmin();

        res.status(201).json({
            success: true,
            message: 'Query submitted successfully. Admin will respond within 24 hours.',
            data: agreementQuery
        });
    } catch (error) {
        console.error('[AGREEMENT QUERY] Submit error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit query',
            error: error.message
        });
    }
};

// @desc    Partner gets their own queries
// @route   GET /api/agreements/queries
// @access  Staffing Partner
exports.getMyQueries = async (req, res) => {
    try {
        const partner = await StaffingPartner.findOne({ user: req.user._id });

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found'
            });
        }

        const queries = await AgreementQuery.find({ partner: partner._id })
            .populate('respondedBy', 'email role')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: {
                queries,
                total: queries.length,
                pending: queries.filter(q => q.status === 'PENDING').length,
                responded: queries.filter(q => q.status === 'RESPONDED').length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch queries',
            error: error.message
        });
    }
};

// @desc    Accept agreement — generates PDF
// @route   POST /api/agreements/accept
// @access  Staffing Partner
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
        const partnerData = buildPartnerData(partner, user, ipAddress, timestamp);
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

        // Close all open queries on acceptance
        await AgreementQuery.updateMany(
            { partner: partner._id, status: { $in: ['PENDING', 'RESPONDED'] } },
            { status: 'CLOSED' }
        );

        console.log(`[AGREEMENT] ✅ Accepted by: ${partner.firstName} ${partner.lastName}`);

        res.json({
            success: true,
            message: 'Agreement accepted and PDF generated successfully',
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

// ================================================================
// ADMIN ROUTES
// ================================================================

// @desc    Admin gets all agreement queries (with full context)
// @route   GET /api/agreements/admin/queries
exports.getAllQueries = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        const query = {};
        if (status) query.status = status;

        const sanitizedPage = Math.max(1, parseInt(page));
        const sanitizedLimit = Math.min(50, Math.max(1, parseInt(limit)));
        const skip = (sanitizedPage - 1) * sanitizedLimit;

        const [queries, total] = await Promise.all([
            AgreementQuery.find(query)
                .populate({
                    path: 'partner',
                    select:
                        'firstName lastName firmName city state verificationStatus ' +
                        'agreement profileCompletion uniqueId'
                })
                .populate('user', 'email mobile')
                .populate('respondedBy', 'email role')
                .sort({ createdAt: 1 })
                .skip(skip)
                .limit(sanitizedLimit),
            AgreementQuery.countDocuments(query)
        ]);

        // ✅ Enrich each query with status flags and response details
        const enriched = queries.map(q => ({
            ...q.toObject(),
            _meta: {
                isPending: q.status === 'PENDING',
                isResponded: q.status === 'RESPONDED',
                isClosed: q.status === 'CLOSED',
                hasResponse: !!q.response,
                response: q.response || null,
                respondedBy: q.respondedBy || null,
                respondedAt: q.respondedAt || null,
                partnerHasAgreed: !!q.partner?.agreement?.agreed,
                ageHours: Math.floor(
                    (Date.now() - new Date(q.createdAt)) / (1000 * 60 * 60)
                )
            }
        }));

        // ✅ Summary counts
        const summary = await AgreementQuery.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            data: {
                queries: enriched,
                summary: summary.reduce((acc, item) => {
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
            message: 'Failed to fetch queries',
            error: error.message
        });
    }
};


// @desc    Admin responds to (approve/reject/close) a query
// @route   PUT /api/agreements/admin/queries/:id/respond
exports.respondToQuery = async (req, res) => {
    try {
        const { response, action } = req.body;

        // ✅ action can be: 'respond' | 'close' | 'reopen'
        const validActions = ['respond', 'close', 'reopen'];
        const resolvedAction = action || 'respond';

        if (!validActions.includes(resolvedAction)) {
            return res.status(400).json({
                success: false,
                message: `Invalid action. Use: ${validActions.join(', ')}`
            });
        }

        // Response text is required for 'respond' action
        if (resolvedAction === 'respond' && (!response || response.trim().length < 5)) {
            return res.status(400).json({
                success: false,
                message: 'Response is required (minimum 5 characters)'
            });
        }

        const agreementQuery = await AgreementQuery.findById(req.params.id)
            .populate('partner', 'firstName lastName firmName')
            .populate('user', 'email');

        if (!agreementQuery) {
            return res.status(404).json({
                success: false,
                message: 'Query not found'
            });
        }

        // ✅ Handle different actions
        if (resolvedAction === 'close') {
            if (agreementQuery.status === 'PENDING' && !agreementQuery.response) {
                return res.status(400).json({
                    success: false,
                    message: 'Please respond to the query before closing it'
                });
            }
            agreementQuery.status = 'CLOSED';

        } else if (resolvedAction === 'reopen') {
            if (agreementQuery.status !== 'CLOSED') {
                return res.status(400).json({
                    success: false,
                    message: 'Only CLOSED queries can be reopened'
                });
            }
            agreementQuery.status = 'RESPONDED';

        } else {
            // respond
            if (agreementQuery.status === 'CLOSED') {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot respond to a closed query. Reopen it first.'
                });
            }

            agreementQuery.response = response.trim();
            agreementQuery.respondedBy = req.user._id;
            agreementQuery.respondedAt = new Date();
            agreementQuery.status = 'RESPONDED';
        }

        await agreementQuery.save();

        // Notify partner (fire and forget)
        const notifyPartner = async () => {
            try {
                const notificationEngine = require('../services/notificationEngine');

                const messageMap = {
                    respond: `Your query on "${agreementQuery.clauseReference}" has been responded to. Please review and accept the agreement when ready.`,
                    close: `Your query on "${agreementQuery.clauseReference}" has been closed by admin.`,
                    reopen: `Your query on "${agreementQuery.clauseReference}" has been reopened.`
                };

                await notificationEngine.send({
                    recipientId: agreementQuery.user._id || agreementQuery.user,
                    type: 'AGREEMENT_QUERY_RESPONDED',
                    title:
                        resolvedAction === 'respond'
                            ? 'Your agreement query has been answered'
                            : resolvedAction === 'close'
                                ? 'Agreement query closed'
                                : 'Agreement query reopened',
                    message: messageMap[resolvedAction],
                    data: {
                        entityType: 'AgreementQuery',
                        entityId: agreementQuery._id,
                        actionUrl: '/partner/agreement'
                    },
                    channels: { inApp: true, email: resolvedAction === 'respond' },
                    priority: 'high'
                });

            } catch (err) {
                console.error('[AGREEMENT QUERY] Partner notification failed:', err.message);
            }
        };

        notifyPartner();

        res.json({
            success: true,
            message:
                resolvedAction === 'respond'
                    ? 'Response submitted. Partner has been notified.'
                    : resolvedAction === 'close'
                        ? 'Query closed successfully.'
                        : 'Query reopened successfully.',
            data: {
                queryId: agreementQuery._id,
                status: agreementQuery.status,
                response: agreementQuery.response || null,
                respondedAt: agreementQuery.respondedAt || null,
                respondedBy: agreementQuery.respondedBy || null,
                clauseReference: agreementQuery.clauseReference,
                partnerName: `${agreementQuery.partner.firstName} ${agreementQuery.partner.lastName}`,
                firmName: agreementQuery.partner.firmName
            }
        });

    } catch (error) {
        console.error('[AGREEMENT QUERY] Respond error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process query action',
            error: error.message
        });
    }
};

// @desc    Admin gets single query
// @route   GET /api/agreements/admin/queries/:id
// @access  Admin / Sub-Admin
exports.getQuery = async (req, res) => {
    try {
        const query = await AgreementQuery.findById(req.params.id)
            .populate({
                path: 'partner',
                select: 'firstName lastName firmName city state verificationStatus profileCompletion agreement'
            })
            .populate('user', 'email mobile')
            .populate('respondedBy', 'email role');

        if (!query) {
            return res.status(404).json({
                success: false,
                message: 'Query not found'
            });
        }

        // Get all queries from same partner for context
        const partnerQueries = await AgreementQuery.find({
            partner: query.partner._id
        }).sort({ createdAt: -1 });

        res.json({
            success: true,
            data: {
                query,
                partnerAllQueries: partnerQueries
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch query',
            error: error.message
        });
    }
};

// @desc    Admin responds to a query
// @route   PUT /api/agreements/admin/queries/:id/respond
// @access  Admin / Sub-Admin
exports.respondToQuery = async (req, res) => {
    try {
        const { response } = req.body;

        if (!response || response.trim().length < 5) {
            return res.status(400).json({
                success: false,
                message: 'Response is required (minimum 5 characters)'
            });
        }

        const agreementQuery = await AgreementQuery.findById(req.params.id)
            .populate('partner', 'firstName lastName firmName')
            .populate('user', 'email');

        if (!agreementQuery) {
            return res.status(404).json({
                success: false,
                message: 'Query not found'
            });
        }

        if (agreementQuery.status === 'CLOSED') {
            return res.status(400).json({
                success: false,
                message: 'Cannot respond to a closed query'
            });
        }

        agreementQuery.response = response.trim();
        agreementQuery.respondedBy = req.user._id;
        agreementQuery.respondedAt = new Date();
        agreementQuery.status = 'RESPONDED';

        await agreementQuery.save();

        // Notify partner — fire and forget
        const notifyPartner = async () => {
            try {
                const notificationEngine = require('../services/notificationEngine');

                await notificationEngine.send({
                    recipientId: agreementQuery.user._id || agreementQuery.user,
                    type: 'SYSTEM_ANNOUNCEMENT',
                    title: 'Your agreement query has been answered',
                    message: `Your query on "${agreementQuery.clauseReference}" has been responded to. Please review the response and accept the agreement when ready.`,
                    data: {
                        entityType: 'AgreementQuery',
                        entityId: agreementQuery._id,
                        actionUrl: '/partner/agreement'
                    },
                    channels: { inApp: true, email: true },
                    priority: 'high'
                });
            } catch (err) {
                console.error('[AGREEMENT QUERY] Partner notification failed:', err.message);
            }
        };

        notifyPartner();

        res.json({
            success: true,
            message: 'Response submitted successfully. Partner has been notified.',
            data: agreementQuery
        });
    } catch (error) {
        console.error('[AGREEMENT QUERY] Respond error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to respond to query',
            error: error.message
        });
    }
};

// @desc    Admin regenerates PDF with updated design
// @route   POST /api/agreements/regenerate/:partnerId
// @access  Admin
exports.regenerateAgreementPdf = async (req, res) => {
    try {
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
        const partnerData = buildPartnerData(
            partner,
            user,
            partner.agreement.agreedIp,
            partner.agreement.agreedAt
        );

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