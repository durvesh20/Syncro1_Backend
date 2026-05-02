// backend/services/candidateQueueService.js

const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');

// Minimum score to auto-forward to client
const MIN_SCORE_TO_FORWARD = 40;

class CandidateQueueService {

    /**
     * Called automatically after candidate confirms WhatsApp consent
     * Steps:
     * 1. Parse resume with AI
     * 2. Score profile against job
     * 3. Add to admin queue
     * 4. Notify admin/subadmin
     */
    async processAfterConsent(candidateId) {
        console.log(`[QUEUE] ── Processing candidate after consent: ${candidateId} ──`);

        const candidate = await Candidate.findById(candidateId)
            .populate('job')
            .populate('submittedBy', 'firmName firstName lastName user')
            .populate('company', 'companyName');

        if (!candidate) {
            throw new Error('Candidate not found');
        }

        let profileScore = 0;
        let scoreBreakdown = null;
        let matchLevel = 'UNKNOWN';
        let recommendation = 'Manual Review Required';
        let flags = [];
        let advice = [];
        let parsedData = null;
        let aiParsed = false;
        let fullAnalysis = null;

        const aiEnabled = process.env.AI_ENABLED === 'true';

        if (aiEnabled && candidate.resume?.url) {
            try {
                console.log(`[QUEUE] Starting AI analysis for: ${candidate.firstName} ${candidate.lastName}`);

                const aiService = require('./aiService');

                // ✅ Pass form data AND job description to AI
                const formData = {
                    firstName: candidate.firstName,
                    lastName: candidate.lastName,
                    email: candidate.email,
                    mobile: candidate.mobile,
                    location: candidate.profile?.location,
                    totalExperience: candidate.profile?.totalExperience,
                    relevantExperience: candidate.profile?.relevantExperience,
                    noticePeriod: candidate.profile?.noticePeriod,
                    currentSalary: candidate.profile?.currentSalary,
                    expectedSalary: candidate.profile?.expectedSalary,
                    writeup: candidate.profile?.writeup
                };

                const result = await aiService.parseResume(
                    candidate.resume.url,
                    candidate.resume.fileName,
                    formData,           // ← form data
                    candidate.job       // ← full job document
                );

                if (result.success && result.fullAnalysis) {
                    parsedData = result.data;
                    fullAnalysis = result.fullAnalysis;
                    aiParsed = true;

                    const scoring = fullAnalysis.scoring || {};
                    const rankingSignals = fullAnalysis.rankingSignals || {};
                    const validation = fullAnalysis.validation || {};
                    const rec = fullAnalysis.recommendation || {};

                    profileScore = scoring.finalAdjustedScore || 0;
                    matchLevel = fullAnalysis.matchLevel || 'UNKNOWN';
                    recommendation = rec.decision || 'HOLD';

                    // Build score breakdown for our schema
                    scoreBreakdown = {
                        skills: {
                            score: scoring.skillsMatch || 0,
                            weight: 40,
                            matchedRequired: rankingSignals.mustHaveSkillsMatched || [],
                            missingRequired: rankingSignals.mustHaveSkillsMissing || [],
                            matchedPreferred: rankingSignals.preferredSkillsMatched || [],
                            coveragePercent: scoring.skillCoveragePercent || 0
                        },
                        experience: {
                            score: scoring.experienceMatch || 0,
                            weight: 25,
                            detail: validation.experienceDiscrepancyDetail || '',
                            relevancePercent: scoring.experienceRelevancePercent || 0
                        },
                        salary: {
                            score: scoring.salaryFit || 0,
                            weight: 10,
                            deltaPercent: rankingSignals.salaryDeltaPercent || 0,
                            withinBudget: rankingSignals.salaryWithinBudget || false
                        },
                        location: {
                            score: scoring.locationMatch || 0,
                            weight: 10,
                            detail: validation.locationMatch || 'DIFFERENT'
                        },
                        noticePeriod: {
                            score: scoring.noticePeriodFit || 0,
                            weight: 15,
                            days: rankingSignals.noticePeriodDays || 0
                        }
                    };

                    flags = validation.redFlags?.map(f => ({
                        type: 'WARNING',
                        message: f
                    })) || [];

                    advice = rec.suggestedActions || [];

                    console.log(`[QUEUE] ✅ AI Analysis Complete:`);
                    console.log(`   Score: ${profileScore}/100 | Level: ${matchLevel} | Decision: ${recommendation}`);
                    console.log(`   Skills Coverage: ${scoring.skillCoveragePercent}%`);
                    console.log(`   Risk Penalty: ${scoring.riskPenalty}`);

                } else {
                    console.log('[QUEUE] AI returned no analysis — using manual scoring');
                    const result2 = this._manualScore(candidate);
                    profileScore = result2.score;
                    matchLevel = result2.matchLevel;
                }

            } catch (aiError) {
                console.log(`[QUEUE] AI failed: ${aiError.message} — using manual score`);
                const result2 = this._manualScore(candidate);
                profileScore = result2.score;
                matchLevel = result2.matchLevel;
            }
        } else {
            console.log('[QUEUE] AI disabled — using manual scoring');
            const result2 = this._manualScore(candidate);
            profileScore = result2.score;
            matchLevel = result2.matchLevel;
        }

        // Save to candidate
        candidate.resumeAnalysis = {
            parsed: aiParsed,
            parsedAt: aiParsed ? new Date() : null,
            profileScore,
            scoreBreakdown,
            matchLevel,
            recommendation,
            flags,
            advice,
            aiData: parsedData,
            fullAnalysis  // ← store complete AI analysis
        };

        if (parsedData?.profile) {
            candidate.profile = {
                ...candidate.profile?.toObject?.() || {},
                currentCompany: parsedData.profile?.currentCompany || candidate.profile?.currentCompany,
                currentDesignation: parsedData.profile?.currentDesignation || candidate.profile?.currentDesignation,
                skills: parsedData.profile?.skills?.length > 0
                    ? parsedData.profile.skills
                    : candidate.profile?.skills || [],
                education: parsedData.profile?.education?.length > 0
                    ? parsedData.profile.education
                    : candidate.profile?.education || []
            };
        }

        candidate.status = 'ADMIN_REVIEW';
        candidate.adminQueue = {
            assignedAt: new Date(),
            action: 'PENDING'
        };

        candidate.statusHistory.push({
            status: 'ADMIN_REVIEW',
            changedAt: new Date(),
            notes: aiParsed
                ? `AI analyzed. Score: ${profileScore}/100 (${matchLevel}). Decision: ${recommendation}.`
                : `Manual review. Score: ${profileScore}/100 (${matchLevel}).`
        });

        await candidate.save();

        await this._notifyAdmins(candidate, profileScore, matchLevel, aiParsed, recommendation);

        console.log(`[QUEUE] ✅ Candidate ${candidate._id} in admin queue`);

        return {
            candidateId: candidate._id,
            profileScore,
            matchLevel,
            recommendation,
            aiParsed,
            status: 'ADMIN_REVIEW'
        };
    }

