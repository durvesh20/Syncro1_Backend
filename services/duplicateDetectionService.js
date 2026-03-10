const Candidate = require('../models/Candidate');
const Job = require('../models/Job');

// ✅ CONFIGURABLE RULES — Adjust via environment variables without code changes
const DUPLICATE_CONFIG = {
  // How many days before a "double representation" warning clears
  doubleRepresentationCooldownDays: parseInt(process.env.DUPLICATE_COOLDOWN_DAYS) || 90,

  // How many days before same-partner resubmission warning
  selfResubmissionCooldownDays: parseInt(process.env.SELF_RESUBMISSION_DAYS) || 30,

  // Whether cross-job duplicates should block or just warn
  blockCrossJobDuplicates: process.env.BLOCK_CROSS_JOB === 'true',

  // Whether double representation should block or just warn
  blockDoubleRepresentation: process.env.BLOCK_DOUBLE_REP === 'true',

  // Statuses that mean the candidate is "available" (previous submission is done)
  completedStatuses: ['REJECTED', 'WITHDRAWN', 'OFFER_DECLINED']
};

class DuplicateDetectionService {

  /**
   * Check if a candidate can be submitted to a job
   * Called by staffing partner BEFORE submission
   * 
   * Rules:
   * 1. Same email/mobile + same job = ALWAYS BLOCK
   * 2. Same email/mobile + same company + different job = WARN (configurable block)
   * 3. Same person submitted by DIFFERENT partner within N days = WARN (configurable block)
   * 4. Same partner resubmitting to different company within N days = INFO
   * 
   * ✅ ENHANCED: Configurable via .env, better error details
   */
  async checkBeforeSubmission({ email, mobile }, jobId, partnerId) {
    const job = await Job.findById(jobId);
    if (!job) {
      return {
        canSubmit: false,
        blocks: [{ type: 'JOB_NOT_FOUND', message: 'Job not found' }],
        warnings: []
      };
    }

    const result = {
      canSubmit: true,
      blocks: [],
      warnings: []
    };

    const normalizedEmail = email.toLowerCase().trim();

    // ═══════════════════════════════════════════════════════════════
    // Rule 1: Same person + same job = ALWAYS HARD BLOCK
    // ═══════════════════════════════════════════════════════════════
    const sameJobMatch = await Candidate.findOne({
      job: jobId,
      $or: [{ email: normalizedEmail }, { mobile }]
    }).populate('submittedBy', 'firstName lastName firmName');

    if (sameJobMatch) {
      const isSamePartner = sameJobMatch.submittedBy?._id.toString() === partnerId.toString();

      result.canSubmit = false;
      result.blocks.push({
        type: 'SAME_JOB_DUPLICATE',
        message: isSamePartner
          ? 'You have already submitted this candidate for this job'
          : 'This candidate has already been submitted for this job by another partner',
        details: {
          submittedBy: isSamePartner 
            ? 'You' 
            : (sameJobMatch.submittedBy?.firmName || 'Another partner'),
          submittedAt: sameJobMatch.createdAt,
          currentStatus: sameJobMatch.status,
          candidateId: sameJobMatch._id
        }
      });

      return result; // Hard block — no need to check further
    }

    // ═══════════════════════════════════════════════════════════════
    // Rule 2: Same company, different job — CONFIGURABLE
    // ═══════════════════════════════════════════════════════════════
    const sameCompanyMatch = await Candidate.findOne({
      company: job.company,
      job: { $ne: jobId },
      $or: [{ email: normalizedEmail }, { mobile }],
      status: { $nin: DUPLICATE_CONFIG.completedStatuses }
    })
      .populate('job', 'title')
      .populate('submittedBy', 'firmName');

    if (sameCompanyMatch) {
      const isSamePartner = sameCompanyMatch.submittedBy?._id.toString() === partnerId.toString();

      const entry = {
        type: 'CROSS_JOB_DUPLICATE',
        severity: 'medium',
        message: `This candidate is already in the pipeline for "${sameCompanyMatch.job?.title}" at the same company (Status: ${sameCompanyMatch.status})`,
        details: {
          jobTitle: sameCompanyMatch.job?.title,
          submittedBy: isSamePartner 
            ? 'You' 
            : (sameCompanyMatch.submittedBy?.firmName || 'Another partner'),
          status: sameCompanyMatch.status,
          submittedAt: sameCompanyMatch.createdAt,
          candidateId: sameCompanyMatch._id
        }
      };

      // ✅ CONFIGURABLE: Block or just warn?
      if (DUPLICATE_CONFIG.blockCrossJobDuplicates) {
        result.canSubmit = false;
        result.blocks.push({ ...entry, type: 'CROSS_JOB_BLOCKED' });
      } else {
        result.warnings.push(entry);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Rule 3: Double representation — CONFIGURABLE COOLDOWN
    // ═══════════════════════════════════════════════════════════════
    const cooldownDate = new Date(
      Date.now() - DUPLICATE_CONFIG.doubleRepresentationCooldownDays * 24 * 60 * 60 * 1000
    );

    const otherPartnerMatch = await Candidate.findOne({
      submittedBy: { $ne: partnerId },
      $or: [{ email: normalizedEmail }, { mobile }],
      createdAt: { $gte: cooldownDate },
      status: { $nin: DUPLICATE_CONFIG.completedStatuses }
    })
      .populate('job', 'title')
      .populate('company', 'companyName')
      .populate('submittedBy', 'firmName');

    if (otherPartnerMatch) {
      const daysAgo = Math.round(
        (Date.now() - otherPartnerMatch.createdAt) / (1000 * 60 * 60 * 24)
      );
      const daysRemaining = Math.ceil(
        (new Date(
          otherPartnerMatch.createdAt.getTime() + 
          DUPLICATE_CONFIG.doubleRepresentationCooldownDays * 24 * 60 * 60 * 1000
        ) - Date.now()) / (1000 * 60 * 60 * 24)
      );

      const entry = {
        type: 'DOUBLE_REPRESENTATION',
        severity: 'high',
        message: `This candidate was submitted by another partner ${daysAgo} day(s) ago. ` +
                 `Cooldown period: ${daysRemaining} day(s) remaining (${DUPLICATE_CONFIG.doubleRepresentationCooldownDays} days total).`,
        details: {
          company: otherPartnerMatch.company?.companyName,
          jobTitle: otherPartnerMatch.job?.title,
          partnerFirm: otherPartnerMatch.submittedBy?.firmName || 'Another firm',
          status: otherPartnerMatch.status,
          submittedAt: otherPartnerMatch.createdAt,
          daysAgo,
          cooldownEnds: new Date(
            otherPartnerMatch.createdAt.getTime() + 
            DUPLICATE_CONFIG.doubleRepresentationCooldownDays * 24 * 60 * 60 * 1000
          ),
          cooldownDaysRemaining: daysRemaining,
          candidateId: otherPartnerMatch._id
        }
      };

      // ✅ CONFIGURABLE: Block or just warn?
      if (DUPLICATE_CONFIG.blockDoubleRepresentation) {
        result.canSubmit = false;
        result.blocks.push({ ...entry, type: 'DOUBLE_REP_BLOCKED' });
      } else {
        result.warnings.push(entry);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Rule 4: Partner's own recent submission elsewhere — INFO ONLY
    // ═══════════════════════════════════════════════════════════════
    const selfCooldownDate = new Date(
      Date.now() - DUPLICATE_CONFIG.selfResubmissionCooldownDays * 24 * 60 * 60 * 1000
    );

    const selfResubmission = await Candidate.findOne({
      submittedBy: partnerId,
      job: { $ne: jobId },
      company: { $ne: job.company },
      $or: [{ email: normalizedEmail }, { mobile }],
      createdAt: { $gte: selfCooldownDate },
      status: { $nin: DUPLICATE_CONFIG.completedStatuses }
    })
      .populate('job', 'title')
      .populate('company', 'companyName');

    if (selfResubmission) {
      const daysAgo = Math.round(
        (Date.now() - selfResubmission.createdAt) / (1000 * 60 * 60 * 24)
      );

      result.warnings.push({
        type: 'RECENT_SELF_SUBMISSION',
        severity: 'low',
        message: `You submitted this candidate to "${selfResubmission.job?.title}" at ${selfResubmission.company?.companyName} ${daysAgo} day(s) ago`,
        details: {
          jobTitle: selfResubmission.job?.title,
          company: selfResubmission.company?.companyName,
          status: selfResubmission.status,
          submittedAt: selfResubmission.createdAt,
          daysAgo,
          candidateId: selfResubmission._id
        }
      });
    }

    return result;
  }

  /**
   * ✅ NEW: Get current duplicate detection configuration
   * Useful for admin to see/audit settings
   */
  getConfig() {
    return {
      ...DUPLICATE_CONFIG,
      source: {
        doubleRepresentationCooldownDays: process.env.DUPLICATE_COOLDOWN_DAYS || 'default (90)',
        selfResubmissionCooldownDays: process.env.SELF_RESUBMISSION_DAYS || 'default (30)',
        blockCrossJobDuplicates: process.env.BLOCK_CROSS_JOB || 'default (false)',
        blockDoubleRepresentation: process.env.BLOCK_DOUBLE_REP || 'default (false)'
      }
    };
  }

  /**
   * ✅ NEW: Update config at runtime (for admin panel)
   * Note: Changes are NOT persisted (only for current process)
   */
  updateConfig(updates) {
    if (updates.doubleRepresentationCooldownDays !== undefined) {
      DUPLICATE_CONFIG.doubleRepresentationCooldownDays = parseInt(updates.doubleRepresentationCooldownDays);
    }
    if (updates.selfResubmissionCooldownDays !== undefined) {
      DUPLICATE_CONFIG.selfResubmissionCooldownDays = parseInt(updates.selfResubmissionCooldownDays);
    }
    if (updates.blockCrossJobDuplicates !== undefined) {
      DUPLICATE_CONFIG.blockCrossJobDuplicates = updates.blockCrossJobDuplicates === true;
    }
    if (updates.blockDoubleRepresentation !== undefined) {
      DUPLICATE_CONFIG.blockDoubleRepresentation = updates.blockDoubleRepresentation === true;
    }

    return this.getConfig();
  }

  /**
   * ✅ NEW: Check if a specific candidate is a duplicate for a job
   * (Can be called with existing candidate ID instead of email/mobile)
   */
  async checkExistingCandidate(candidateId, newJobId, partnerId) {
    const existingCandidate = await Candidate.findById(candidateId);
    if (!existingCandidate) {
      return {
        canSubmit: false,
        blocks: [{ type: 'CANDIDATE_NOT_FOUND', message: 'Candidate not found' }],
        warnings: []
      };
    }

    return this.checkBeforeSubmission(
      {
        email: existingCandidate.email,
        mobile: existingCandidate.mobile
      },
      newJobId,
      partnerId
    );
  }
}

module.exports = new DuplicateDetectionService();