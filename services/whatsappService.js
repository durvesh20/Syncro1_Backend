// backend/services/whatsappService.js

class WhatsAppService {
  constructor() {
    this.enabled = process.env.WHATSAPP_ENABLED === 'true';
  }

  async sendOTP(phoneNumber, otp) {
    // WhatsApp is disabled - just log and return success
    if (!this.enabled) {
      console.log('=================================================');
      console.log('📱 WhatsApp OTP (Mock - WhatsApp Disabled)');
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   OTP: ${otp}`);
      console.log('=================================================');
      
      return { 
        success: true, 
        messageId: 'mock_' + Date.now(),
        mock: true 
      };
    }

    // If enabled in future, add Twilio code here
    // const twilio = require('twilio');
    // ... actual implementation
    
    return { success: true };
  }

  async sendMessage(phoneNumber, message) {
    if (!this.enabled) {
      console.log('=================================================');
      console.log('📱 WhatsApp Message (Mock)');
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   Message: ${message}`);
      console.log('=================================================');
      
      return { success: true, mock: true };
    }

    return { success: true };
  }

  formatPhoneNumber(phoneNumber) {
    let cleaned = phoneNumber.replace(/\D/g, '');
    if (!cleaned.startsWith('91') && cleaned.length === 10) {
      cleaned = '91' + cleaned;
    }
    return '+' + cleaned;
  }
}

module.exports = new WhatsAppService();