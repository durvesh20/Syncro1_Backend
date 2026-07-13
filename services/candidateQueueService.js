// backend/services/candidateQueueService.js

const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const aiService = require('./aiService');

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

        // Guard: only process if candidate has confirmed consent
        const processableStatuses = ['CONSENT_CONFIRMED'];
        if (!processableStatuses.includes(candidate.status)) {
            console.warn(`[QUEUE] ⚠️ Skipping processAfterConsent — candidate status is "${candidate.status}", expected "CONSENT_CONFIRMED"`);
            return { skipped: true, reason: `Invalid status: ${candidate.status}` };
        }

        // ✅ Move to ADMIN_REVIEW status immediately so the frontend reflects this state
        candidate.status = 'ADMIN_REVIEW';
        candidate.adminQueue = {
            assignedAt: new Date(),
            action: 'PENDING'
        };
        candidate.statusHistory.push({
            status: 'ADMIN_REVIEW',
            changedAt: new Date(),
            notes: 'Consent confirmed. Moving to Admin Review. AI analysis initiated...'
        });
        await candidate.save();

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
                console.log(`[QUEUE] 🤖 Starting AI analysis for: ${candidate.firstName} ${candidate.lastName}`);

                const formData = {
                    candidateId: candidate._id,
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
                    writeup: candidate.profile?.writeup,
                    skills: candidate.profile?.skills || [],
                    education: candidate.profile?.education || [],
                    certifications: candidate.profile?.certifications || [],
                    languages: candidate.profile?.languages || [],
                    // relocation willingness — stored as canRelocate in Candidate.profile
                    willingToRelocate: candidate.profile?.canRelocate ?? null,
                };

                // ✅ Convert job to plain object
                const jobData = candidate.job?.toObject ? candidate.job.toObject() : candidate.job;

                const result = await aiService.parseResume(
                    candidate.resume.url,
                    candidate.resume.fileName,
                    formData,
                    jobData
                );

                if (result.success && result.fullAnalysis) {
                    parsedData = result.data;                          // ✅ was result.candidateData
                    fullAnalysis = result.fullAnalysis;
                    aiParsed = true;

                    const screening = fullAnalysis.screening || {};
                    const scoring = fullAnalysis.scoring || {};        // ✅ was fullAnalysis.scoreBreakdown
                    const validation = fullAnalysis.validation || {};
                    const rec = fullAnalysis.recommendation || {};
                    const candidateProfile = fullAnalysis.candidateProfile || {};
                    const ranking = fullAnalysis.rankingSignals || {};

                    // ✅ Map AI scoring fields to DB shape
                    scoreBreakdown = {
                        skills: {
                            score: scoring.skillsMatch || 0,
                            weight: 0.30,
                            matchedRequired: ranking.mustHaveSkillsMatched || [],
                            missingRequired: ranking.mustHaveSkillsMissing || [],
                            matchedPreferred: ranking.shouldHaveSkillsMatched || ranking.preferredSkillsMatched || [],
                            missingPreferred: ranking.shouldHaveSkillsMissing || ranking.preferredSkillsMissing || [],
                            coveragePercent: scoring.skillCoveragePercent || 0
                        },
                        experience: {
                            score: scoring.experienceMatch || 0,
                            weight: 0.20,
                            actual: screening.experienceRange?.actual || '',
                            required: screening.experienceRange?.required || '',
                            status: screening.experienceRange?.status || '',
                            detail: validation.experienceDiscrepancyDetail || '',
                            relevancePercent: 100
                        },
                        domain: {
                            score: scoring.domainMatch || 0,
                            weight: 0.05,
                            jobDomain: screening.domainMatch?.jobDomain || '',
                            candidateDomain: screening.domainMatch?.candidateDomain || '',
                            status: screening.domainMatch?.status || ''
                        },
                        education: {
                            score: scoring.educationMatch || 0,
                            weight: 0.05,
                            minimumRequired: screening.educationMatch?.minimumRequired || '',
                            candidateEducation: screening.educationMatch?.candidateEducation || '',
                            status: screening.educationMatch?.status || ''
                        },
                        salary: {
                            score: scoring.salaryFit || 0,
                            weight: 0.10,
                            budget: screening.salaryFit?.budget || '',
                            expected: screening.salaryFit?.expected || '',
                            deltaPercent: screening.salaryFit?.deltaPercent || 0,
                            status: screening.salaryFit?.status || '',
                            withinBudget: ranking.salaryWithinBudget ?? true
                        },
                        location: {
                            score: scoring.locationMatch || 0,
                            weight: 0.10,
                            jobLocation: screening.locationFit?.jobLocation || '',
                            candidateLocation: screening.locationFit?.candidateLocation || '',
                            status: screening.locationFit?.status || '',
                            detail: ''
                        },
                        noticePeriod: {
                            score: scoring.noticePeriodFit || 0,
                            weight: 0.10,
                            required: screening.noticePeriod?.required || '',
                            actual: screening.noticePeriod?.actual || '',
                            days: ranking.noticePeriodDays || 0,
                            status: screening.noticePeriod?.status || ''
                        },
                        stability: {
                            score: scoring.stabilityScore || 0,
                            weight: 0.10,
                            averageTenureYears: screening.stabilityAnalysis?.averageTenureYears || 0,
                            last5YearAverageTenureYears: screening.stabilityAnalysis?.last5YearAverageTenureYears || screening.stabilityAnalysis?.averageTenureYears || 0,
                            totalAverageTenureYears: screening.stabilityAnalysis?.totalAverageTenureYears || 0,
                            isJobHopper: screening.stabilityAnalysis?.isJobHopper || false,
                            risk: screening.stabilityAnalysis?.stabilityRisk || '',
                            detail: screening.stabilityAnalysis?.detail || ''
                        },
                        summary: {
                            weightedScore: scoring.weightedScore || 0,
                            riskPenalty: scoring.riskPenalty || 0,
                            riskBreakdown: {
                                careerGapPenalty: scoring.riskBreakdown?.careerGapPenalty || 0,
                                jobHopperPenalty: scoring.riskBreakdown?.jobHopperPenalty || 0,
                                domainMismatchPenalty: scoring.riskBreakdown?.domainMismatchPenalty || 0,
                                experienceDiscrepancyPenalty: scoring.riskBreakdown?.experienceDiscrepancyPenalty || 0,
                                salaryOverBudgetPenalty: scoring.riskBreakdown?.salaryOverBudgetPenalty || 0
                            },
                            finalAdjustedScore: scoring.finalAdjustedScore || 0,
                            matchLevel: fullAnalysis.matchLevel || 'UNKNOWN'
                        }
                    };
                    profileScore = scoring.finalAdjustedScore || 0;   // ✅ was scoreBreakdown?.summary?.finalAdjustedScore
                    matchLevel = fullAnalysis.matchLevel || 'UNKNOWN';
                    recommendation = rec.decision || 'HOLD';

                    // Build flags from validation
                    flags = [];
                    if (validation.redFlags && validation.redFlags.length > 0) {
                        flags = flags.concat(validation.redFlags.map(f => ({
                            type: 'WARNING',
                            message: f
                        })));
                    }
                    if (validation.greenFlags && validation.greenFlags.length > 0) {
                        flags = flags.concat(validation.greenFlags.map(f => ({
                            type: 'SUCCESS',
                            message: f
                        })));
                    }

                    advice = [
                        ...(rec.suggestedActions || []),
                        ...(rec.interviewFocusAreas || [])
                    ];

                    // Job history logging
                    const jobHistory = candidateProfile.jobHistory || [];
                    console.log(`[QUEUE] 📋 Job History: ${jobHistory.length} job(s) found`);
                    jobHistory.forEach((job, idx) => {
                        console.log(`   Job ${idx + 1}: ${job.company} | ${job.designation} | ${job.fromYear}-${job.toYear} (${job.durationMonths}mo)`);
                    });

                    console.log(`[QUEUE] ✅ AI Analysis Complete:`);
                    console.log(`   📊 Final Score: ${profileScore}/100`);
                    console.log(`   🎯 Match Level: ${matchLevel}`);
                    console.log(`   💡 Decision: ${recommendation}`);
                    console.log(`   🔧 Skills Coverage: ${scoring.skillCoveragePercent}%`);   // ✅ was scoreBreakdown?.skills?.coveragePercent
                    console.log(`   ⚠️  Risk Penalty: ${scoring.riskPenalty || 0}`);          // ✅ was scoreBreakdown?.summary?.riskPenalty

                } else {
                    throw new Error('AI returned no analysis results');
                }

            } catch (aiError) {
                console.error(`[QUEUE] ❌ AI Error:`);
                console.error('   Message:', aiError.message);
                console.error('   Stack:', aiError.stack?.split('\n')[0]);
                throw aiError;
            }
        } else {
            if (!aiEnabled) {
                throw new Error('AI analysis is disabled (AI_ENABLED !== true)');
            } else {
                throw new Error('Candidate has no resume URL for AI analysis');
            }
        }

        // ✅ SAVE COMPLETE RESUME ANALYSIS TO CANDIDATE
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
            fullAnalysis  // ← store complete AI analysis for reference
        };

        // ✅ UPDATE PROFILE WITH EXTRACTED DATA
        if (parsedData?.profile) {
            candidate.profile = {
                ...candidate.profile?.toObject?.() || {},
                currentCompany: parsedData.profile?.currentCompany || candidate.profile?.currentCompany,
                currentDesignation: parsedData.profile?.currentDesignation || candidate.profile?.currentDesignation,
                skills: parsedData.profile?.skills?.length > 0 ? parsedData.profile.skills : candidate.profile?.skills || [],
                education: parsedData.profile?.education?.length > 0 ? parsedData.profile.education : candidate.profile?.education || [],
                languages: parsedData.profile?.languages?.length > 0 ? parsedData.profile.languages : candidate.profile?.languages || [],
                certifications: parsedData.profile?.certifications?.length > 0 ? parsedData.profile.certifications : candidate.profile?.certifications || [],
                location: parsedData.profile?.currentLocation || candidate.profile?.location
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
                ? `AI analyzed. Score: ${profileScore}/100 (${matchLevel}). Decision: ${recommendation}. Risk Penalty: ${scoreBreakdown?.summary?.riskPenalty || 0}.`
                : `Manual review. Score: ${profileScore}/100 (${matchLevel}).`
        });

        await candidate.save();

        await this._notifyAdmins(candidate, profileScore, matchLevel, aiParsed, recommendation);

        console.log(`[QUEUE] ✅ Candidate ${candidate._id} in admin queue\n`);

        return {
            candidateId: candidate._id,
            profileScore,
            matchLevel,
            recommendation,
            aiParsed,
            scoreBreakdown,
            flags,
            advice,
            status: 'ADMIN_REVIEW'
        };
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

        const userObj = await User.findById(adminUserId);
        /*
        if (userObj && userObj.role === 'sub_admin') {
            const hasViewAll = userObj.permissions?.includes('VIEW_ALL_CANDIDATES');
            if (!hasViewAll) {
                const jobObj = await Job.findById(candidate.job?._id || candidate.job);
                if (!jobObj || !jobObj.assignedTo || jobObj.assignedTo.toString() !== adminUserId.toString()) {
                    throw new Error('You are not assigned to this job post. Only the assigned sub-admin or main admin can approve this candidate.');
                }
            }
        }
        */

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

        const userObj = await User.findById(adminUserId);
        /*
        if (userObj && userObj.role === 'sub_admin') {
            const hasViewAll = userObj.permissions?.includes('VIEW_ALL_CANDIDATES');
            if (!hasViewAll) {
                const jobObj = await Job.findById(candidate.job?._id || candidate.job);
                if (!jobObj || !jobObj.assignedTo || jobObj.assignedTo.toString() !== adminUserId.toString()) {
                    throw new Error('You are not assigned to this job post. Only the assigned sub-admin or main admin can reject this candidate.');
                }
            }
        }
        */

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
            const jobObj = await Job.findById(candidate.job?._id || candidate.job);
            let query = {};
            if (jobObj && jobObj.assignedTo) {
                query = {
                    $or: [
                        { role: 'admin' },
                        { _id: jobObj.assignedTo }
                    ],
                    status: 'ACTIVE'
                };
            } else {
                query = {
                    role: 'admin',
                    status: 'ACTIVE'
                };
            }

            const adminUsers = await User.find(query).select('_id');

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
        if (filters.assignedJobIds) query.job = { $in: filters.assignedJobIds };
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