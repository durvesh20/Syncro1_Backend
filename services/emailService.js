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
}

module.exports = new EmailService();