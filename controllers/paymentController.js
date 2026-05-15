// backend/controllers/paymentController.js
const { Subscription } = require('../models/Subscription');
const StaffingPartner = require('../models/StaffingPartner');
const paymentService = require('../services/paymentService');

const paymentEnabled = paymentService.enabled;

// @desc    Get Subscription Plans
// @route   GET /api/payments/plans
exports.getPlans = async (req, res) => {
  try {
    const plans = await paymentService.getSubscriptionPlans();
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
    const { plan, billingCycle = 'monthly' } = req.body;
    const plans = await paymentService.getSubscriptionPlans();

    if (!plans[plan]) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    const planData = plans[plan];
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    // Extract correct pricing based on billing cycle
    let amount, duration;
    if (plan === 'FREE') {
      amount = planData.price || 0;
      duration = planData.duration || 365;
    } else {
      const cycleData = planData[billingCycle];
      if (!cycleData) {
        return res.status(400).json({ success: false, message: 'Invalid billing cycle for this plan' });
      }
      // Note: In DB, price is base price, total includes GST. 
      // For now, let's assume 'price' in DB is the total to keep it simple, or calculate GST.
      // Based on seed: price is the value we want to charge.
      const gst = Math.round(cycleData.price * (cycleData.gstPercentage || 18) / 100);
      amount = cycleData.price + gst;
      duration = cycleData.duration;
    }

    // Free plan - activate immediately
    if (plan === 'FREE' || amount === 0) {
      partner.subscription = {
        plan: 'FREE',
        startDate: new Date(),
        endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
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
      return res.json({
        success: true,
        mock: true,
        message: 'Payment is disabled. Use mock activation.',
        data: { plan, billingCycle, amount, paymentEnabled: false }
      });
    }

    // Real payment flow
    const receipt = `rcpt_${Date.now()}`;
    const result = await paymentService.createOrder(amount, 'INR', receipt, {
      userId: req.user._id.toString(),
      plan,
      billingCycle
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
        id: result.order.id,
        amount: Math.round(result.order.amount),
        currency: result.order.currency,
        plan: planData,
        billingCycle,
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
exports.mockActivatePlan = async (req, res) => {
  try {
    const { plan, billingCycle = 'monthly' } = req.body;
    const plans = await paymentService.getSubscriptionPlans();

    if (!plans[plan]) {
      return res.status(400).json({ success: false, message: 'Invalid plan selected' });
    }

    const planData = plans[plan];
    const partner = await StaffingPartner.findOne({ user: req.user._id });

    let amount, duration;
    if (plan === 'FREE') {
      amount = planData.price || 0;
      duration = planData.duration || 365;
    } else {
      const cycleData = planData[billingCycle];
      const gst = Math.round(cycleData.price * (cycleData.gstPercentage || 18) / 100);
      amount = cycleData.price + gst;
      duration = cycleData.duration;
    }

    const startDate = new Date();
    const endDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    const subscription = await Subscription.create({
      user: req.user._id,
      staffingPartner: partner._id,
      plan,
      billingCycle,
      startDate,
      endDate,
      status: 'ACTIVE',
      payment: {
        orderId: 'mock_order_' + Date.now(),
        paymentId: 'mock_payment_' + Date.now(),
        amount: amount,
        currency: 'INR',
        method: 'mock',
        status: 'COMPLETED',
        paidAt: new Date()
      }
    });

    partner.subscription = { plan, billingCycle, startDate, endDate, isActive: true };
    await partner.save();

    res.json({
      success: true,
      message: `${planData.name} plan activated successfully (Mock)`,
      data: { subscription, partner: { id: partner._id, subscription: partner.subscription } }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Mock activation failed', error: error.message });
  }
};

// @desc    Verify Payment
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, billingCycle = 'monthly' } = req.body;
    const result = await paymentService.verifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature);

    if (!result) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    const partner = await StaffingPartner.findOne({ user: req.user._id });
    if (!partner) {
      console.error('❌ Partner not found during verification:', req.user._id);
      return res.status(404).json({ success: false, message: 'Staffing partner profile not found' });
    }

    const plans = await paymentService.getSubscriptionPlans();
    const planData = plans[plan];

    if (!planData) {
      console.error('❌ Plan not found in DB during verification:', plan);
      return res.status(400).json({ success: false, message: 'Plan configuration missing' });
    }

    let amount, duration;
    if (plan === 'FREE') {
      amount = planData.price || 0;
      duration = planData.duration || 365;
    } else {
      const cycleData = planData[billingCycle];
      if (!cycleData) {
        console.error(`❌ Cycle data missing for ${plan} / ${billingCycle}`);
        return res.status(400).json({ success: false, message: 'Billing cycle configuration missing' });
      }
      const gst = Math.round(cycleData.price * (cycleData.gstPercentage || 18) / 100);
      amount = cycleData.price + gst;
      duration = cycleData.duration;
    }

    const startDate = new Date();
    const endDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    const subscription = await Subscription.create({
      user: req.user._id,
      staffingPartner: partner._id,
      plan,
      billingCycle,
      startDate,
      endDate,
      status: 'ACTIVE',
      payment: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        amount: amount,
        currency: 'INR',
        status: 'COMPLETED',
        paidAt: new Date()
      }
    });

    partner.subscription = { plan, billingCycle, startDate, endDate, isActive: true };
    await partner.save();

    res.json({ success: true, message: 'Payment verified', data: subscription });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Verification failed', error: error.message });
  }
};

// @desc    Get Subscription History
exports.getSubscriptions = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const subscriptions = await Subscription.find({ staffingPartner: partner._id }).sort({ createdAt: -1 });

    res.json({ success: true, data: { current: partner.subscription, history: subscriptions, paymentEnabled } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch history', error: error.message });
  }
};

// @desc    Get Current Subscription
exports.getCurrentSubscription = async (req, res) => {
  try {
    const partner = await StaffingPartner.findOne({ user: req.user._id });
    const plans = await paymentService.getSubscriptionPlans();
    const currentPlan = partner.subscription?.plan || 'FREE';
    const planData = plans[currentPlan];

    res.json({
      success: true,
      data: {
        subscription: partner.subscription,
        planData,
        isActive: partner.subscription?.isActive || false,
        daysRemaining: partner.subscription?.endDate
          ? Math.max(0, Math.ceil((new Date(partner.subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24)))
          : 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch subscription', error: error.message });
  }
};