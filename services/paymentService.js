// backend/services/paymentService.js

class PaymentService {
  constructor() {
    this.enabled = process.env.PAYMENT_ENABLED === 'true';
  }

  async createOrder(amount, currency = 'INR', receipt, notes = {}) {
    // Payment is disabled - return mock order
    if (!this.enabled) {
      console.log('=================================================');
      console.log('💳 Payment Order (Mock - Razorpay Disabled)');
      console.log(`   Amount: ₹${amount}`);
      console.log(`   Receipt: ${receipt}`);
      console.log('=================================================');

      const mockOrder = {
        id: 'order_mock_' + Date.now(),
        amount: amount * 100,
        currency,
        receipt,
        status: 'created',
        notes
      };

      return { success: true, order: mockOrder, mock: true };
    }

    // If enabled in future, add Razorpay code here
    // const Razorpay = require('razorpay');
    // ... actual implementation

    return { success: true };
  }

  verifyPayment(orderId, paymentId, signature) {
    // In mock mode, always return true for testing
    if (!this.enabled) {
      console.log('=================================================');
      console.log('✅ Payment Verification (Mock - Auto Approved)');
      console.log(`   Order ID: ${orderId}`);
      console.log(`   Payment ID: ${paymentId}`);
      console.log('=================================================');
      return true;
    }

    // If enabled, verify with Razorpay
    // const crypto = require('crypto');
    // ... actual verification

    return true;
  }

  async getPaymentDetails(paymentId) {
    if (!this.enabled) {
      return {
        success: true,
        payment: {
          id: paymentId,
          amount: 0,
          currency: 'INR',
          status: 'captured',
          method: 'mock'
        },
        mock: true
      };
    }

    return { success: true };
  }

  async refundPayment(paymentId, amount) {
    if (!this.enabled) {
      console.log(`Mock Refund: ${paymentId} - ₹${amount}`);
      return { success: true, mock: true };
    }

    return { success: true };
  }

  // Subscription plan prices
  getSubscriptionPlans() {
    return {
      FREE: {
        name: 'Free',
        price: 0,
        gst: 0,
        total: 0,
        duration: 365, // days
        features: [
          'Entry-level jobs',
          'Basic database access',
          'Standard commission',
          'Email support',
          'Basic analytics'
        ]
      },
      GROWTH: {
        name: 'Growth',
        price: 4999,
        gst: 899.82,
        total: 5898.82,
        duration: 30,
        features: [
          'Mid-level jobs',
          'Advanced database access',
          'Priority notifications',
          'Account manager',
          'Performance bonuses'
        ]
      },
      PROFESSIONAL: {
        name: 'Professional',
        price: 7999,
        gst: 1439.82,
        total: 9438.82,
        duration: 30,
        features: [
          'Senior-level jobs',
          'Premium commission',
          'Exclusive client access',
          'Custom strategies',
          'VIP support',
          'Quarterly reviews',
          'Revenue share'
        ]
      },
      PREMIUM: {
        name: 'Premium',
        price: 11999,
        gst: 2159.82,
        total: 14158.82,
        duration: 30,
        features: [
          'Executive & C-suite jobs',
          'Highest commission',
          'Priority exclusive access',
          'White-glove support',
          'Monthly reviews',
          'Revenue share + bonuses'
        ]
      }
    };
  }
}

module.exports = new PaymentService();