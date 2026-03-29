const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const Company = require('../models/Company');
const StaffingPartner = require('../models/StaffingPartner');
const StatusMachine = require('../utils/statusMachine');

class CandidateLifecycleService {

  /**
   * Update candidate status with:
   * 1. Transition validation
   * 2. Role-based permission check
   * 3. Metric updates (atomic)
   * 4. Notification to staffing partner
   * 
   * Called by: Company (status changes) or Partner (withdrawal only)
   */
  async updateStatus(candidateId, newStatus, updatedByUserId, userRole, notes = '') {
    // ✅ FIX: Ensure ALL required fields are populated for notifications
    // Nested populate for submittedBy.user and company.user
    const candidate = await Candidate.findById(candidateId)
      .populate({
        path: 'job',
        select: 'title commission vacancies filledPositions'
      })
      .populate({
        path: 'submittedBy',
        select: 'firstName lastName firmName user',
        populate: {
          path: 'user',
          select: '_id email'     // ✅ Populate nested user reference
        }
      })
      .populate({
        path: 'company',
        select: 'companyName user',
        populate: {
          path: 'user',
          select: '_id email'     // ✅ Populate company's user too
        }
      });

    if (!candidate) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const previousStatus = candidate.status;

    // ✅ Step 1: Validate transition
    const transition = StatusMachine.canTransition(
      'candidate',
      previousStatus,
      newStatus,
      userRole
    );

    if (!transition.allowed) {
      const error = new Error(transition.message);
      error.statusCode = 400;
      error.allowedTransitions = transition.allowedTransitions;
      throw error;
    }

    // ✅ Step 2: Update candidate status
    candidate.status = newStatus;
    candidate.statusHistory.push({
      status: newStatus,
      changedBy: updatedByUserId,
      changedAt: new Date(),
      notes
    });

    await candidate.save();

    // ✅ Step 3: Update job metrics atomically
    await this._updateJobMetrics(candidate.job._id, previousStatus, newStatus);

    // ✅ Step 4: Notify the OTHER party (fire-and-forget to avoid blocking)
    // ✅ FIX #12: Don't await notifications - they run in background
    if (userRole === 'company' || userRole === 'admin') {
      // Company changed status → notify partner (non-blocking)
      this._notifyPartner(candidate, previousStatus, newStatus, notes)
        .catch(err => console.error('[NOTIFY] Partner notification failed:', err.message));
    } else if (userRole === 'staffing_partner') {
      // Partner withdrew → notify company (non-blocking)
      this._notifyCompany(candidate, previousStatus, newStatus, notes)
        .catch(err => console.error('[NOTIFY] Company notification failed:', err.message));
    }

    // ✅ Step 5: Handle special status actions (fire-and-forget)
    // ✅ FIX #12: Don't await joining handler either - it's non-critical
    if (newStatus === 'JOINED') {
      this._handleJoining(candidate)
        .catch(err => console.error('[LIFECYCLE] Joining handler failed:', err.message));
    }

    return candidate;
  }

  /**
   * Update job metrics using atomic $inc to avoid race conditions
   * ✅ FIX #3: Already has error handling - metrics are non-critical
   */
  async _updateJobMetrics(jobId, previousStatus, newStatus) {
    const metricsMap = {
      'SHORTLISTED': 'metrics.shortlisted',
      'INTERVIEWED': 'metrics.interviewed',
      'OFFERED': 'metrics.offered',
      'JOINED': 'metrics.joined'
    };

    const field = metricsMap[newStatus];
    if (field) {
      try {
        await Job.findByIdAndUpdate(jobId, { $inc: { [field]: 1 } });
        console.log(`[METRICS] ✅ Incremented ${field} for job ${jobId}`);
      } catch (error) {
        console.error(`[METRICS] ❌ Failed to update ${field}:`, error.message);
        // Don't throw - metrics are non-critical
      }
    }
  }