    /**
     * Manual scoring when AI is disabled
     */
    _manualScore(candidate) {
        const exp = candidate.profile?.totalExperience || 0;
        const job = candidate.job;

        let score = 40; // base score

        if (job?.experienceRange) {
            if (exp >= job.experienceRange.min && exp <= job.experienceRange.max) {
                score += 20;
            }
        }

        if (candidate.profile?.expectedSalary && job?.salary?.max) {
            if (candidate.profile.expectedSalary <= job.salary.max) {
                score += 15;
            }
        }

        const matchLevel = score >= 80 ? 'STRONG_MATCH'
            : score >= 65 ? 'GOOD_MATCH'
                : score >= 50 ? 'PARTIAL_MATCH'
                    : 'WEAK_MATCH';

        return { score, matchLevel };
    }

    /**
     * Admin APPROVES candidate → forward to company
     */
    async approveCandidate(candidateId, adminUserId, notes = '') {
        const candidate = await Candidate.findById(candidateId)
            .populate('job', 'title')
            .populate('company', 'companyName user')
            .populate('submittedBy', 'firmName user firstName lastName');

        if (!candidate) throw new Error('Candidate not found');

        if (candidate.status !== 'ADMIN_REVIEW') {
            throw new Error(`Cannot approve candidate with status: ${candidate.status}`);
        }

        // ✅ Move to SUBMITTED — now visible to company
        candidate.status = 'SUBMITTED';
        candidate.adminQueue.reviewedBy = adminUserId;
        candidate.adminQueue.reviewedAt = new Date();
        candidate.adminQueue.action = 'APPROVED';
        candidate.adminQueue.reviewNotes = notes;

        candidate.statusHistory.push({
            status: 'SUBMITTED',
            changedBy: adminUserId,
            changedAt: new Date(),
            notes: `Admin approved. ${notes || ''} Profile sent to company.`
        });

        await candidate.save();

        // ✅ Notify candidate — profile sent to company
        await this._notifyCandidate(candidate, 'APPROVED');

        // ✅ Notify partner
        await this._notifyPartner(candidate, 'APPROVED', notes);

        // ✅ Notify company — new candidate received
        await this._notifyCompany(candidate);

        return candidate;
    }

