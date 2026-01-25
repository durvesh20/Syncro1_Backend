// backend/services/notificationService.js
const emailService = require('./emailService');

class NotificationService {
  
  // Notify partner when candidate status changes
  async notifyPartnerStatusChange(candidate, newStatus) {
    const partner = await require('../models/StaffingPartner')
      .findById(candidate.submittedBy)
      .populate('user', 'email');
    
    if (!partner?.user?.email) return;

    const statusMessages = {
      SHORTLISTED: 'has been shortlisted',
      INTERVIEW_SCHEDULED: 'has an interview scheduled',
      INTERVIEWED: 'interview has been completed',
      OFFERED: 'has received an offer',
      OFFER_ACCEPTED: 'has accepted the offer',
      JOINED: 'has joined the company',
      REJECTED: 'application was not successful'
    };

    const message = statusMessages[newStatus] || 'status has been updated';

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Candidate Status Update</h2>
        <p>Hi ${partner.firstName},</p>
        <p>Your candidate <strong>${candidate.firstName} ${candidate.lastName}</strong> ${message}.</p>
        <p><strong>Position:</strong> ${candidate.job?.title || 'N/A'}</p>
        <p><strong>New Status:</strong> ${newStatus.replace(/_/g, ' ')}</p>
        <p>Login to your dashboard to view more details.</p>
        <br>
        <p>Best regards,<br>Syncro1 Platform Team</p>
      </div>
    `;

    return emailService.sendEmail({
      to: partner.user.email,
      subject: `Candidate Update: ${candidate.firstName} ${candidate.lastName}`,
      html
    });
  }

  // Notify company of new candidate submission
  async notifyCompanyNewCandidate(candidate) {
    const company = await require('../models/Company')
      .findById(candidate.company)
      .populate('user', 'email');

    if (!company?.user?.email) return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Candidate Submission</h2>
        <p>Hi ${company.decisionMakerName},</p>
        <p>A new candidate has been submitted for your job posting.</p>
        <p><strong>Candidate:</strong> ${candidate.firstName} ${candidate.lastName}</p>
        <p><strong>Position:</strong> ${candidate.job?.title || 'N/A'}</p>
        <p>Login to your dashboard to review the candidate.</p>
        <br>
        <p>Best regards,<br>Syncro1 Platform Team</p>
      </div>
    `;

    return emailService.sendEmail({
      to: company.user.email,
      subject: `New Candidate: ${candidate.firstName} ${candidate.lastName}`,
      html
    });
  }

  // Notify partner when verified
  async notifyPartnerVerified(partner) {
    const user = await require('../models/User').findById(partner.user);
    if (!user?.email) return;

    return emailService.sendVerificationApproved(
      user.email, 
      `${partner.firstName} ${partner.lastName}`, 
      'staffing_partner'
    );
  }

  // Notify company when verified
  async notifyCompanyVerified(company) {
    const user = await require('../models/User').findById(company.user);
    if (!user?.email) return;

    return emailService.sendVerificationApproved(
      user.email, 
      company.decisionMakerName, 
      'company'
    );
  }

  // Notify partner of payout approval
  async notifyPayoutApproved(payout) {
    const partner = await require('../models/StaffingPartner')
      .findById(payout.staffingPartner)
      .populate('user', 'email');

    if (!partner?.user?.email) return;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>🎉 Payout Approved!</h2>
        <p>Hi ${partner.firstName},</p>
        <p>Great news! Your payout has been approved.</p>
        <p><strong>Amount:</strong> ₹${payout.amount.net.toLocaleString('en-IN')}</p>
        <p>The amount will be credited to your registered bank account within 3-5 business days.</p>
        <br>
        <p>Best regards,<br>Syncro1 Platform Team</p>
      </div>
    `;

    return emailService.sendEmail({
      to: partner.user.email,
      subject: 'Payout Approved - ₹' + payout.amount.net.toLocaleString('en-IN'),
      html
    });
  }
}

module.exports = new NotificationService();