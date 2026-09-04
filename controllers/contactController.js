const ContactMessage = require('../models/ContactMessage');

/**
 * @desc    Submit a contact form message
 * @route   POST /api/contact
 * @access  Public
 */
exports.submitContactMessage = async (req, res) => {
  try {
    const { name, email, phone, company, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, subject, and message'
      });
    }

    const contactMessage = await ContactMessage.create({
      name,
      email,
      phone: phone || '',
      company: company || '',
      subject,
      message
    });

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been sent successfully.',
      data: contactMessage
    });
  } catch (error) {
    console.error('Error in submitContactMessage:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting contact message',
      error: error.message
    });
  }
};

/**
 * @desc    Get all contact messages
 * @route   GET /api/contact
 * @access  Private (Admin / Sub-Admin)
 */
exports.getContactMessages = async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: messages.length,
      data: messages
    });
  } catch (error) {
    console.error('Error fetching contact messages:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching messages',
      error: error.message
    });
  }
};

/**
 * @desc    Update contact message status
 * @route   PATCH /api/contact/:id/status
 * @access  Private (Admin / Sub-Admin)
 */
exports.updateMessageStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const message = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Contact message not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('Error updating contact message status:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating status',
      error: error.message
    });
  }
};

