// backend/services/whatsappService.js
const axios = require('axios');

class WhatsAppService {
  constructor() {
    this.enabled = process.env.WHATSAPP_ENABLED === 'true';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';
    this.apiVersion = process.env.META_API_VERSION || 'v19.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  /**
   * Format phone number to international format
   * Meta requires: 919876543210 (country code + number, no + sign)
   */
  _formatPhone(phoneNumber) {
    if (!phoneNumber) return '';
    let cleaned = String(phoneNumber).replace(/\D/g, '');
    if (cleaned.length === 10) {
      cleaned = '91' + cleaned;
    }
    return cleaned;
  }

  /**
   * Core method: Send any template message
   */
  async sendTemplate(phoneNumber, templateName, bodyParameters = [], buttonParameters = null) {
    const formattedPhone = this._formatPhone(phoneNumber);

    if (!this.enabled) {
      console.log('═══════════════════════════════════════');
      console.log('📱 WhatsApp Template (MOCK - Disabled)');
      console.log(`   Phone:    +${formattedPhone}`);
      console.log(`   Template: ${templateName}`);
      console.log(`   Params:   ${JSON.stringify(bodyParameters)}`);
      console.log('═══════════════════════════════════════');
      return { success: true, mock: true };
    }

    try {
      const components = [];

      // Body parameters
      if (bodyParameters && bodyParameters.length > 0) {
        components.push({
          type: 'body',
          parameters: bodyParameters.map(param => ({
            type: 'text',
            text: String(param)
          }))
        });
      }

      // Button parameters (for OTP copy code button)
      if (buttonParameters) {
        components.push({
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [
            {
              type: 'text',
              text: String(buttonParameters)
            }
          ]
        });
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: 'en_US'
          },
          components
        }
      };

      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const messageId = response.data?.messages?.[0]?.id;
      console.log(`[WHATSAPP] ✅ Sent: ${templateName} → +${formattedPhone} | ID: ${messageId}`);

      return {
        success: true,
        messageId,
        waId: response.data?.contacts?.[0]?.wa_id,
        data: response.data
      };
    } catch (error) {
      const errMsg = error.response?.data?.error?.message
        || error.response?.data?.message
        || error.message;

      const errCode = error.response?.data?.error?.code;

      console.error(`[WHATSAPP] ❌ Failed: ${templateName} → +${formattedPhone}`);
      console.error(`[WHATSAPP] Error Code: ${errCode} | Message: ${errMsg}`);

      return {
        success: false,
        error: errMsg,
        errorCode: errCode
      };
    }
  }

  /**
   * Send OTP via Authentication template
   *
   * Uses Meta's authentication template format
   * OTP must be sent in BOTH body parameters AND button parameters
   *
   * Template type: AUTHENTICATION (copy code button)
   * Template name: whatever Parag named it on Meta/WAPI
   */
  async sendOTP(phoneNumber, otp) {
    const otpStr = String(otp);

    console.log('═══════════════════════════════════════');
    console.log('🔐 WhatsApp OTP');
    console.log(`   Phone: +${this._formatPhone(phoneNumber)}`);
    console.log(`   OTP:   ${otpStr}`);
    console.log('═══════════════════════════════════════');

    // Authentication template format:
    // body parameter = OTP
    // button parameter = OTP (same value, required for copy code button)
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_OTP || 'syncro1_otp',
      [otpStr],      // body params
      otpStr         // button param (for copy code button)
    );
  }

  /**
   * Send profile verified notification
   * Params: [name]
   */
  async sendProfileVerified(phoneNumber, name) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_PROFILE_VERIFIED || 'syncro1_profile_verified',
      [name]
    );
  }

  /**
   * Send profile rejected notification
   * Params: [name, reason]
   */
  async sendProfileRejected(phoneNumber, name, reason) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_PROFILE_REJECTED || 'syncro1_profile_rejected',
      [name, reason]
    );
  }

  /**
   * Send new candidate notification to company
   * Params: [companyName, candidateName, jobTitle, partnerFirmName]
   */
  async sendNewCandidateNotification(phoneNumber, companyName, candidateName, jobTitle, partnerFirmName) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_NEW_CANDIDATE || 'syncro1_new_candidate',
      [companyName, candidateName, jobTitle, partnerFirmName]
    );
  }

  /**
   * Send candidate status update to partner
   * Params: [partnerName, candidateName, jobTitle, newStatus]
   */
  async sendCandidateStatusUpdate(phoneNumber, partnerName, candidateName, jobTitle, newStatus) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_CANDIDATE_STATUS || 'syncro1_candidate_status',
      [partnerName, candidateName, jobTitle, newStatus]
    );
  }

  /**
   * Send payout approved notification
   * Params: [partnerName, amount, candidateName, companyName]
   */
  async sendPayoutApproved(phoneNumber, partnerName, amount, candidateName, companyName) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_PAYOUT_APPROVED || 'syncro1_payout_approved',
      [
        partnerName,
        `Rs. ${Number(amount).toLocaleString('en-IN')}`,
        candidateName,
        companyName
      ]
    );
  }

  /**
   * Send payment credited notification
   * Params: [partnerName, amount, transactionId, candidateName]
   */
  async sendPaymentCredited(phoneNumber, partnerName, amount, transactionId, candidateName) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_PAYMENT_CREDITED || 'syncro1_payment_credited',
      [
        partnerName,
        `Rs. ${Number(amount).toLocaleString('en-IN')}`,
        transactionId,
        candidateName
      ]
    );
  }

  /**
   * Send agreement query response notification
   * Params: [partnerName, clauseReference]
   */
  async sendQueryResponse(phoneNumber, partnerName, clauseReference) {
    return this.sendTemplate(
      phoneNumber,
      process.env.WHATSAPP_TEMPLATE_QUERY_RESPONSE || 'syncro1_query_response',
      [partnerName, clauseReference]
    );
  }

  /**
   * Send plain text message (only works within 24h window)
   */
  async sendMessage(phoneNumber, message) {
    const formattedPhone = this._formatPhone(phoneNumber);

    if (!this.enabled) {
      console.log(`[WHATSAPP MOCK] Message → +${formattedPhone}: ${message}`);
      return { success: true, mock: true };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/${this.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'text',
          text: { body: message }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log(`[WHATSAPP] ✅ Message sent → +${formattedPhone}`);
      return {
        success: true,
        messageId: response.data?.messages?.[0]?.id,
        data: response.data
      };
    } catch (error) {
      const errMsg = error.response?.data?.error?.message || error.message;
      console.error(`[WHATSAPP] ❌ Message failed → +${formattedPhone}: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Create a template on Meta via API
   * Use this to create templates programmatically
   */
  async createTemplate(templateData) {
    if (!this.businessAccountId) {
      return {
        success: false,
        error: 'WHATSAPP_BUSINESS_ACCOUNT_ID not configured'
      };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/${this.businessAccountId}/message_templates`,
        templateData,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log(`[WHATSAPP] ✅ Template created: ${templateData.name} | Status: ${response.data.status}`);
      return {
        success: true,
        templateId: response.data.id,
        status: response.data.status,
        data: response.data
      };
    } catch (error) {
      const errMsg = error.response?.data?.error?.message || error.message;
      console.error(`[WHATSAPP] ❌ Template creation failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }

  /**
   * Test connection by checking phone number details
   */
  async testConnection() {
    if (!this.enabled) {
      console.log('[WHATSAPP] Service disabled — mock mode');
      return { success: true, mock: true };
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/${this.phoneNumberId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          },
          timeout: 10000
        }
      );

      console.log('[WHATSAPP] ✅ Connection verified');
      console.log(`[WHATSAPP] Phone: ${response.data.display_phone_number}`);
      console.log(`[WHATSAPP] Name: ${response.data.verified_name}`);

      return {
        success: true,
        phone: response.data.display_phone_number,
        name: response.data.verified_name,
        data: response.data
      };
    } catch (error) {
      const errMsg = error.response?.data?.error?.message || error.message;
      console.error(`[WHATSAPP] ❌ Connection failed: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  }
}

module.exports = new WhatsAppService();