// backend/services/candidateQueueService.js

const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const StaffingPartner = require('../models/StaffingPartner');
const User = require('../models/User');
const aiService = require('./aiService');
const prescreenService = require('./prescreenService');

// Minimum score to auto-forward to client
const MIN_SCORE_TO_FORWARD = 40;

class CandidateQueueService {

    /**
     * Called automatically after candidate confirms WhatsApp consent.
     * Steps:
     * 1. Run rule-based pre-screen (always, instant, no AI)
     * 2. Move to ADMIN_REVIEW
     * 3. Optionally run AI analysis (only if AUTO_AI_AFTER_CONSENT=true)
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

        // ── STEP 1: Rule-based pre-screen (pure, instant, no AI) ─────────────
        console.log(`[QUEUE] 📋 Running pre-screen for: ${candidate.firstName} ${candidate.lastName}`);
        let prescreenResult = null;
        try {
            prescreenResult = prescreenService.runPreScreen(candidate, candidate.job);
            candidate.prescreen = prescreenResult;
            console.log(`[QUEUE] ✅ Pre-screen complete: ${prescreenResult.prescreen_score}/100 (${prescreenResult.status})`);
        } catch (psErr) {
            console.error('[QUEUE] ⚠️ Pre-screen failed (non-fatal):', psErr.message);
            candidate.prescreen = { status: 'skipped', computed_at: new Date() };
        }

        // ── STEP 2: Move to ADMIN_REVIEW ─────────────────────────────────────
        candidate.status = 'ADMIN_REVIEW';
        candidate.adminQueue = {
            assignedAt: new Date(),
            action: 'PENDING'
        };
        const prescreenNote = prescreenResult
            ? `Pre-screen: ${prescreenResult.prescreen_score}/100 (${prescreenResult.status}). AI match pending manual trigger.`
            : 'Pre-screen skipped. AI match pending manual trigger.';
        candidate.statusHistory.push({
            status: 'ADMIN_REVIEW',
            changedAt: new Date(),
            notes: `Consent confirmed. Moving to Admin Review. ${prescreenNote}`
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
        // AUTO_AI_AFTER_CONSENT: when false (default), AI matching requires a manual trigger.
        // Set to true in .env to restore the old auto-run behaviour.
        const autoAiAfterConsent = process.env.AUTO_AI_AFTER_CONSENT === 'true';

        if (aiEnabled && autoAiAfterConsent && candidate.resume?.url) {
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
                    jobHistory: candidate.profile?.jobHistory || candidate.resumeAnalysis?.aiData?.profile?.jobHistory || candidate.profile?.experience || [],
                    experience: candidate.profile?.experience || candidate.profile?.jobHistory || [],
                    // relocation willingness
                    willingToRelocate: candidate.profile?.willingToRelocate ?? null,
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
                        actualExperienceFromResume: screening.experienceRange?.actualExperienceFromResume || screening.experienceRange?.actual || (candidate.profile?.totalExperience ? `${candidate.profile.totalExperience} Yrs` : 'N/A'),
                        formReportedExperience: screening.experienceRange?.formReportedExperience || (candidate.profile?.totalExperience != null ? `${candidate.profile.totalExperience} Yrs` : 'Not specified'),
                        actual: screening.experienceRange?.actual || (candidate.profile?.totalExperience ? `${candidate.profile.totalExperience} Yrs` : 'N/A'),
                        required: screening.experienceRange?.required || '',
                        status: screening.experienceRange?.status || (scoring.experienceMatch >= 80 ? 'MEETS' : scoring.experienceMatch >= 50 ? 'PARTIAL' : 'BELOW'),
                        detail: screening.experienceRange?.detail || candidate.prescreen?.experience_detail || '',
                        relevancePercent: 100
                    },
                    domain: {
                        score: scoring.domainMatch ?? (screening.domainMatch?.status === 'EXACT' ? 100 : screening.domainMatch?.status === 'RELATED' ? 70 : screening.domainMatch?.status === 'UNRELATED' ? 20 : 50),
                        weight: 0.05,
                        jobDomain: screening.domainMatch?.jobDomain || '',
                        candidateDomain: screening.domainMatch?.candidateDomain || '',
                        status: screening.domainMatch?.status || (scoring.domainMatch >= 80 ? 'EXACT' : scoring.domainMatch >= 50 ? 'RELATED' : 'UNRELATED')
                    },
                    education: {
                        score: scoring.educationMatch || 0, weight: 0.05,
                        minimumRequired: screening.educationMatch?.minimumRequired || '',
                        candidateEducation: screening.educationMatch?.candidateEducation || '',
                        status: screening.educationMatch?.status || ''
                    },
                    salary: {
                        score: scoring.salaryFit || 0, weight: 0.10,
                        budget: screening.salaryFit?.budget || '',
                        expected: screening.salaryFit?.expected || '',
                        status: screening.salaryFit?.status || (scoring.salaryFit >= 80 ? 'WITHIN' : scoring.salaryFit >= 50 ? 'SLIGHTLY_OVER' : 'OVER'),
                        detail: screening.salaryFit?.detail || candidate.prescreen?.salary_detail || '',
                        withinBudget: ranking.salaryWithinBudget ?? true
                    },
                    location: {
                        score: scoring.locationMatch || 0, weight: 0.10,
                        jobLocation: screening.locationFit?.jobLocation || '',
                        candidateLocation: screening.locationFit?.candidateLocation || candidate.profile?.location || '',
                        status: screening.locationFit?.status || (scoring.locationMatch >= 80 ? 'EXACT' : scoring.locationMatch >= 50 ? 'NEARBY' : 'DIFFERENT'),
                        detail: screening.locationFit?.detail || candidate.prescreen?.location_detail || '',
                        willingToRelocate: screening.locationFit?.willingToRelocate ?? candidate.profile?.willingToRelocate ?? null
                    },
                    noticePeriod: {
                        score: scoring.noticePeriodFit ?? candidate.prescreen?.notice_score ?? 0,
                        weight: 0.10,
                        required: screening.noticePeriod?.required || candidate.job?.expectedJoiningDate || '',
                        actual: screening.noticePeriod?.actual || candidate.profile?.noticePeriod || 'Not specified',
                        status: screening.noticePeriod?.status || (candidate.prescreen?.notice_score >= 80 ? 'IMMEDIATE' : candidate.prescreen?.notice_score >= 50 ? 'ACCEPTABLE' : 'LONG'),
                        detail: screening.noticePeriod?.detail || candidate.prescreen?.notice_detail || ''
                    },
                    stability: {
                        score: scoring.stabilityScore || 0, weight: 0.10,
                        averageTenureYears: screening.stabilityAnalysis?.averageTenureYears || 0,
                        last5YearAverageTenureYears: screening.stabilityAnalysis?.last5YearAverageTenureYears || 0,
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

                    advice = []; // Advice deprecated to save token cost

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
                    console.warn('[QUEUE] ⚠️ AI returned success=false or no fullAnalysis, falling back to manual review.');
                }
            } catch (aiError) {
                console.error(`[QUEUE] ❌ AI Error during processing:`);
                console.error('   Message:', aiError.message);
                console.error('   Stack:', aiError.stack?.split('\n')[0]);
            }
        } else {
            if (!aiEnabled) {
                console.log('[QUEUE] AI analysis is disabled (AI_ENABLED !== true), using manual review fallback.');
            } else {
                console.warn('[QUEUE] Candidate has no resume URL, using manual review fallback.');
            }
        }

        // Initialize default/fallback scoreBreakdown if AI was not parsed successfully
        if (!aiParsed) {
            scoreBreakdown = {
                skills: {
                    score: 0,
                    weight: 0.30,
                    matchedRequired: [],
                    missingRequired: [],
                    matchedPreferred: [],
                    missingPreferred: [],
                    coveragePercent: 0
                },
                experience: {
                    score: 0,
                    weight: 0.20,
                    totalExperience: candidate.profile?.totalExperience != null ? `${candidate.profile.totalExperience} years` : 'Not provided',
                    relevantExperience: candidate.profile?.relevantExperience != null ? `${candidate.profile.relevantExperience} years` : 'Not provided',
                    actualExperienceFromResume: 'Not provided',
                    actual: '',
                    required: '',
                    status: '',
                    detail: 'AI analysis failed/skipped — manual review required',
                    relevancePercent: 100
                },
                domain: {
                    score: 0,
                    weight: 0.05,
                    jobDomain: '',
                    candidateDomain: '',
                    status: ''
                },
                education: {
                    score: 0,
                    weight: 0.05,
                    minimumRequired: '',
                    candidateEducation: '',
                    status: ''
                },
                salary: {
                    score: 0,
                    weight: 0.10,
                    budget: '',
                    expected: '',
                    deltaPercent: 0,
                    status: '',
                    withinBudget: true
                },
                location: {
                    score: 0,
                    weight: 0.10,
                    jobLocation: '',
                    candidateLocation: '',
                    status: '',
                    detail: '',
                    willingToRelocate: candidate.profile?.willingToRelocate ?? candidate.willingToRelocate ?? null
                },
                noticePeriod: {
                    score: 0,
                    weight: 0.10,
                    required: '',
                    actual: '',
                    days: 0,
                    status: ''
                },
                stability: {
                    score: 0,
                    weight: 0.10,
                    averageTenureYears: 0,
                    last5YearAverageTenureYears: 0,
                    totalAverageTenureYears: 0,
                    isJobHopper: false,
                    risk: '',
                    detail: ''
                },
                summary: {
                    weightedScore: 0,
                    riskPenalty: 0,
                    riskBreakdown: {
                        careerGapPenalty: 0,
                        jobHopperPenalty: 0,
                        domainMismatchPenalty: 0,
                        experienceDiscrepancyPenalty: 0,
                        salaryOverBudgetPenalty: 0
                    },
                    finalAdjustedScore: 0,
                    matchLevel: 'PENDING'
                }
            };
            profileScore = 0;
            matchLevel = 'PENDING';
            recommendation = 'HOLD';
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
            const parsedRelocate = parsedData.profile?.willingToRelocate !== undefined
                ? (parsedData.profile.willingToRelocate === true || parsedData.profile.willingToRelocate === 'true')
                : null;
            const finalRelocate = candidate.profile?.willingToRelocate ?? candidate.willingToRelocate ?? parsedRelocate;
            candidate.profile = {
                ...candidate.profile?.toObject?.() || {},
                currentCompany: parsedData.profile?.currentCompany || candidate.profile?.currentCompany,
                currentDesignation: parsedData.profile?.currentDesignation || candidate.profile?.currentDesignation,
                skills: parsedData.profile?.skills?.length > 0 ? parsedData.profile.skills : candidate.profile?.skills || [],
                education: parsedData.profile?.education?.length > 0 ? parsedData.profile.education : candidate.profile?.education || [],
                experience: parsedData.profile?.experience?.length > 0 ? parsedData.profile.experience : candidate.profile?.experience || [],
                jobHistory: parsedData.profile?.jobHistory?.length > 0 ? parsedData.profile.jobHistory : (parsedData.profile?.experience?.length > 0 ? parsedData.profile.experience : candidate.profile?.jobHistory || []),
                // Preserve AI-calculated experience months for scoring
                totalExperienceMonths: parsedData.profile?.totalExperienceMonths || candidate.profile?.totalExperienceMonths || null,
                experienceYears: parsedData.profile?.experienceYears || candidate.profile?.experienceYears || null,
                languages: parsedData.profile?.languages?.length > 0 ? parsedData.profile.languages : candidate.profile?.languages || [],
                // Normalize certifications: AI may return objects ({name, certificateId, validTill}), schema expects [String]
                certifications: (() => {
                    const raw = parsedData.profile?.certifications;
                    if (Array.isArray(raw) && raw.length > 0) {
                        return raw.map(c => typeof c === 'string' ? c : (c.name || c.title || c.certification || JSON.stringify(c)));
                    }
                    return candidate.profile?.certifications || [];
                })(),
                location: candidate.profile?.location,
                currentLocation: parsedData.profile?.currentLocation || candidate.profile?.currentLocation || candidate.profile?.location,
                willingToRelocate: finalRelocate
            };
            if (candidate.willingToRelocate === undefined && finalRelocate !== null) {
                candidate.willingToRelocate = finalRelocate;
            }
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
                advice: c.resumeAnalysis?.advice || [],
                prescreen: c.prescreen
            }
        }));
    }

    /**
     * Manually trigger AI matching for a candidate.
     * Called from the admin "Run AI Match" endpoint.
     * Reuses the same AI pipeline as processAfterConsent — no duplication.
     *
     * @param {string} candidateId
     * @param {string} triggeredByUserId — admin/subadmin user ID (for audit trail)
     * @returns {object} updated resumeAnalysis + prescreen
     */
    async runAIMatchForCandidate(candidateId, triggeredByUserId) {
        console.log(`[QUEUE] 🤖 Manual AI match triggered for candidate: ${candidateId} by user: ${triggeredByUserId}`);

        const candidate = await Candidate.findById(candidateId)
            .populate('job')
            .populate('submittedBy', 'firmName firstName lastName user')
            .populate('company', 'companyName');

        if (!candidate) throw new Error('Candidate not found');

        if (!candidate.resume?.url) {
            throw new Error('Candidate has no resume URL — AI match cannot run');
        }

        const aiEnabled = process.env.AI_ENABLED === 'true';
        if (!aiEnabled) {
            throw new Error('AI is disabled (AI_ENABLED !== true) — cannot run AI match');
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

        try {
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
                jobHistory: candidate.profile?.jobHistory || candidate.resumeAnalysis?.aiData?.profile?.jobHistory || candidate.profile?.experience || [],
                experience: candidate.profile?.experience || candidate.profile?.jobHistory || [],
                willingToRelocate: candidate.profile?.willingToRelocate ?? null,
            };

            const jobData = candidate.job?.toObject ? candidate.job.toObject() : candidate.job;

            const result = await aiService.parseResume(
                    candidate.resume.url,
                    candidate.resume.fileName,
                    formData,
                    jobData
                );

            if (result.success && result.fullAnalysis) {
                parsedData = result.data;
                fullAnalysis = result.fullAnalysis;
                aiParsed = true;

                const screening = fullAnalysis.screening || {};
                const scoring = fullAnalysis.scoring || {};
                const validation = fullAnalysis.validation || {};
                const rec = fullAnalysis.recommendation || {};
                const candidateProfile = fullAnalysis.candidateProfile || {};
                const ranking = fullAnalysis.rankingSignals || {};

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
                        totalExperience: candidate.profile?.totalExperience != null ? `${candidate.profile.totalExperience} years` : 'Not provided',
                        relevantExperience: candidate.profile?.relevantExperience != null ? `${candidate.profile.relevantExperience} years` : 'Not provided',
                        actual: screening.experienceRange?.actual || '',
                        required: screening.experienceRange?.required || '',
                        status: screening.experienceRange?.status || (scoring.experienceMatch >= 80 ? 'MEETS' : scoring.experienceMatch >= 50 ? 'PARTIAL' : 'BELOW'),
                        detail: validation.experienceDiscrepancyDetail || '',
                        relevancePercent: 100
                    },
                    domain: {
                        score: scoring.domainMatch || 0, weight: 0.05,
                        jobDomain: screening.domainMatch?.jobDomain || '',
                        candidateDomain: screening.domainMatch?.candidateDomain || '',
                        status: screening.domainMatch?.status || ''
                    },
                    education: {
                        score: scoring.educationMatch || 0, weight: 0.05,
                        minimumRequired: screening.educationMatch?.minimumRequired || '',
                        candidateEducation: screening.educationMatch?.candidateEducation || '',
                        status: screening.educationMatch?.status || ''
                    },
                    salary: {
                        score: scoring.salaryFit || 0, weight: 0.10,
                        budget: screening.salaryFit?.budget || '',
                        expected: screening.salaryFit?.expected || '',
                        deltaPercent: screening.salaryFit?.deltaPercent || 0,
                        status: screening.salaryFit?.status || (scoring.salaryFit >= 80 ? 'WITHIN' : scoring.salaryFit >= 50 ? 'SLIGHTLY_OVER' : 'OVER'),
                        withinBudget: ranking.salaryWithinBudget ?? true
                    },
                    location: {
                        score: scoring.locationMatch || 0, weight: 0.10,
                        jobLocation: screening.locationFit?.jobLocation || '',
                        candidateLocation: screening.locationFit?.candidateLocation || '',
                        status: screening.locationFit?.status || (scoring.locationMatch >= 80 ? 'EXACT' : scoring.locationMatch >= 50 ? 'NEARBY' : 'DIFFERENT'),
                        detail: screening.locationFit?.detail || '',
                        willingToRelocate: screening.locationFit?.willingToRelocate ?? candidate.profile?.willingToRelocate ?? null
                    },
                    noticePeriod: {
                        score: scoring.noticePeriodFit || 0, weight: 0.10,
                        required: screening.noticePeriod?.required || '',
                        actual: screening.noticePeriod?.actual || '',
                        days: ranking.noticePeriodDays || 0,
                        status: screening.noticePeriod?.status || (scoring.noticePeriodFit >= 80 ? 'IMMEDIATE' : scoring.noticePeriodFit >= 50 ? 'ACCEPTABLE' : 'LONG')
                    },
                    stability: {
                        score: scoring.stabilityScore || 0, weight: 0.10,
                        averageTenureYears: screening.stabilityAnalysis?.averageTenureYears || 0,
                        last5YearAverageTenureYears: screening.stabilityAnalysis?.last5YearAverageTenureYears || 0,
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

                profileScore = scoring.finalAdjustedScore || 0;
                matchLevel = fullAnalysis.matchLevel || 'UNKNOWN';
                recommendation = rec.decision || 'HOLD';

                flags = [
                    ...(validation.redFlags || []).map(f => ({ type: 'WARNING', message: f })),
                    ...(validation.greenFlags || []).map(f => ({ type: 'SUCCESS', message: f }))
                ];
                advice = []; // Advice deprecated to save token cost

                if (parsedData?.profile) {
                    candidate.profile = {
                        ...candidate.profile?.toObject?.() || {},
                        currentCompany: parsedData.profile?.currentCompany || candidate.profile?.currentCompany,
                        currentDesignation: parsedData.profile?.currentDesignation || candidate.profile?.currentDesignation,
                        skills: parsedData.profile?.skills?.length > 0 ? parsedData.profile.skills : candidate.profile?.skills || [],
                        education: parsedData.profile?.education?.length > 0 ? parsedData.profile.education : candidate.profile?.education || [],
                        experience: parsedData.profile?.experience?.length > 0 ? parsedData.profile.experience : candidate.profile?.experience || [],
                        totalExperienceMonths: parsedData.profile?.totalExperienceMonths || candidate.profile?.totalExperienceMonths || null,
                        experienceYears: parsedData.profile?.experienceYears || candidate.profile?.experienceYears || null,
                        languages: parsedData.profile?.languages?.length > 0 ? parsedData.profile.languages : candidate.profile?.languages || [],
                        certifications: (() => {
                            const raw = parsedData.profile?.certifications;
                            if (Array.isArray(raw) && raw.length > 0) {
                                return raw.map(c => typeof c === 'string' ? c : (c.name || c.title || JSON.stringify(c)));
                            }
                            return candidate.profile?.certifications || [];
                        })(),
                        location: candidate.profile?.location,
                        currentLocation: parsedData.profile?.currentLocation || candidate.profile?.currentLocation || candidate.profile?.location,
                        willingToRelocate: candidate.profile?.willingToRelocate ?? parsedData.profile?.willingToRelocate ?? null,
                    };
                }

                console.log(`[QUEUE] ✅ Manual AI match complete: ${profileScore}/100 (${matchLevel})`);
            } else {
                console.warn('[QUEUE] ⚠️ AI returned success=false or no fullAnalysis');
            }
        } catch (aiError) {
            console.error('[QUEUE] ❌ AI error during manual match:', aiError.message);
            throw new Error(`AI analysis failed: ${aiError.message}`);
        }

        // Build default scoreBreakdown if AI failed
        if (!aiParsed) {
            scoreBreakdown = {
                skills: { score: 0, weight: 0.30, matchedRequired: [], missingRequired: [], matchedPreferred: [], missingPreferred: [], coveragePercent: 0 },
                experience: { score: 0, weight: 0.20, actual: '', required: '', status: '', detail: 'AI analysis failed', relevancePercent: 100 },
                domain: { score: 0, weight: 0.05, jobDomain: '', candidateDomain: '', status: '' },
                education: { score: 0, weight: 0.05, minimumRequired: '', candidateEducation: '', status: '' },
                salary: { score: 0, weight: 0.10, budget: '', expected: '', deltaPercent: 0, status: '', withinBudget: true },
                location: { score: 0, weight: 0.10, jobLocation: '', candidateLocation: '', status: '', detail: '' },
                noticePeriod: { score: 0, weight: 0.10, required: '', actual: '', days: 0, status: '' },
                stability: { score: 0, weight: 0.10, averageTenureYears: 0, last5YearAverageTenureYears: 0, totalAverageTenureYears: 0, isJobHopper: false, risk: '', detail: '' },
                summary: { weightedScore: 0, riskPenalty: 0, riskBreakdown: {}, finalAdjustedScore: 0, matchLevel: 'PENDING' }
            };
            matchLevel = 'PENDING';
            recommendation = 'HOLD';
        }

        // Save AI result
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
            fullAnalysis
        };

        // Audit trail entry
        candidate.auditTrail = candidate.auditTrail || [];
        candidate.auditTrail.push({
            actorId: triggeredByUserId,
            actorRole: 'admin',
            action: 'MANUAL_AI_MATCH',
            fromState: candidate.status,
            toState: candidate.status, // status unchanged by AI match
            reason: 'Admin manually triggered AI matching',
            timestamp: new Date()
        });

        candidate.statusHistory.push({
            status: candidate.status,
            changedBy: triggeredByUserId,
            changedAt: new Date(),
            notes: aiParsed
                ? `AI match run manually. Score: ${profileScore}/100 (${matchLevel}).`
                : 'AI match attempted manually but failed.'
        });

        await candidate.save();

        console.log(`[QUEUE] ✅ Manual AI match saved for candidate ${candidate._id}`);

        return {
            candidateId: candidate._id,
            profileScore,
            matchLevel,
            recommendation,
            aiParsed,
            scoreBreakdown,
            flags,
            advice,
            prescreen: candidate.prescreen
        };
    }
}

module.exports = new CandidateQueueService();