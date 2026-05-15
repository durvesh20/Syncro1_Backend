// backend/controllers/adminPlanController.js
const SubscriptionPlan = require('../models/SubscriptionPlan');

// @desc    Get all plans (Admin)
// @route   GET /api/admin/plans
exports.getAllPlans = async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find().sort({ sortOrder: 1 });
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plans',
      error: error.message
    });
  }
};

// Helper function to calculate yearly price based on monthly and discount
const calculateYearlyPrice = async (planData) => {
  if (planData.billingCycle !== 'yearly' || !planData.discountPercentage || planData.discountPercentage <= 0) {
    return planData.price;
  }

  // Get base key (e.g., GROWTH from GROWTH_YEARLY)
  const baseKey = planData.planKey.split('_')[0];
  const monthlyKey = `${baseKey}_MONTHLY`;

  // Find the monthly plan
  const monthlyPlan = await SubscriptionPlan.findOne({ planKey: monthlyKey });
  if (monthlyPlan) {
    const originalYearly = monthlyPlan.price * 12;
    const discounted = originalYearly * (1 - planData.discountPercentage / 100);
    return Math.round(discounted);
  }

  return planData.price; // Fallback if monthly plan not found
};

// @desc    Create a new plan
// @route   POST /api/admin/plans
exports.createPlan = async (req, res) => {
  try {
    const planData = req.body;
    planData.price = await calculateYearlyPrice(planData);

    const plan = await SubscriptionPlan.create(planData);
    res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      data: plan
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to create plan',
      error: error.message
    });
  }
};

// @desc    Update a plan
// @route   PUT /api/admin/plans/:id
exports.updatePlan = async (req, res) => {
  try {
    const planData = req.body;
    planData.price = await calculateYearlyPrice(planData);

    const plan = await SubscriptionPlan.findByIdAndUpdate(
      req.params.id,
      planData,
      { new: true, runValidators: true }
    );

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    res.json({
      success: true,
      message: 'Plan updated successfully',
      data: plan
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Failed to update plan',
      error: error.message
    });
  }
};

// @desc    Delete a plan
// @route   DELETE /api/admin/plans/:id
exports.deletePlan = async (req, res) => {
  try {
    const plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    res.json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete plan',
      error: error.message
    });
  }
};

// @desc    Seed initial plans (Admin only)
// @route   POST /api/admin/plans/seed
exports.seedPlans = async (req, res) => {
  try {
    const initialPlans = [
      { planKey: 'FREE', name: 'Free', subHeading: 'Entry-level placements', ctcRange: '₹0 - ₹5L', price: 0, duration: 365, billingCycle: 'fixed', features: [], sortOrder: 1 },
      { planKey: 'GROWTH_MONTHLY', name: 'Growth', subHeading: 'Mid-level opportunities', ctcRange: '₹5L - ₹20L', price: 4999, duration: 30, billingCycle: 'monthly', isHighlight: true, features: ['Mid-level jobs', 'Advanced database access', 'Priority notifications'], sortOrder: 2 },
      { planKey: 'GROWTH_YEARLY', name: 'Growth', subHeading: 'Mid-level opportunities', ctcRange: '₹5L - ₹20L', price: 49990, duration: 365, billingCycle: 'yearly', features: ['Mid-level jobs', 'Advanced database access', 'Priority notifications'], sortOrder: 3 },
      { planKey: 'PROFESSIONAL_MONTHLY', name: 'Professional', subHeading: 'Senior-level opportunities', ctcRange: '₹20L - ₹35L', price: 7999, duration: 30, billingCycle: 'monthly', features: ['Senior-level jobs', 'Premium commission', 'VIP support'], sortOrder: 4 },
      { planKey: 'PROFESSIONAL_YEARLY', name: 'Professional', subHeading: 'Senior-level opportunities', ctcRange: '₹20L - ₹35L', price: 79990, duration: 365, billingCycle: 'yearly', features: ['Senior-level jobs', 'Premium commission', 'VIP support'], sortOrder: 5 },
      { planKey: 'PREMIUM_MONTHLY', name: 'Premium', subHeading: 'Executive & C-suite jobs', ctcRange: '₹35L+', price: 11999, duration: 30, billingCycle: 'monthly', features: ['Executive jobs', 'Highest commission', 'White-glove support'], sortOrder: 6 },
      { planKey: 'PREMIUM_YEARLY', name: 'Premium', subHeading: 'Executive & C-suite jobs', ctcRange: '₹35L+', price: 119990, duration: 365, billingCycle: 'yearly', features: ['Executive jobs', 'Highest commission', 'White-glove support'], sortOrder: 7 }
    ];

    await SubscriptionPlan.deleteMany({});
    const plans = await SubscriptionPlan.insertMany(initialPlans);

    res.json({
      success: true,
      message: 'Plans seeded successfully',
      count: plans.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to seed plans',
      error: error.message
    });
  }
};
