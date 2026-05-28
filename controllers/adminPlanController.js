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

// Helper function to calculate price based on monthly plan and discount percentage
const calculateDiscountedPrice = async (planData) => {
  const { billingCycle, discountPercentage, planKey } = planData;
  const cycle = billingCycle?.toLowerCase();
  
  if (!['3month', '6month', 'yearly'].includes(cycle) || !discountPercentage || discountPercentage <= 0) {
    return planData.price;
  }

  // Get base key (e.g., GROWTH from GROWTH_3MONTH)
  const baseKey = planKey.split('_')[0].toUpperCase();
  const monthlyKey = `${baseKey}_MONTHLY`;

  // Find the monthly plan
  const monthlyPlan = await SubscriptionPlan.findOne({ planKey: monthlyKey });
  if (monthlyPlan) {
    let multiplier = 1;
    if (cycle === '3month') multiplier = 3;
    else if (cycle === '6month') multiplier = 6;
    else if (cycle === 'yearly') multiplier = 12;

    const originalPrice = monthlyPlan.price * multiplier;
    const discounted = originalPrice * (1 - discountPercentage / 100);
    return Math.round(discounted);
  }

  return planData.price; // Fallback if monthly plan not found
};

// @desc    Create a new plan
// @route   POST /api/admin/plans
// exports.createPlan = async (req, res) => {
exports.createPlan = async (req, res) => {
  try {
    const { _id, __v, createdAt, updatedAt, ...planData } = req.body;
    planData.price = await calculateDiscountedPrice(planData);

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
    const { _id, __v, createdAt, updatedAt, ...planData } = req.body;
    planData.price = await calculateDiscountedPrice(planData);

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