    /**
     * Admin REJECTS candidate → not forwarded to company
     */
    async rejectCandidate(candidateId, adminUserId, reason) {
        if (!reason || reason.trim().length < 5) {
            throw new Error('Rejection reason is required (minimum 5 characters)');
        }

        const candidate = await Candidate.findById(candidateId)
            .populate('job', 'title')
            .populate('submittedBy', 'firmName user firstName lastName');

        if (!candidate) throw new Error('Candidate not found');

        if (candidate.status !== 'ADMIN_REVIEW') {
            throw new Error(`Cannot reject candidate with status: ${candidate.status}`);
        }

        candidate.status = 'ADMIN_REJECTED';
        candidate.adminQueue.reviewedBy = adminUserId;
        candidate.adminQueue.reviewedAt = new Date();
        candidate.adminQueue.action = 'REJECTED';
        candidate.adminQueue.rejectionReason = reason.trim();

        candidate.statusHistory.push({
            status: 'ADMIN_REJECTED',
            changedBy: adminUserId,
            changedAt: new Date(),
            notes: `Admin rejected: ${reason}`
        });

        await candidate.save();

        // ✅ Notify partner about rejection
        await this._notifyPartner(candidate, 'REJECTED', reason);

        return candidate;
    }

    // ================================================================
    // NOTIFICATION HELPERS
    // ================================================================

    async _notifyAdmins(candidate, score, matchLevel) {
        try {
            const notificationEngine = require('./notificationEngine');
            const adminUsers = await User.find({
                role: { $in: ['admin', 'sub_admin'] },
                status: 'ACTIVE'
            }).select('_id');

            const scoreIcon = score >= 80 ? '🟢' : score >= 60 ? '🔵'
                : score >= 40 ? '🟡' : '🔴';

            for (const admin of adminUsers) {
                await notificationEngine.send({
                    recipientId: admin._id,
                    type: 'NEW_CANDIDATE_SUBMITTED',
                    title: `${scoreIcon} New candidate in queue: ${candidate.firstName} ${candidate.lastName}`,
                    message: `${candidate.submittedBy?.firmName} submitted ${candidate.firstName} ${candidate.lastName} for "${candidate.job?.title}" at ${candidate.company?.companyName}.\n\nProfile Score: ${score}/100 (${matchLevel})\n\nPlease review and approve/reject.`,
                    data: {
                        entityType: 'Candidate',
                        entityId: candidate._id,
                        actionUrl: `/admin/candidates/queue/${candidate._id}`,
                        metadata: {
                            candidateName: `${candidate.firstName} ${candidate.lastName}`,
                            jobTitle: candidate.job?.title,
                            companyName: candidate.company?.companyName,
                            partnerName: candidate.submittedBy?.firmName,
                            profileScore: score,
                            matchLevel
                        }
                    },
                    channels: { inApp: true, email: score >= 60 },
                    priority: score >= 80 ? 'urgent' : score >= 60 ? 'high' : 'medium'
                });
            }

            console.log(`[QUEUE] ✅ Admin(s) notified about candidate ${candidate._id}`);
        } catch (err) {
            console.error('[QUEUE] Admin notification failed:', err.message);
        }
    }

