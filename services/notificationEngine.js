const Notification = require('../models/Notification');
const User = require('../models/User');
const emailService = require('./emailService');
const whatsappService = require('./whatsappService');
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
class NotificationEngine {

  /**
   * Send a notification
   * Creates in-app notification + optionally sends email/whatsapp
   */
  async send({
    recipientId,
    type,
    title,
    message,
    data = {},
    channels = { inApp: true },
    priority = 'medium'
  }) {
    try {
      // Don't create notification if no recipient
      if (!recipientId) {
        console.warn('[NOTIFICATION] No recipient — skipping');
        return null;
      }

      // Create in-app notification
      let notification = null;
      if (channels.inApp !== false) {
        notification = await Notification.create({
          recipient: recipientId,
          type,
          title,
          message,
          data,
          channels,
          priority
        });
      }

      // Get user for email/whatsapp
      const user = await User.findById(recipientId);
      if (!user) return notification;

      // Send email
      if (channels.email && user.email && isValidEmail(user.email)) {
        await emailService.sendEmail({
          to: user.email,
          subject: title.replace(/[🎯📋📅✅🎉✨😔🚀❌⏸️⚠️💰]/g, '').trim(),
          html: this._buildEmailTemplate(title, message, data.actionUrl)
        }).catch(err => {
          console.error('[NOTIFICATION] Email failed:', err.message);
        });
      }

      // Send WhatsApp
      if (channels.whatsapp && user.mobile) {
        await whatsappService.sendMessage(
          user.mobile,
          `${title}\n\n${message}`
        ).catch(err => {
          console.error('[NOTIFICATION] WhatsApp failed:', err.message);
        });
      }

      return notification;
    } catch (error) {
      // Notifications should NEVER break the main flow
      console.error('[NOTIFICATION] Error:', error.message);
      return null;
    }
  }

  /**
   * Get notifications for a user
   */
  async getUserNotifications(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      unreadOnly = false,
      type = null
    } = options;

    const query = { recipient: userId, dismissed: false };
    if (unreadOnly) query.read = false;
    if (type) query.type = type;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({
        recipient: userId,
        read: false,
        dismissed: false
      })
    ]);

    return {
      notifications,
      unreadCount,
      pagination: {
        current: pageNum,
        pages: Math.ceil(total / limitNum),
        total,
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1
      }
    };
  }

  /**
   * Mark single notification as read
   */
  async markAsRead(notificationId, userId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { read: true, readAt: new Date() },
      { new: true }
    );
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId) {
    const result = await Notification.updateMany(
      { recipient: userId, read: false },
      { read: true, readAt: new Date() }
    );
    return { updated: result.modifiedCount };
  }

  /**
   * Dismiss a notification (hide it)
   */
  async dismiss(notificationId, userId) {
    return Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { dismissed: true },
      { new: true }
    );
  }

  /**
   * Get unread count only
   */
  async getUnreadCount(userId) {
    return Notification.countDocuments({
      recipient: userId,
      read: false,
      dismissed: false
    });
  }

  /**
   * Email template builder
   */
  _buildEmailTemplate(title, message, actionUrl) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const fullActionUrl = actionUrl
      ? (actionUrl.startsWith('http') ? actionUrl : `${frontendUrl}${actionUrl}`)
      : null;

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 24px; border-radius: 10px 10px 0 0;">
          <h2 style="margin: 0; font-size: 18px;">${title}</h2>
        </div>
        <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb;">
          <p style="color: #374151; line-height: 1.6; margin: 0;">${message}</p>
          ${fullActionUrl ? `
            <p style="text-align: center; margin-top: 24px;">
              <a href="${fullActionUrl}"
                 style="background: #667eea; color: white; padding: 12px 24px;
                        text-decoration: none; border-radius: 6px; font-weight: bold;
                        display: inline-block;">
                View Details →
              </a>
            </p>
          ` : ''}
        </div>
        <div style="text-align: center; padding: 16px; color: #9ca3af; font-size: 12px; background: #f3f4f6; border-radius: 0 0 10px 10px;">
          © ${new Date().getFullYear()} Syncro1 Platform
        </div>
      </div>
    `;
  }
}

module.exports = new NotificationEngine();