  /**
   * Notify staffing partner when company changes candidate status
   * This is the PRIMARY feedback loop of the platform
   */
  async _notifyPartner(candidate, previousStatus, newStatus, notes) {
    try {
      // ✅ FIX #2: Lazy load to avoid circular dependency
      const notificationEngine = require('./notificationEngine');
      
      // ✅ FIX: Handle both populated and unpopulated user references
      let partnerUserId;

      if (candidate.submittedBy?.user?._id) {
        // Fully populated: submittedBy.user is a User document
        partnerUserId = candidate.submittedBy.user._id;
      } else if (candidate.submittedBy?.user) {
        // Partially populated: submittedBy.user is just an ObjectId
        partnerUserId = candidate.submittedBy.user;
      } else {
        // Not populated at all — fetch manually
        console.warn(`[NOTIFY] submittedBy.user not populated for candidate ${candidate._id}`);
        const partnerId = candidate.submittedBy?._id || candidate.submittedBy;
        
        if (!partnerId) {
          console.error(`[NOTIFY] ❌ Cannot determine partner for candidate ${candidate._id}`);
          return;
        }

        const partner = await StaffingPartner.findById(partnerId).select('user');
        
        if (!partner?.user) {
          console.error(`[NOTIFY] ❌ Cannot find partner user for candidate ${candidate._id}`);
          return;
        }
        
        partnerUserId = partner.user;
      }

      // ✅ Safely extract values even if not populated
      const candidateName = `${candidate.firstName} ${candidate.lastName}`;
      const jobTitle = typeof candidate.job === 'object' ? candidate.job.title : 'a position';
      const companyName = typeof candidate.company === 'object' 
        ? candidate.company.companyName 
        : 'the company';

      const notifications = {
        'UNDER_REVIEW': {
          type: 'CANDIDATE_UNDER_REVIEW',
          title: '📋 Resume under review',
          message: `${companyName} is reviewing ${candidateName}'s profile for "${jobTitle}".`,
          priority: 'low',
          sendEmail: false
        },
        'SHORTLISTED': {
          type: 'CANDIDATE_SHORTLISTED',
          title: '🎯 Candidate shortlisted!',
          message: `Great news! ${candidateName} has been shortlisted for "${jobTitle}" at ${companyName}.`,
          priority: 'high',
          sendEmail: true
        },
        'INTERVIEW_SCHEDULED': {
          type: 'CANDIDATE_INTERVIEW_SCHEDULED',
          title: '📅 Interview scheduled',
          message: `An interview has been scheduled for ${candidateName} for "${jobTitle}" at ${companyName}.`,
          priority: 'high',
          sendEmail: true
        },
        'INTERVIEWED': {
          type: 'CANDIDATE_INTERVIEWED',
          title: '✅ Interview completed',
          message: `${candidateName}'s interview for "${jobTitle}" at ${companyName} has been completed.`,
          priority: 'medium',
          sendEmail: false
        },
        'OFFERED': {
          type: 'CANDIDATE_OFFERED',
          title: '🎉 Offer extended!',
          message: `${companyName} has made an offer to ${candidateName} for "${jobTitle}"!${notes ? ` Details: ${notes}` : ''}`,
          priority: 'urgent',
          sendEmail: true
        },
        'OFFER_ACCEPTED': {
          type: 'CANDIDATE_OFFER_ACCEPTED',
          title: '✨ Offer accepted!',
          message: `${candidateName} has accepted the offer for "${jobTitle}" at ${companyName}!`,
          priority: 'urgent',
          sendEmail: true
        },
        'OFFER_DECLINED': {
          type: 'CANDIDATE_OFFER_DECLINED',
          title: '😔 Offer declined',
          message: `${candidateName} has declined the offer for "${jobTitle}".${notes ? ` Reason: ${notes}` : ''}`,
          priority: 'high',
          sendEmail: true
        },
        'JOINED': {
          type: 'CANDIDATE_JOINED',
          title: '🚀 Candidate has joined!',
          message: `${candidateName} has officially joined ${companyName} for "${jobTitle}". Congratulations on the successful placement!`,
          priority: 'urgent',
          sendEmail: true
        },
        'REJECTED': {
          type: 'CANDIDATE_REJECTED',
          title: '❌ Candidate not selected',
          message: `${candidateName} was not selected for "${jobTitle}" at ${companyName}.${notes ? ` Feedback: ${notes}` : ''}`,
          priority: 'medium',
          sendEmail: true
        },
        'ON_HOLD': {
          type: 'CANDIDATE_ON_HOLD',
          title: '⏸️ Application on hold',
          message: `${candidateName}'s application for "${jobTitle}" has been put on hold.${notes ? ` Note: ${notes}` : ''}`,
          priority: 'low',
          sendEmail: false
        }
      };

      const notif = notifications[newStatus];
      if (!notif) {
        console.warn(`[NOTIFY] ⚠️ No notification template for status: ${newStatus}`);
        return;
      }

      await notificationEngine.send({
        recipientId: partnerUserId,
        type: notif.type,
        title: notif.title,
        message: notif.message,
        data: {
          entityType: 'Candidate',
          entityId: candidate._id,
          actionUrl: `/partner/submissions/${candidate._id}`,
          metadata: {
            candidateName,
            jobTitle,
            companyName,
            previousStatus,
            newStatus,
            notes: notes || null
          }
        },
        channels: {
          inApp: true,
          email: notif.sendEmail,
          whatsapp: ['OFFERED', 'JOINED'].includes(newStatus)
        },
        priority: notif.priority
      });

      console.log(`[NOTIFY] ✅ Sent ${newStatus} notification to partner ${partnerUserId}`);
    } catch (error) {
      // ✅ Never let notification failure break the main flow
      console.error(`[NOTIFY] ❌ Failed to notify partner: ${error.message}`);
      // Don't rethrow - notifications are non-critical
    }
  }

