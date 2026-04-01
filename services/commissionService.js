// backend/services/commissionService.js - NEW FILE

const Candidate = require('../models/Candidate');
const Payout = require('../models/Payout');
const Invoice = require('../models/Invoice');
const StaffingPartner = require('../models/StaffingPartner');
const Company = require('../models/Company');

// Fixed commission configuration
const COMMISSION_CONFIG = {
    PARTNER_RATE: 5,      // 5% of annual CTC
    GST_RATE: 18,         // 18% GST
    TDS_RATE: 10,         // 10% TDS at source
    GUARANTEE_DAYS: 90,   // 90-day replacement guarantee
    HSN_SAC_CODE: '998519' // SAC code for recruitment services
};

class CommissionService {

    /**
     * Process commission when candidate joins
     * Called by candidateLifecycleService when status → JOINED
     */
    async processJoining(candidateId, processedByUserId = null) {
        console.log(`[COMMISSION] ── Processing joining for candidate: ${candidateId} ──`);

        const candidate = await Candidate.findById(candidateId)
            .populate('job', 'title')
            .populate('company', 'companyName billing kyc user')
            .populate('submittedBy', 'firstName lastName firmName user commercialDetails');

        if (!candidate) {
            throw new Error('Candidate not found');
        }

        if (candidate.status !== 'JOINED') {
            throw new Error('Candidate must have JOINED status');
        }

        if (!candidate.offer || !candidate.offer.salary) {
            console.warn(`[COMMISSION] ⚠️ No salary in offer for candidate ${candidateId}`);
            return { success: false, reason: 'NO_SALARY' };
        }

        // Step 1: Calculate commission
        candidate.calculateCommission(processedByUserId);
        console.log(`[COMMISSION] ✅ Calculated: ₹${candidate.commission.netPayable.toLocaleString('en-IN')} net payout`);

        // Step 2: Setup replacement guarantee
        candidate.setupReplacementGuarantee();
        console.log(`[COMMISSION] ✅ 90-day guarantee active until: ${candidate.payout.eligibleDate.toDateString()}`);

        await candidate.save();

        // Step 3: Create payout record
        const payout = await this._createPayout(candidate, processedByUserId);
        console.log(`[COMMISSION] ✅ Payout created: ${payout._id}`);

        // Step 4: Generate partner invoice (Partner → Syncro1)
        const partnerInvoice = await this._generatePartnerInvoice(candidate, payout);
        console.log(`[COMMISSION] ✅ Partner invoice: ${partnerInvoice.invoiceNumber}`);

        // Step 5: Update partner metrics
        await this._updatePartnerMetrics(candidate.submittedBy._id, candidate.commission.netPayable, 'add_pending');

        // Step 6: Notify partner
        await this._notifyPartner(candidate, payout);

        console.log(`[COMMISSION] ── Processing complete ──`);

        return {
            success: true,
            commission: candidate.commission,
            payout: payout._id,
            partnerInvoice: partnerInvoice.invoiceNumber,
            eligibleDate: candidate.payout.eligibleDate
        };
    }

    /**
     * Create payout record
     */
    async _createPayout(candidate, userId) {
        const joiningDate = candidate.joining?.actualJoiningDate || new Date();
        const guaranteeEndDate = new Date(joiningDate);
        guaranteeEndDate.setDate(guaranteeEndDate.getDate() + COMMISSION_CONFIG.GUARANTEE_DAYS);

        const payout = await Payout.create({
            staffingPartner: candidate.submittedBy._id,
            candidate: candidate._id,
            job: candidate.job._id || candidate.job,
            company: candidate.company._id || candidate.company,
            amount: {
                annualCTC: candidate.commission.baseAmount,
                commissionRate: COMMISSION_CONFIG.PARTNER_RATE,
                baseCommission: candidate.commission.commissionAmount,
                gstPercentage: COMMISSION_CONFIG.GST_RATE,
                gstAmount: candidate.commission.gstAmount,
                grossAmount: candidate.commission.grossAmount,
                tdsPercentage: COMMISSION_CONFIG.TDS_RATE,
                tdsAmount: candidate.commission.tdsAmount,
                netPayable: candidate.commission.netPayable
            },
            status: 'PENDING',
            replacementGuarantee: {
                startDate: joiningDate,
                endDate: guaranteeEndDate,
                daysTotal: COMMISSION_CONFIG.GUARANTEE_DAYS,
                isActive: true,
                candidateStatus: 'ACTIVE'
            },
            history: [{
                action: 'CREATED',
                performedBy: userId,
                notes: `Payout created for ${candidate.firstName} ${candidate.lastName} joining at ₹${candidate.commission.baseAmount.toLocaleString('en-IN')}/year`
            }]
        });

        // Link payout to candidate
        candidate.payout.status = 'PENDING';
        await candidate.save();

        return payout;
    }

