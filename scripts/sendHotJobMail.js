// backend/scripts/sendHotJobMail.js
const mongoose = require('mongoose');
const path = require('path');

// Resolve and load the environment file based on argument
const envFile = process.argv[2] === "production" ? "../.env.production" : "../.env.development";
require("dotenv").config({ path: path.resolve(__dirname, envFile) });

const User = require('../models/User');
const Company = require('../models/Company'); // Required to register Company schema in Mongoose for population
const Job = require('../models/Job');
const EmailLog = require('../models/EmailLog');
const emailService = require('../services/emailService');

(async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected successfully!");

    // Get current date in Asia/Kolkata timezone formatted as YYYY-MM-DD
    const today = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = formatter.format(today);
    console.log(`Executing daily hot job email scheduler for: ${todayStr} (Asia/Kolkata)`);

    // 1. Fetch all active hot jobs
    const hotJobs = await Job.find({
      status: 'ACTIVE',
      isFeatured: true
    }).populate('company');

    if (hotJobs.length === 0) {
      console.log("ℹ️ No active hot jobs found today. Exiting.");
      process.exit(0);
    }
    console.log(`🔥 Found ${hotJobs.length} active hot jobs.`);

    // 2. Fetch all verified staffing (talent) partners
    const partners = await User.find({
      role: 'staffing_partner',
      status: 'VERIFIED'
    });

    if (partners.length === 0) {
      console.log("ℹ️ No verified talent partners found. Exiting.");
      process.exit(0);
    }
    console.log(`👥 Found ${partners.length} verified talent partners to process.`);

    let emailsSent = 0;
    let errorsCount = 0;

    // Helper functions for email template
    const formatSalary = (salary) => {
      if (!salary || salary.isConfidential) return 'Confidential';
      const minStr = salary.min ? salary.min.toLocaleString('en-IN') : null;
      const maxStr = salary.max ? salary.max.toLocaleString('en-IN') : null;
      if (minStr && maxStr) return `₹${minStr} - ₹${maxStr}`;
      if (minStr) return `Min ₹${minStr}`;
      if (maxStr) return `Max ₹${maxStr}`;
      return 'Not specified';
    };

    const formatLocation = (location) => {
      if (!location) return 'Not specified';
      let locParts = [];
      if (location.city && location.city.length > 0) {
        locParts.push(location.city.join(', '));
      }
      if (location.state && location.state !== 'N/A') {
        locParts.push(location.state);
      }
      let mode = [];
      if (location.isRemote) mode.push('Remote');
      if (location.isHybrid) mode.push('Hybrid');
      if (location.isOnSite) mode.push('On-site');
      
      let modeStr = mode.length > 0 ? ` (${mode.join('/')})` : '';
      return `${locParts.join(', ')}${modeStr}`.trim();
    };

    const formatCommission = (commission) => {
      if (!commission || !commission.value) return 'Standard Commission';
      if (commission.type === 'percentage') {
        return `${commission.value}% of CTC`;
      }
      return `₹${commission.value.toLocaleString('en-IN')} fixed`;
    };

    // 3. Process emails for each partner
    for (const partner of partners) {
      try {
        // Find jobs already sent to this partner today
        const sentLogs = await EmailLog.find({
          user: partner._id,
          date: todayStr,
          status: 'SUCCESS'
        });
        const sentJobIds = sentLogs.map(log => log.job.toString());

        // Filter out jobs already sent to this partner today
        const unsentJobs = hotJobs.filter(job => !sentJobIds.includes(job._id.toString()));

        if (unsentJobs.length === 0) {
          console.log(`   - Skipping ${partner.email}: No new hot jobs to notify.`);
          continue;
        }

        console.log(`   - Sending ${unsentJobs.length} hot jobs to ${partner.email}...`);

        // Generate job cards HTML
        const jobCardsHtml = unsentJobs.map(job => {
          const compName = job.company ? job.company.companyName : 'Featured Company';
          const industry = job.company && job.company.kyc ? job.company.kyc.industry : 'N/A';
          const jobUrl = `${process.env.FRONTEND_URL || 'https://www.syncro1.com'}/partner/jobs/${job._id}`;

          return `
            <div class="job-card" style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
              <h2 class="job-title" style="font-size: 18px; color: #0f172a; margin: 0 0 4px 0; font-weight: 600;">${job.title}</h2>
              <div class="job-meta" style="font-size: 13px; color: #64748b; margin-bottom: 12px;">
                <span class="meta-item" style="display: inline-block; margin-right: 15px;">🏢 <strong>${compName}</strong></span>
                <span class="meta-item" style="display: inline-block; margin-right: 15px;">💼 ${industry}</span>
              </div>
              <div class="job-details" style="background: #f8fafc; border-radius: 6px; padding: 12px; font-size: 14px; margin-bottom: 15px;">
                <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span class="detail-label" style="color: #64748b;">📍 Location:</span>
                  <span class="detail-value" style="font-weight: 600; color: #334155;">${formatLocation(job.location)}</span>
                </div>
                <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span class="detail-label" style="color: #64748b;">💰 Salary Range:</span>
                  <span class="detail-value" style="font-weight: 600; color: #334155;">${formatSalary(job.salary)}</span>
                </div>
                <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                  <span class="detail-label" style="color: #64748b;">⏳ Experience:</span>
                  <span class="detail-value" style="font-weight: 600; color: #334155;">${job.experienceRange.min} - ${job.experienceRange.max} Years</span>
                </div>
                <div class="detail-row" style="display: flex; justify-content: space-between; margin-bottom: 0;">
                  <span class="detail-label" style="color: #64748b;">🔥 Payout Commission:</span>
                  <span class="detail-value" style="font-weight: 700; color: #e11d48;">${formatCommission(job.commission)}</span>
                </div>
              </div>
              <a href="${jobUrl}" class="btn" style="display: inline-block; width: 100%; text-align: center; padding: 10px 0; background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%); color: white !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">View Job & Submit Candidates</a>
            </div>
          `;
        }).join('');

        const name = [partner.firstName, partner.lastName].filter(Boolean).join(' ') || partner.email;
        const currentYear = new Date().getFullYear();

        const html = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Hot Job Alerts</title>
          </head>
          <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 0;">
            <div class="container" style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div class="header" style="background: linear-gradient(135deg, #f43f5e 0%, #fb7185 100%); color: white; padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">🔥 Hot Job Openings</h1>
                <p style="margin: 5px 0 0; font-size: 14px; opacity: 0.9;">Exclusive high-commission opportunities for Syncro1 Partners</p>
              </div>
              <div class="content" style="background-color: white; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
                <p>Hello ${name},</p>
                <p>Here are today's featured hot jobs currently active on the Syncro1 platform. Submit your matching candidates now to secure high commissions!</p>
                
                ${jobCardsHtml}
                
                <p style="margin-top: 30px; font-size: 13px; color: #64748b;">
                  Happy sourcing,<br>
                  <strong>Team Syncro1</strong>
                </p>
              </div>
              <div class="footer" style="text-align: center; margin-top: 20px; font-size: 12px; color: #94a3b8;">
                <p>You are receiving this daily digest because you are a verified Syncro1 Talent Partner.</p>
                <p>© ${currentYear} Syncro1. All rights reserved.</p>
              </div>
            </div>
          </body>
          </html>
        `;

        const mailResult = await emailService.sendEmail({
          to: partner.email,
          subject: `🔥 [Hot Jobs] New high-commission openings matching your sector - ${todayStr}`,
          html
        });

        // 4. Log the send results to database
        if (mailResult && mailResult.success) {
          const logsToCreate = unsentJobs.map(job => ({
            user: partner._id,
            job: job._id,
            date: todayStr,
            status: 'SUCCESS'
          }));
          await EmailLog.insertMany(logsToCreate);
          emailsSent++;
        } else {
          const logsToCreate = unsentJobs.map(job => ({
            user: partner._id,
            job: job._id,
            date: todayStr,
            status: 'FAILED',
            error: mailResult ? mailResult.error : 'Unknown dispatch error'
          }));
          await EmailLog.insertMany(logsToCreate);
          errorsCount++;
          console.error(`❌ Failed to send email to ${partner.email}: ${mailResult ? mailResult.error : 'Unknown'}`);
        }
      } catch (userErr) {
        // Robustness: Log and continue if one user fails
        errorsCount++;
        console.error(`❌ Error processing partner ${partner.email}:`, userErr.message);
      }
    }

    console.log(`\nDaily job digest execution finished.`);
    console.log(`✅ Successfully processed: ${emailsSent} partners.`);
    console.log(`⚠️ Failed/Error count: ${errorsCount} partners.`);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Scheduler script crashed:", error);
    process.exit(1);
  }
})();