  /**
   * Notify company when partner withdraws a candidate
   */
  async _notifyCompany(candidate, previousStatus, newStatus, notes) {
    try {
      // ✅ FIX #2: Lazy load to avoid circular dependency
      const notificationEngine = require('./notificationEngine');
      
      // ✅ FIX: Handle both populated and unpopulated company.user
      let companyUserId;

      if (candidate.company?.user?._id) {
        companyUserId = candidate.company.user._id;
      } else if (candidate.company?.user) {
        companyUserId = candidate.company.user;
      } else {
        console.warn(`[NOTIFY] company.user not populated for candidate ${candidate._id}`);
        const companyId = candidate.company?._id || candidate.company;
        
        if (!companyId) {
          console.error(`[NOTIFY] ❌ Cannot determine company for candidate ${candidate._id}`);
          return;
        }

        const company = await Company.findById(companyId).select('user');
        
        if (!company?.user) {
          console.error(`[NOTIFY] ❌ Cannot find company user for candidate ${candidate._id}`);
          return;
        }
        
        companyUserId = company.user;
      }

      if (newStatus === 'WITHDRAWN') {
        const partnerName = candidate.submittedBy?.firmName || 'A staffing partner';
        const candidateName = `${candidate.firstName} ${candidate.lastName}`;
        const jobTitle = typeof candidate.job === 'object' ? candidate.job.title : 'a position';

        await notificationEngine.send({
          recipientId: companyUserId,
          type: 'CANDIDATE_WITHDRAWN',
          title: '⚠️ Candidate withdrawn',
          message: `${partnerName} has withdrawn ${candidateName} from "${jobTitle}".${notes ? ` Reason: ${notes}` : ''}`,
          data: {
            entityType: 'Candidate',
            entityId: candidate._id,
            actionUrl: `/company/candidates/${candidate._id}`,
            metadata: {
              candidateName,
              jobTitle,
              partnerName,
              notes: notes || null
            }
          },
          channels: { inApp: true, email: true },
          priority: 'medium'
        });

        console.log(`[NOTIFY] ✅ Notified company about withdrawal of candidate ${candidate._id}`);
      }
    } catch (error) {
      console.error(`[NOTIFY] ❌ Failed to notify company: ${error.message}`);
      // Don't rethrow - notifications are non-critical
    }
  }