    /**
     * Generate Partner → Syncro1 invoice
     */
    async _generatePartnerInvoice(candidate, payout) {
        const partner = candidate.submittedBy;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 30); // Net 30 from Syncro1

        const invoice = await Invoice.create({
            invoiceType: 'PARTNER_TO_SYNCRO1',
            from: {
                entityType: 'PARTNER',
                entityId: partner._id,
                name: partner.commercialDetails?.payoutEntityName || partner.firmName,
                address: this._formatAddress(partner.firmDetails?.registeredOfficeAddress),
                gstin: partner.firmDetails?.gstNumber || partner.commercialDetails?.gstRegistration,
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
            lineItems: [{
                description: `Recruitment Commission - ${candidate.firstName} ${candidate.lastName} for ${candidate.job.title}`,
                quantity: 1,
                rate: candidate.commission.commissionAmount,
                amount: candidate.commission.commissionAmount,
                hsnSac: COMMISSION_CONFIG.HSN_SAC_CODE
            }],
            amount: {
                subtotal: candidate.commission.commissionAmount,
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
            linkedPayout: payout._id,
            termsAndConditions: `
1. Payment subject to 90-day replacement guarantee period.
2. TDS at ${COMMISSION_CONFIG.TDS_RATE}% deducted at source.
3. Invoice raised as per terms of engagement with Syncro1.
      `.trim()
        });

        // Convert amount to words
        invoice.convertAmountToWords();
        await invoice.save();

        // Link invoice to payout and candidate
        payout.partnerInvoice = invoice._id;
        await payout.save();

        candidate.partnerInvoice = invoice._id;
        await candidate.save();

        return invoice;
    }

    /**
     * Update partner metrics
     */
    async _updatePartnerMetrics(partnerId, amount, action) {
        const update = {};

        switch (action) {
            case 'add_pending':
                update.$inc = {
                    'metrics.pendingPayouts': amount,
                    'metrics.totalEarnings': amount
                };
                break;
            case 'move_to_eligible':
                update.$inc = {
                    'metrics.pendingPayouts': -amount,
                    'metrics.eligiblePayouts': amount
                };
                break;
            case 'mark_paid':
                update.$inc = {
                    'metrics.eligiblePayouts': -amount,
                    'metrics.paidOut': amount
                };
                break;
            case 'forfeit':
                update.$inc = {
                    'metrics.pendingPayouts': -amount,
                    'metrics.totalEarnings': -amount,
                    'metrics.forfeitedAmount': amount
                };
                break;
        }

        await StaffingPartner.findByIdAndUpdate(partnerId, update);
    }

    /**
     * Notify partner about commission
     */
    async _notifyPartner(candidate, payout) {
        try {
            const notificationEngine = require('./notificationEngine');
            const partner = candidate.submittedBy;

            if (!partner.user) return;

            await notificationEngine.send({
                recipientId: partner.user._id || partner.user,
                type: 'CANDIDATE_JOINED',
                title: '🚀💰 Candidate Joined - Commission Earned!',
                message: `Great news! ${candidate.firstName} ${candidate.lastName} has joined ${candidate.company.companyName}.\n\n` +
                    `Commission earned: ₹${candidate.commission.netPayable.toLocaleString('en-IN')} (net)\n` +
                    `Payout eligible after: ${payout.replacementGuarantee.endDate.toDateString()} (90 days)`,
                data: {
                    entityType: 'Payout',
                    entityId: payout._id,
                    actionUrl: '/partner/earnings',
                    metadata: {
                        candidateName: `${candidate.firstName} ${candidate.lastName}`,
                        companyName: candidate.company.companyName,
                        annualCTC: candidate.commission.baseAmount,
                        commissionAmount: candidate.commission.commissionAmount,
                        netPayout: candidate.commission.netPayable,
                        eligibleDate: payout.replacementGuarantee.endDate.toISOString()
                    }
                },
                channels: { inApp: true, email: true, whatsapp: true },
                priority: 'urgent'
            });
        } catch (error) {
            console.error('[COMMISSION] Notification failed:', error.message);
        }
    }

    /**
     * Check and update eligible payouts (run daily via cron)
     */
    async checkEligiblePayouts() {
        console.log('[COMMISSION] ── Checking eligible payouts ──');

        const now = new Date();

        // Find payouts where guarantee period has ended
        const eligiblePayouts = await Payout.find({
            status: 'PENDING',
            'replacementGuarantee.endDate': { $lte: now },
            'replacementGuarantee.candidateStatus': 'ACTIVE'
        }).populate('staffingPartner', 'user');

        console.log(`[COMMISSION] Found ${eligiblePayouts.length} payouts becoming eligible`);

        for (const payout of eligiblePayouts) {
            try {
                payout.markEligible();
                await payout.save();

                // Update partner metrics
                await this._updatePartnerMetrics(
                    payout.staffingPartner._id,
                    payout.amount.netPayable,
                    'move_to_eligible'
                );

                // Notify partner
                const notificationEngine = require('./notificationEngine');
                if (payout.staffingPartner.user) {
                    await notificationEngine.send({
                        recipientId: payout.staffingPartner.user,
                        type: 'PAYOUT_ELIGIBLE',
                        title: '✅ Payout Ready for Withdrawal!',
                        message: `Your commission of ₹${payout.amount.netPayable.toLocaleString('en-IN')} is now eligible for withdrawal. The 90-day guarantee period has completed.`,
                        data: {
                            entityType: 'Payout',
                            entityId: payout._id,
                            actionUrl: '/partner/earnings'
                        },
                        channels: { inApp: true, email: true },
                        priority: 'high'
                    });
                }

                console.log(`[COMMISSION] ✅ Payout ${payout._id} marked as ELIGIBLE`);
            } catch (error) {
                console.error(`[COMMISSION] ❌ Failed to process payout ${payout._id}:`, error.message);
            }
        }

        return { processed: eligiblePayouts.length };
    }

    /**
     * Handle candidate leaving early (forfeit commission)
     */
    async handleCandidateLeftEarly(candidateId, leftDate, reportedByUserId) {
        console.log(`[COMMISSION] ── Handling early exit for candidate: ${candidateId} ──`);

        const candidate = await Candidate.findById(candidateId);
        if (!candidate) {
            throw new Error('Candidate not found');
        }

        if (candidate.status !== 'JOINED') {
            throw new Error('Candidate is not in JOINED status');
        }

        // Check if within guarantee period
        const leftDateObj = new Date(leftDate);
        if (leftDateObj > candidate.replacementGuarantee.endDate) {
            throw new Error('Candidate left after guarantee period - commission is valid');
        }

        // Update candidate
        candidate.markLeftEarly(leftDate);
        await candidate.save();

        // Find and forfeit payout
        const payout = await Payout.findOne({ candidate: candidateId });
        if (payout && payout.status !== 'PAID') {
            payout.forfeit(leftDate, reportedByUserId);
            await payout.save();

            // Update partner metrics
            await this._updatePartnerMetrics(
                payout.staffingPartner,
                payout.amount.netPayable,
                'forfeit'
            );

            // Notify partner
            const notificationEngine = require('./notificationEngine');
            const partner = await StaffingPartner.findById(payout.staffingPartner).populate('user');

            if (partner?.user) {
                await notificationEngine.send({
                    recipientId: partner.user._id,
                    type: 'PAYOUT_FORFEITED',
                    title: '❌ Commission Forfeited',
                    message: `${candidate.firstName} ${candidate.lastName} left the company before completing 90 days. The commission of ₹${payout.amount.netPayable.toLocaleString('en-IN')} has been forfeited as per replacement guarantee terms.`,
                    data: {
                        entityType: 'Payout',
                        entityId: payout._id,
                        actionUrl: '/partner/earnings'
                    },
                    channels: { inApp: true, email: true },
                    priority: 'high'
                });
            }

            console.log(`[COMMISSION] ✅ Payout ${payout._id} forfeited`);
        }

        return { forfeited: true, payout: payout?._id };
    }

    /**
     * Get commission configuration
     */
    getConfig() {
        return COMMISSION_CONFIG;
    }

    /**
     * Helper: Format address
     */
    _formatAddress(addr) {
        if (!addr) return '';
        return [addr.street, addr.city, addr.state, addr.pincode, addr.country]
            .filter(Boolean)
            .join(', ');
    }
}

module.exports = new CommissionService();