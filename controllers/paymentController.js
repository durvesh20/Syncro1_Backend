// backend/controllers/paymentController.js
const { Subscription } = require('../models/Subscription');
const StaffingPartner = require('../models/StaffingPartner');
const paymentService = require('../services/paymentService');

const paymentEnabled = process.env.PAYMENT_ENABLED === 'true';

// @desc    Get Subscription Plans
// @route   GET /api/payments/plans
exports.getPlans = async (req, res) => {
  try {
    const plans = paymentService.getSubscriptionPlans();
    res.json({
      success: true,
      data: {
        plans,
        paymentEnabled,
        message: paymentEnabled ? null : 'Payment is disabled. Plans can be activated without payment in development mode.'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plans',
      error: error.message
    });
  }
};

// @desc    Create Payment Order
// @route   POST /api/payments/create-order
exports.createOrder = async (req, res) => {
  try {
    const { plan } = req.body;
    const plans = paymentService.getSubscriptionPlans();

    if (!plans[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const planDetails = plans[plan];
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    // Free plan - activate immediately
    if (plan === 'FREE' || planDetails.total === 0) {
      partner.subscription = {
        plan: 'FREE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        isActive: true
      };
      await partner.save();

      return res.json({
        success: true,
        message: 'Free plan activated successfully',
        data: { 
          plan: 'FREE',
          subscription: partner.subscription 
        }
      });
    }

    // If payment is disabled, allow mock activation
    if (!paymentEnabled) {
      console.log('=================================================');
      console.log('💳 MOCK PAYMENT - Payment Disabled');
      console.log(`   Plan: ${plan}`);
      console.log(`   Amount: ₹${planDetails.total}`);
      console.log(`   User: ${req.user.email}`);
      console.log('=================================================');

      return res.json({
        success: true,
        message: 'Payment is disabled in development. Use /api/payments/mock-activate to activate plan.',
        data: {
          plan,
          amount: planDetails.total,
          paymentEnabled: false,
          mockActivationUrl: '/api/payments/mock-activate'
        }
      });
    }

    // Real payment flow (when enabled)
    const receipt = `sub_${req.user._id}_${Date.now()}`;
    const result = await paymentService.createOrder(planDetails.total, 'INR', receipt, {
      userId: req.user._id.toString(),
      plan
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create order',
        error: result.error
      });
    }

    res.json({
      success: true,
      data: {
        orderId: result.order.id,
        amount: result.order.amount,
        currency: result.order.currency,
        plan: planDetails,
        keyId: process.env.RAZORPAY_KEY_ID
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Order creation failed',
      error: error.message
    });
  }
};

// @desc    Mock Activate Plan (Development Only)
// @route   POST /api/payments/mock-activate
exports.mockActivatePlan = async (req, res) => {
  try {
    // Only allow in development or when payment is disabled
    if (paymentEnabled && process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        message: 'Mock activation not allowed in production with payment enabled'
      });
    }

    const { plan } = req.body;
    const plans = paymentService.getSubscriptionPlans();

    if (!plans[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const planDetails = plans[plan];
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Staffing partner profile not found'
      });
    }

    const startDate = new Date();
    const endDate = new Date(Date.now() + planDetails.duration * 24 * 60 * 60 * 1000);

    // Create subscription record
    const subscription = await Subscription.create({
      user: req.user._id,
      staffingPartner: partner._id,
      plan,
      startDate,
      endDate,
      status: 'ACTIVE',
      payment: {
        orderId: 'mock_order_' + Date.now(),
        paymentId: 'mock_payment_' + Date.now(),
        amount: planDetails.total,
        currency: 'INR',
        method: 'mock',
        status: 'COMPLETED',
        paidAt: new Date()
      }
    });

    // Update partner subscription
    partner.subscription = {
      plan,
      startDate,
      endDate,
      isActive: true
    };
    await partner.save();

    console.log('=================================================');
    console.log('✅ MOCK PLAN ACTIVATED');
    console.log(`   Plan: ${plan}`);
    console.log(`   Partner: ${partner.firstName} ${partner.lastName}`);
    console.log(`   Valid until: ${endDate.toDateString()}`);
    console.log('=================================================');

    res.json({
      success: true,
      message: `${planDetails.name} plan activated successfully (Mock)`,
      data: {
        subscription,
        partner: {
          id: partner._id,
          subscription: partner.subscription
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Mock activation failed',
      error: error.message
    });
  }
};

// @desc    Verify Payment
// @route   POST /api/payments/verify
exports.verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature, plan } = req.body;

    if (!paymentEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Payment is disabled. Use mock activation instead.'
      });
    }

    // Verify signature
    const isValid = paymentService.verifyPayment(orderId, paymentId, signature);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed - Invalid signature'
      });
    }

    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const plans = paymentService.getSubscriptionPlans();
    const planDetails = plans[plan];

    const startDate = new Date();
    const endDate = new Date(Date.now() + planDetails.duration * 24 * 60 * 60 * 1000);

    // Create subscription
    const subscription = await Subscription.create({
      user: req.user._id,
      staffingPartner: partner._id,
      plan,
      startDate,
      endDate,
      status: 'ACTIVE',
      payment: {
        orderId,
        paymentId,
        amount: planDetails.total,
        currency: 'INR',
        status: 'COMPLETED',
        paidAt: new Date()
      }
    });

    // Update partner subscription
    partner.subscription = {
      plan,
      startDate,
      endDate,
      isActive: true
    };
    await partner.save();

    res.json({
      success: true,
      message: 'Payment verified and subscription activated',
      data: subscription
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: error.message
    });
  }
};

// @desc    Get Subscription History
// @route   GET /api/payments/subscriptions
exports.getSubscriptions = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Staffing partner profile not found'
      });
    }

    const subscriptions = await Subscription.find({ staffingPartner: partner._id })
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: {
        current: partner.subscription,
        history: subscriptions,
        paymentEnabled
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscriptions',
      error: error.message
    });
  }
};

// @desc    Get Current Subscription
// @route   GET /api/payments/current
exports.getCurrentSubscription = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    
    if (!partner) {
      return res.status(404).json({
        success: false,
        message: 'Staffing partner profile not found'
      });
    }

    const plans = paymentService.getSubscriptionPlans();
    const currentPlan = partner.subscription?.plan || 'FREE';
    const planDetails = plans[currentPlan];

    res.json({
      success: true,
      data: {
        subscription: partner.subscription,
        planDetails,
        isActive: partner.subscription?.isActive || false,
        daysRemaining: partner.subscription?.endDate 
          ? Math.max(0, Math.ceil((new Date(partner.subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
          : 0
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription',
      error: error.message
    });
  }
};