  /**
   * Handle joining — update metrics only (commission/invoice system disabled)
   * ✅ UPDATED: All commission/payout/invoice logic commented out
   */
  async _handleJoining(candidate) {
    console.log(`[LIFECYCLE] ── Handling JOINED for: ${candidate.firstName} ${candidate.lastName} ──`);

    try {
      /* ========== COMMISSION/PAYOUT CALCULATION - DISABLED ==========
      // ✅ Step 1: Validate that offer exists with salary
      if (!candidate.offer || !candidate.offer.salary) {
        console.warn(
          `[LIFECYCLE] ⚠️ No offer/salary found for candidate ${candidate._id}. ` +
          `Invoice and commission cannot be calculated. ` +
          `Company must set offer before marking as JOINED.`
        );
        
        // Still update metrics even without offer
        await this._updateJoiningMetrics(candidate);
        return;
      }

      // ✅ Step 2: Get job with commission details
      const job = typeof candidate.job === 'object' 
        ? candidate.job 
        : await Job.findById(candidate.job);

      if (!job?.commission) {
        console.warn(`[LIFECYCLE] ⚠️ No commission info on job ${candidate.job}`);
        await this._updateJoiningMetrics(candidate);
        return;
      }

      // ✅ Step 3: Calculate commission
      let commissionAmount;
      if (job.commission.type === 'percentage') {
        commissionAmount = Math.round(candidate.offer.salary * job.commission.value / 100);
      } else {
        commissionAmount = job.commission.value;
      }

      console.log(
        `[LIFECYCLE] Commission: ₹${commissionAmount.toLocaleString('en-IN')} ` +
        `(${job.commission.type}: ${job.commission.value}${job.commission.type === 'percentage' ? '%' : ''} ` +
        `on salary ₹${candidate.offer.salary.toLocaleString('en-IN')})`
      );

      // ✅ Step 4: Update candidate payout
      candidate.payout = {
        commissionAmount,
        status: 'PENDING'
      };
      await candidate.save();

      // Update partner pending payouts
      const partnerId = candidate.submittedBy?._id || candidate.submittedBy;
      await StaffingPartner.findByIdAndUpdate(partnerId, {
        $inc: { 'metrics.pendingPayouts': commissionAmount }
      });

      // ✅ Step 6: Generate invoice (non-fatal if fails)
      try {
        const invoiceController = require('../controllers/invoiceController');
        const invoice = await invoiceController.generateInvoice(candidate._id);
        console.log(`[LIFECYCLE] ✅ Invoice generated: ${invoice.invoiceNumber}`);
      } catch (invoiceError) {
        console.error(`[LIFECYCLE] ⚠️ Invoice generation failed (non-fatal): ${invoiceError.message}`);
        // Don't throw — invoice can be generated later manually
      }
      ========== END COMMISSION/PAYOUT ========== */

      // ✅ Only update metrics (no commission)
      await this._updateJoiningMetrics(candidate);

      // ✅ Update job fill status
      const job = typeof candidate.job === 'object' 
        ? candidate.job 
        : await Job.findById(candidate.job);
        
      if (job) {
        job.filledPositions = (job.filledPositions || 0) + 1;
        if (job.filledPositions >= job.vacancies) {
          job.status = 'FILLED';
          console.log(`[LIFECYCLE] ✅ Job "${job.title}" is now FILLED (${job.filledPositions}/${job.vacancies})`);
        }
        await job.save();
      }

      console.log(`[LIFECYCLE] ── JOINED handling complete (commission disabled) ──`);
    } catch (error) {
      console.error(`[LIFECYCLE] ❌ Joining handler error: ${error.message}`);
      console.error(error.stack);
      // ✅ Never throw — the status change should still succeed
    }
  }

  /**
   * ✅ Update metrics that should happen regardless of commission
   */
  async _updateJoiningMetrics(candidate) {
    try {
      const partnerId = candidate.submittedBy?._id || candidate.submittedBy;
      const companyId = candidate.company?._id || candidate.company;

      // ✅ Use Promise.allSettled instead of Promise.all to handle partial failures
      const results = await Promise.allSettled([
        StaffingPartner.findByIdAndUpdate(partnerId, {
          $inc: { 'metrics.totalPlacements': 1 }
        }),
        Company.findByIdAndUpdate(companyId, {
          $inc: { 'metrics.totalHires': 1 }
        })
      ]);

      // Log individual results
      results.forEach((result, index) => {
        const entity = index === 0 ? 'partner' : 'company';
        if (result.status === 'fulfilled') {
          console.log(`[LIFECYCLE] ✅ Updated metrics for ${entity}`);
        } else {
          console.error(`[LIFECYCLE] ❌ Failed to update ${entity} metrics:`, result.reason.message);
        }
      });

    } catch (error) {
      console.error(`[LIFECYCLE] ❌ Metrics update error: ${error.message}`);
      // Don't throw - metrics are non-critical
    }
  }

  /**
   * Get allowed next actions for frontend UI
   */
  getNextActions(currentStatus, userRole) {
    return StatusMachine.getNextActions('candidate', currentStatus, userRole);
  }
}

module.exports = new CandidateLifecycleService();