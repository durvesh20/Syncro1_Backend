// backend/routes/notificationRoutes.js — NEW FILE

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const notificationEngine = require('../services/notificationEngine');

router.use(protect);

// Get my notifications
router.get('/', async (req, res) => {
  try {
    const { page, limit, unreadOnly, type } = req.query;

    const result = await notificationEngine.getUserNotifications(
      req.user._id,
      {
        page,
        limit,
        unreadOnly: unreadOnly === 'true',
        type
      }
    );

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

// Get unread count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await notificationEngine.getUnreadCount(req.user._id);
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch unread count',
      error: error.message
    });
  }
});

// Mark one as read
router.put('/:id/read', async (req, res) => {
  try {
    const notification = await notificationEngine.markAsRead(
      req.params.id,
      req.user._id
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({ success: true, data: notification });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark as read',
      error: error.message
    });
  }
});

// Mark all as read
router.put('/read-all', async (req, res) => {
  try {
    const result = await notificationEngine.markAllAsRead(req.user._id);
    res.json({
      success: true,
      message: `${result.updated} notifications marked as read`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark all as read',
      error: error.message
    });
  }
});

// Dismiss notification
router.put('/:id/dismiss', async (req, res) => {
  try {
    const notification = await notificationEngine.dismiss(
      req.params.id,
      req.user._id
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification dismissed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to dismiss notification',
      error: error.message
    });
  }
});

module.exports = router;