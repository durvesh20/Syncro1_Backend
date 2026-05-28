// backend/services/paymentService.js
const SubscriptionPlan = require('../models/SubscriptionPlan');

class PaymentService {
  constructor() {
    this.enabled = process.env.PAYMENT_ENABLED === 'true';
    if (this.enabled) {
      try {
        const Razorpay = require('razorpay');
        this.razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID,
          key_secret: process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET
        });
      } catch (err) {
        console.error('\n❌ Razorpay SDK Error:', err.message);
        console.error('👉 Please run: npm install razorpay\n');
        this.enabled = false;
      }
    }
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

    // Real Razorpay Flow
    try {
      const order = await this.razorpay.orders.create({
        amount: Math.round(amount * 100), // convert to paise and ensure it's integer
        currency,
        receipt,
        notes: {
          ...notes,
          timestamp: Date.now()
        }
      });

      return { success: true, order };
    } catch (error) {
      console.error('Razorpay Order Creation Error:', error);
      return { success: false, error: error.message };
    }
  }

  async verifyPayment(orderId, paymentId, signature) {
    // In mock mode, always return true for testing
    if (!this.enabled) {
      console.log('=================================================');
      console.log('✅ Payment Verification (Mock - Auto Approved)');
      console.log(`   Order ID: ${orderId}`);
      console.log(`   Payment ID: ${paymentId}`);
      console.log('=================================================');
      return true;
    }

    try {
      const crypto = require('crypto');
      const secret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET;
      
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      if (expected !== signature) {
        console.error('❌ Razorpay Signature Mismatch');
        return false;
      }

      return true;
    } catch (error) {
      console.error('Razorpay Verification Error:', error);
      return false;
    }
  }

  async getPaymentDetails(paymentId) {
    if (!this.enabled) {
      return {
        success: true,
        payment: { id: paymentId, amount: 0, currency: 'INR', status: 'captured', method: 'mock' },
        mock: true
      };
    }

    try {
      const payment = await this.razorpay.payments.fetch(paymentId);
      return { success: true, payment };
    } catch (error) {
      console.error('Razorpay Payment Fetch Error:', error);
      return { success: false, error: error.message };
    }
  }

  async refundPayment(paymentId, amount) {
    if (!this.enabled) {
      console.log(`Mock Refund: ${paymentId} - ₹${amount}`);
      return { success: true, mock: true };
    }

    try {
      const refund = await this.razorpay.payments.refund(paymentId, {
        amount: Math.round(amount * 100)
      });
      return { success: true, refund };
    } catch (error) {
      console.error('Razorpay Refund Error:', error);
      return { success: false, error: error.message };
    }
  }

  // Subscription plan prices - now from database
  async getSubscriptionPlans() {
    try {
      const plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });
      
      // Transform into the structure expected by the controller
      const planMap = {};
      plans.forEach(plan => {
        // If it's a base plan (Free), add it directly
        if (plan.planKey === 'FREE') {
          planMap.FREE = plan;
        } else {
          // Group by base plan name (e.g., GROWTH_MONTHLY -> GROWTH)
          const baseKey = plan.planKey.split('_')[0];
          if (!planMap[baseKey]) {
            planMap[baseKey] = {
              name: plan.name,
              subHeading: plan.subHeading,
              ctcRange: plan.ctcRange,
              features: plan.features,
              monthly: null,
              '3month': null,
              '6month': null,
              yearly: null
            };
          }
          
          if (plan.billingCycle === 'monthly') planMap[baseKey].monthly = plan;
          if (plan.billingCycle === '3month') planMap[baseKey]['3month'] = plan;
          if (plan.billingCycle === '6month') planMap[baseKey]['6month'] = plan;
          if (plan.billingCycle === 'yearly') planMap[baseKey].yearly = plan;
        }
      });
      
      return planMap;
    } catch (error) {
      console.error('Failed to fetch plans from DB:', error);
      return null;
    }
  }
}

module.exports = new PaymentService();