// backend/services/emailService.js
const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.skipEmail = process.env.SKIP_EMAIL === 'true';
    
    if (!this.skipEmail) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }
  }

  async sendEmail(options) {
    // Log email in development
    console.log('=================================================');
    console.log('📧 Email Notification');
    console.log(`   To: ${options.to}`);
    console.log(`   Subject: ${options.subject}`);
    console.log('=================================================');

    if (this.skipEmail) {
      console.log('   [Email sending skipped - SKIP_EMAIL=true]');
      return { success: true, skipped: true };
    }

    const mailOptions = {
      from: `Syncro1 <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('   Email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('   Email error:', error.message);
      // Don't fail registration if email fails in development
      if (process.env.NODE_ENV === 'development') {
        return { success: true, error: error.message, fallback: true };
      }
      return { success: false, error: error.message };
    }
  }

  async sendOTP(email, otp, type = 'verification') {
    const subject = type === 'verification' 
      ? 'Email Verification OTP' 
      : 'Password Reset OTP';

    // Always log OTP in console for development
    console.log('=================================================');
    console.log('🔐 OTP Generated');
    console.log(`   Email: ${email}`);
    console.log(`   OTP: ${otp}`);
    console.log(`   Type: ${type}`);
    console.log(`   Valid for: 10 minutes`);
    console.log('=================================================');
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .otp-box { background: white; border: 2px dashed #667eea; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }
          .otp { font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin: 0; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 20px 0; font-size: 14px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚀 Syncro1</h1>
          </div>
          <div class="content">
            <h2>Your Verification Code</h2>
            <p>Use the following OTP to ${type === 'verification' ? 'verify your email address' : 'reset your password'}:</p>
            <div class="otp-box">
              <p class="otp">${otp}</p>
            </div>
            <div class="warning">
              ⏰ This OTP is valid for <strong>10 minutes</strong> only.
            </div>
            <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({ to: email, subject, html });
  }

  async sendTempPassword(email, tempPassword, name) {
    // Always log temp password in console for development
    console.log('=================================================');
    console.log('🔑 Temporary Password Generated');
    console.log(`   Email: ${email}`);
    console.log(`   Name: ${name}`);
    console.log(`   Temp Password: ${tempPassword}`);
    console.log('=================================================');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .password-box { background: #1f2937; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }
          .password { font-size: 24px; font-weight: bold; color: #10b981; font-family: 'Courier New', monospace; margin: 0; letter-spacing: 2px; }
          .button { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .warning { background: #fee2e2; border-left: 4px solid #ef4444; padding: 12px; margin: 20px 0; font-size: 14px; color: #991b1b; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to Syncro1!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name}!</h2>
            <p>Your account has been created successfully. Here's your temporary password to get started:</p>
            <div class="password-box">
              <p class="password">${tempPassword}</p>
            </div>
            <div class="warning">
              ⚠️ <strong>Important:</strong> You will be required to change this password immediately after your first login.
            </div>
            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/login" class="button">Login to Your Account →</a>
            </p>
            <p style="margin-top: 30px;">If the button doesn't work, copy and paste this link in your browser:</p>
            <p style="color: #667eea; word-break: break-all;">${process.env.FRONTEND_URL}/login</p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: '🎉 Welcome! Your Account is Ready',
      html
    });
  }

  async sendVerificationApproved(email, name, role) {
    const dashboardUrl = role === 'staffing_partner' 
      ? `${process.env.FRONTEND_URL}/partner/dashboard`
      : `${process.env.FRONTEND_URL}/company/dashboard`;

    console.log('=================================================');
    console.log('✅ Verification Approved Email');
    console.log(`   Email: ${email}`);
    console.log(`   Name: ${name}`);
    console.log(`   Role: ${role}`);
    console.log('=================================================');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 40px; text-align: center; border-radius: 10px 10px 0 0; }
          .header h1 { margin: 0; font-size: 28px; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; text-align: center; }
          .checkmark { font-size: 60px; margin-bottom: 20px; }
          .button { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .features { background: white; border-radius: 10px; padding: 20px; margin: 20px 0; text-align: left; }
          .features li { padding: 8px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Account Verified!</h1>
          </div>
          <div class="content">
            <div class="checkmark">✅</div>
            <h2>Congratulations ${name}!</h2>
            <p>Your account has been verified and approved. You now have full access to the platform.</p>
            <div class="features">
              <h3>What you can do now:</h3>
              <ul>
                ${role === 'staffing_partner' ? `
                  <li>✨ Browse and apply for job opportunities</li>
                  <li>📤 Submit candidate profiles</li>
                  <li>📊 Track your submissions and earnings</li>
                  <li>💰 Receive payouts for successful placements</li>
                ` : `
                  <li>✨ Post job openings</li>
                  <li>👥 Review candidate submissions</li>
                  <li>📅 Schedule interviews</li>
                  <li>📊 Track your hiring pipeline</li>
                `}
              </ul>
            </div>
            <a href="${dashboardUrl}" class="button">Go to Dashboard →</a>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: '🎉 Congratulations! Your Account is Verified',
      html
    });
  }

  async sendVerificationRejected(email, name, reason) {
    console.log('=================================================');
    console.log('❌ Verification Rejected Email');
    console.log(`   Email: ${email}`);
    console.log(`   Reason: ${reason}`);
    console.log('=================================================');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #ef4444; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .reason-box { background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; }
          .button { display: inline-block; padding: 14px 28px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Verification Update</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>We've reviewed your profile and unfortunately, we couldn't verify your account at this time.</p>
            <div class="reason-box">
              <strong>Reason:</strong><br>
              ${reason}
            </div>
            <p>Please update your profile with the correct information and resubmit for verification.</p>
            <p style="text-align: center; margin-top: 30px;">
              <a href="${process.env.FRONTEND_URL}/login" class="button">Update Profile</a>
            </p>
          </div>
          <div class="footer">
            <p>If you have questions, please contact our support team.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: 'Profile Verification Update',
      html
    });
  }

  // ==================== JOB APPROVAL EMAILS ====================

  async sendJobApproved(email, companyName, jobTitle, jobId, adminNotes) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .header h1 { margin: 0; font-size: 28px; }
          .checkmark { font-size: 60px; margin: 20px 0; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .job-title { background: white; padding: 20px; border-left: 4px solid #10b981; margin: 20px 0; border-radius: 8px; }
          .job-title h2 { margin: 0 0 10px 0; color: #10b981; }
          .info-box { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .button { display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .features { background: white; border-radius: 10px; padding: 20px; margin: 20px 0; }
          .features li { padding: 8px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="checkmark">✅</div>
            <h1>Job Posting Approved!</h1>
          </div>
          <div class="content">
            <h2>Congratulations ${companyName}!</h2>
            <p>Great news! Your job posting has been approved and is now live on our platform.</p>
            
            <div class="job-title">
              <h2>${jobTitle}</h2>
              <p style="margin: 0; color: #6b7280;">Job ID: ${jobId}</p>
            </div>

            ${adminNotes ? `
              <div class="info-box">
                <strong>📝 Admin Note:</strong><br>
                ${adminNotes}
              </div>
            ` : ''}

            <div class="features">
              <h3>What happens now?</h3>
              <ul>
                <li>✨ Your job is visible to verified talent partners</li>
                <li>📬 You'll receive candidate submissions from partners</li>
                <li>📊 Track applications and manage candidates from your dashboard</li>
                <li>🔔 You'll get real-time notifications for new submissions</li>
              </ul>
            </div>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/company/jobs/${jobId}" class="button">
                View Job Dashboard →
              </a>
            </p>

            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              💡 <strong>Tip:</strong> If you need to make changes to this job, you can request an edit from your dashboard. All edits require admin approval to maintain quality standards.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
            <p>This is an automated notification. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `✅ Job Approved: "${jobTitle}"`,
      html
    });
  }

  async sendJobRejected(email, companyName, jobTitle, reason, jobId) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f59e0b; color: white; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .job-title { background: white; padding: 20px; border-left: 4px solid #f59e0b; margin: 20px 0; border-radius: 8px; }
          .job-title h2 { margin: 0 0 10px 0; color: #d97706; }
          .reason-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .steps { background: white; border-radius: 10px; padding: 20px; margin: 20px 0; }
          .steps li { padding: 8px 0; }
          .button { display: inline-block; padding: 14px 28px; background: #f59e0b; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📋 Job Requires Revision</h1>
          </div>
          <div class="content">
            <h2>Hello ${companyName},</h2>
            <p>Thank you for submitting your job posting. Our review team has identified some areas that need attention before approval.</p>
            
            <div class="job-title">
              <h2>${jobTitle}</h2>
              <p style="margin: 0; color: #6b7280;">Job ID: ${jobId}</p>
            </div>

            <div class="reason-box">
              <strong>📝 Reason for revision request:</strong><br><br>
              ${reason}
            </div>

            <div class="steps">
              <h3>Next Steps:</h3>
              <ol>
                <li>Review the feedback above carefully</li>
                <li>Edit your job posting to address the points mentioned</li>
                <li>Resubmit the job for approval</li>
              </ol>
            </div>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/company/jobs/${jobId}/edit" class="button">
                Edit Job Posting →
              </a>
            </p>

            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              💡 <strong>Need help?</strong> If you have questions about the feedback, please contact our support team.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `📋 Revision Required: "${jobTitle}"`,
      html
    });
  }

  async sendEditRequestApproved(email, companyName, jobTitle, appliedChanges, adminNotes, jobId) {
    const changesHtml = Object.entries(appliedChanges)
      .map(([field, change]) => `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
            <strong>${field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</strong>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #ef4444;">
            ${this._formatValue(change.old)}
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; color: #10b981;">
            ${this._formatValue(change.new)}
          </td>
        </tr>
      `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .changes-table { width: 100%; background: white; border-radius: 8px; overflow: hidden; margin: 20px 0; }
          .changes-table th { background: #f3f4f6; padding: 12px; text-align: left; }
          .info-box { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .button { display: inline-block; padding: 14px 28px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div style="font-size: 60px; margin-bottom: 10px;">✅</div>
            <h1>Edit Request Approved!</h1>
          </div>
          <div class="content">
            <h2>Great news, ${companyName}!</h2>
            <p>Your edit request for "<strong>${jobTitle}</strong>" has been approved and the changes have been applied.</p>

            <h3 style="margin-top: 30px;">Applied Changes:</h3>
            <table class="changes-table" cellspacing="0" cellpadding="0">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Previous Value</th>
                  <th>New Value</th>
                </tr>
              </thead>
              <tbody>
                ${changesHtml}
              </tbody>
            </table>

            ${adminNotes ? `
              <div class="info-box">
                <strong>📝 Admin Note:</strong><br>
                ${adminNotes}
              </div>
            ` : ''}

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/company/jobs/${jobId}" class="button">
                View Updated Job →
              </a>
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `✅ Edit Approved: "${jobTitle}"`,
      html
    });
  }

  async sendEditRequestRejected(email, companyName, jobTitle, reason, rejectedCount, isWarning, jobId) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f59e0b; color: white; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .reason-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .warning-box { background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px; color: #991b1b; }
          .button { display: inline-block; padding: 14px 28px; background: #667eea; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📝 Edit Request Not Approved</h1>
          </div>
          <div class="content">
            <h2>Hello ${companyName},</h2>
            <p>Your edit request for "<strong>${jobTitle}</strong>" could not be approved at this time.</p>

            <div class="reason-box">
              <strong>📝 Reason:</strong><br><br>
              ${reason}
            </div>

            ${isWarning ? `
              <div class="warning-box">
                <strong>⚠️ Warning:</strong> This job now has <strong>${rejectedCount} rejected edit request${rejectedCount > 1 ? 's' : ''}</strong>.
                ${rejectedCount >= 5 ? '<br><br>🚨 <strong>CRITICAL:</strong> This job may be discontinued due to excessive edit requests. We recommend creating a new job posting with finalized requirements.' : '<br><br>Multiple rejected edits may result in job discontinuation. Please ensure all requirements are finalized before requesting changes.'}
              </div>
            ` : ''}

            <p>The job remains active with its current details. If you need to make changes, please review the feedback and create a new edit request with the correct information.</p>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/company/jobs/${jobId}" class="button">
                View Job Details →
              </a>
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `📝 Edit Request Update: "${jobTitle}"`,
      html
    });
  }

  async sendJobDiscontinued(email, companyName, jobTitle, reason, editStats) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #ef4444; color: white; padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { padding: 30px; background: #f9fafb; border: 1px solid #e5e7eb; }
          .critical-box { background: #fee2e2; border-left: 4px solid #ef4444; padding: 20px; margin: 20px 0; border-radius: 4px; color: #991b1b; }
          .stats { background: white; border-radius: 8px; padding: 20px; margin: 20px 0; }
          .stats-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
          .next-steps { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .button { display: inline-block; padding: 14px 28px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div style="font-size: 60px; margin-bottom: 10px;">🚫</div>
            <h1>Job Posting Discontinued</h1>
          </div>
          <div class="content">
            <h2>Important Notice for ${companyName}</h2>
            
            <div class="critical-box">
              <h3 style="margin-top: 0;">Your job posting "<strong>${jobTitle}</strong>" has been discontinued.</h3>
              <p style="margin-bottom: 0;"><strong>Reason:</strong> ${reason}</p>
            </div>

            <div class="stats">
              <h3 style="margin-top: 0;">Edit Request History:</h3>
              <div class="stats-row">
                <span>Total edit requests:</span>
                <strong>${editStats.total}</strong>
              </div>
              <div class="stats-row">
                <span>Approved edits:</span>
                <strong style="color: #10b981;">${editStats.approved}</strong>
              </div>
              <div class="stats-row">
                <span>Rejected edits:</span>
                <strong style="color: #ef4444;">${editStats.rejected}</strong>
              </div>
              <div class="stats-row">
                <span>Rejection rate:</span>
                <strong>${editStats.rejectionRate}%</strong>
              </div>
            </div>

            <div class="next-steps">
              <h3 style="margin-top: 0;">📝 Next Steps:</h3>
              <ol style="margin-bottom: 0;">
                <li>Review your job requirements and finalize all details</li>
                <li>Create a new job posting with clear, accurate information</li>
                <li>Ensure all requirements are complete before submitting</li>
              </ol>
            </div>

            <p><strong>Important:</strong> The discontinued job is no longer visible to talent partners. Any active candidates for this job have been notified.</p>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/company/jobs/create" class="button">
                Create New Job Posting →
              </a>
            </p>

            <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
              💡 <strong>Tip:</strong> To avoid discontinuation in the future, please ensure all job details are finalized and accurate before submission. Multiple edit requests may indicate unclear requirements.
            </p>
          </div>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Syncro1. All rights reserved.</p>
            <p>If you have questions, please contact our support team.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: email,
      subject: `🚫 Job Discontinued: "${jobTitle}"`,
      html
    });
  }

  // Helper method to format values in change tables
  _formatValue(value) {
    if (value === null || value === undefined) return '<em>Not set</em>';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }
}

module.exports = new EmailService();