    async _notifyCandidate(candidate, action) {
        try {
            const whatsappService = require('./whatsappService');
            const emailService = require('./emailService');

            if (action === 'APPROVED') {
                // WhatsApp notification to candidate
                await whatsappService.sendMessage(
                    candidate.mobile,
                    `Hi ${candidate.firstName} ${candidate.lastName},\n\n` +
                    `Great news! 🎉\n\n` +
                    `Your profile has been reviewed and sent to *${candidate.company?.companyName}* for the position of *${candidate.job?.title}*.\n\n` +
                    `You will be contacted if shortlisted for the next round.\n\n` +
                    `Best of luck! 🚀\n\n` +
                    `_- Team Syncro1_`
                );

                // Email notification to candidate
                await emailService.sendEmail({
                    to: candidate.email,
                    subject: `Your profile has been sent to ${candidate.company?.companyName}`,
                    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
                          color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                <h1 style="margin: 0;">🎉 Profile Approved!</h1>
              </div>
              <div style="padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb;">
                <p>Dear ${candidate.firstName} ${candidate.lastName},</p>
                <p>Your profile has been reviewed and approved. It has been sent to:</p>
                <div style="background: #dbeafe; border-left: 4px solid #3b82f6; 
                            padding: 15px; margin: 20px 0; border-radius: 4px;">
                  <strong>Company:</strong> ${candidate.company?.companyName}<br>
                  <strong>Position:</strong> ${candidate.job?.title}
                </div>
                <p>You will be contacted directly if you are shortlisted for the next round.</p>
                <p>Best of luck! 🚀</p>
                <p>Team Syncro1</p>
              </div>
            </div>
          `
                });
            }
        } catch (err) {
            console.error('[QUEUE] Candidate notification failed:', err.message);
        }
    }

    async _notifyPartner(candidate, action, notes = '') {
        try {
            const notificationEngine = require('./notificationEngine');

            const partner = await StaffingPartner.findById(
                candidate.submittedBy._id || candidate.submittedBy
            ).select('user');

            if (!partner?.user) return;

            if (action === 'APPROVED') {
                await notificationEngine.send({
                    recipientId: partner.user,
                    type: 'CANDIDATE_SHORTLISTED',
                    title: `✅ Candidate profile approved and sent to client!`,
                    message: `${candidate.firstName} ${candidate.lastName}'s profile for "${candidate.job?.title}" has been approved and forwarded to ${candidate.company?.companyName}. ${notes ? `Note: ${notes}` : ''}`,
                    data: {
                        entityType: 'Candidate',
                        entityId: candidate._id,
                        actionUrl: `/partner/submissions/${candidate._id}`
                    },
                    channels: { inApp: true, email: true },
                    priority: 'high'
                });
            } else if (action === 'REJECTED') {
                await notificationEngine.send({
                    recipientId: partner.user,
                    type: 'CANDIDATE_REJECTED',
                    title: `❌ Candidate profile not approved`,
                    message: `${candidate.firstName} ${candidate.lastName}'s profile for "${candidate.job?.title}" was not approved.\n\nReason: ${notes}`,
                    data: {
                        entityType: 'Candidate',
                        entityId: candidate._id,
                        actionUrl: `/partner/submissions/${candidate._id}`
                    },
                    channels: { inApp: true, email: true },
                    priority: 'medium'
                });
            }
        } catch (err) {
            console.error('[QUEUE] Partner notification failed:', err.message);
        }
    }

    async _notifyCompany(candidate) {
        try {
            const notificationEngine = require('./notificationEngine');
            const Company = require('../models/Company');

            const company = await Company.findById(
                candidate.company?._id || candidate.company
            ).select('user companyName');

            if (!company?.user) return;

            await notificationEngine.send({
                recipientId: company.user,
                type: 'NEW_CANDIDATE_SUBMITTED',
                title: `New candidate for "${candidate.job?.title}"`,
                message: `A new candidate profile has been submitted for the position of "${candidate.job?.title}". Please review the profile in your dashboard.`,
                data: {
                    entityType: 'Candidate',
                    entityId: candidate._id,
                    actionUrl: `/company/jobs/${candidate.job?._id}/candidates/${candidate._id}`
                },
                channels: { inApp: true, email: true },
                priority: 'high'
            });
        } catch (err) {
            console.error('[QUEUE] Company notification failed:', err.message);
        }
    }

    /**
     * Get pending candidates in admin queue
     */
    async getAdminQueue(filters = {}) {
        const query = { status: 'ADMIN_REVIEW' };

        if (filters.jobId) query.job = filters.jobId;
        if (filters.partnerId) query.submittedBy = filters.partnerId;
        if (filters.scoreMin) {
            query['resumeAnalysis.profileScore'] = {
                $gte: parseInt(filters.scoreMin)
            };
        }

        const candidates = await Candidate.find(query)
            .populate('job', 'title category location experienceLevel salary')
            .populate('submittedBy', 'firmName firstName lastName')
            .populate('company', 'companyName')
            .sort({ 'resumeAnalysis.profileScore': -1, createdAt: 1 })
            .select('-statusHistory -notes');

        return candidates.map(c => ({
            ...c.toObject(),
            _queueMeta: {
                score: c.resumeAnalysis?.profileScore || 0,
                matchLevel: c.resumeAnalysis?.matchLevel || 'UNKNOWN',
                recommendation: c.resumeAnalysis?.recommendation || 'Unknown',
                scoreColor: (c.resumeAnalysis?.profileScore || 0) >= 80 ? 'green'
                    : (c.resumeAnalysis?.profileScore || 0) >= 60 ? 'blue'
                        : (c.resumeAnalysis?.profileScore || 0) >= 40 ? 'yellow'
                            : 'red',
                resumeParsed: c.resumeAnalysis?.parsed || false,
                waitingHours: Math.floor(
                    (Date.now() - new Date(c.createdAt)) / (1000 * 60 * 60)
                ),
                flags: c.resumeAnalysis?.flags || [],
                advice: c.resumeAnalysis?.advice || []
            }
        }));
    }
}

module.exports = new CandidateQueueService();