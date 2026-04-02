// backend/services/jobAccessService.js — FIXED

const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const mongoose = require('mongoose');

// Plan hierarchy — higher plans see everything from lower plans too
const PLAN_HIERARCHY = {
  'FREE': ['FREE'],
  'GROWTH': ['FREE', 'GROWTH'],
  'PROFESSIONAL': ['FREE', 'GROWTH', 'PROFESSIONAL'],
  'PREMIUM': ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM']
};

class JobAccessService {

  /**
   * Get jobs accessible to a partner based on their subscription plan
   * Includes enriched metadata (commission estimate, my submissions count)
   */
  async getAccessibleJobs(partnerId, partnerPlan, filters = {}) {
    const plan = partnerPlan || 'FREE';
    const accessiblePlans = PLAN_HIERARCHY[plan] || ['FREE'];

    // Build query
    const query = {
      status: 'ACTIVE',
      eligiblePlans: { $in: accessiblePlans }
    };

    // Apply filters
    if (filters.category) query.category = filters.category;
    if (filters.experienceLevel) query.experienceLevel = filters.experienceLevel;
    if (filters.employmentType) query.employmentType = filters.employmentType;
    if (filters.isUrgent === 'true' || filters.isUrgent === true) query.isUrgent = true;

    if (filters.location) {
      // ✅ FIX #9: Limit search length to prevent DoS
      const searchTerm = filters.location.slice(0, 100);
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { 'location.city': new RegExp(escaped, 'i') },
        { 'location.isRemote': true }
      ];
    }

    if (filters.search) {
      // ✅ FIX #9: Limit search length to prevent DoS
      const searchTerm = filters.search.slice(0, 100);
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchOr = [
        { title: new RegExp(escaped, 'i') },
        { category: new RegExp(escaped, 'i') },
        { 'skills.required': new RegExp(escaped, 'i') },
        { tags: new RegExp(escaped, 'i') }
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    if (filters.salaryMin) query['salary.max'] = { $gte: Number(filters.salaryMin) };
    if (filters.salaryMax) query['salary.min'] = { $lte: Number(filters.salaryMax) };

    // Sorting
    let sort = { isFeatured: -1, isUrgent: -1, createdAt: -1 }; // Default
    switch (filters.sortBy) {
      case 'newest': sort = { createdAt: -1 }; break;
      case 'oldest': sort = { createdAt: 1 }; break;
      case 'salary_high': sort = { 'salary.max': -1 }; break;
      case 'salary_low': sort = { 'salary.min': 1 }; break;
      case 'commission': sort = { 'commission.value': -1 }; break;
      case 'urgent': sort = { isUrgent: -1, createdAt: -1 }; break;
    }

    // ✅ FIX #10: Sanitize pagination to prevent bypass
    const page = Math.max(1, Math.min(1000, parseInt(filters.page) || 1));
    const limit = Math.max(1, Math.min(100, parseInt(filters.limit) || 10));
    const skip = (page - 1) * limit;

    // ✅ FIX #7: Single aggregation with $lookup (optimized N+1)
    // Convert partnerId to ObjectId for $lookup matching
    const partnerObjectId = mongoose.Types.ObjectId(partnerId);

    const jobs = await Job.aggregate([
      { $match: query },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'candidates',
          let: { jobId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$job', '$$jobId'] },
                    { $eq: ['$submittedBy', partnerObjectId] }
                  ]
                }
              }
            },
            { $group: { _id: null, count: { $sum: 1 }, latestStatus: { $last: '$status' } } }
          ],
          as: 'mySubmissions'
        }
      },
      {
        $addFields: {
          '_meta.mySubmissions': { $ifNull: [{ $arrayElemAt: ['$mySubmissions.count', 0] }, 0] },
          '_meta.myLatestStatus': { $arrayElemAt: ['$mySubmissions.latestStatus', 0] }
        }
      }
    ]);

    // Enrich jobs with commission and plan metadata
    const enrichedJobs = jobs.map(job => {
      let commissionEstimate = null;
      if (job.commission && job.salary?.max) {
        if (job.commission.type === 'percentage') {
          commissionEstimate = {
            type: 'percentage',
            rate: `${job.commission.value}%`,
            estimated: `₹${Math.round(job.salary.max * job.commission.value / 100).toLocaleString('en-IN')}`,
            note: 'Based on max salary'
          };
        } else {
          commissionEstimate = {
            type: 'fixed',
            amount: `₹${job.commission.value.toLocaleString('en-IN')}`
          };
        }
      }

      const lowestPlan = this._getLowestPlan(job.eligiblePlans || []);

      return {
        ...job,
        _meta: {
          ...job._meta,
          commissionEstimate,
          isPlanExclusive: lowestPlan !== 'FREE',
          lowestRequiredPlan: lowestPlan,
          canSubmit: !job._meta.mySubmissions || job._meta.mySubmissions < (job.vacancies || 1)
        }
      };
    });

    // Total jobs count for pagination (still a separate query)
    const total = await Job.countDocuments(query);

    return {
      jobs: enrichedJobs,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      },
      partnerAccess: {
        plan,
        accessiblePlans,
        totalAccessibleJobs: total
      }
    };
  }

  _getLowestPlan(plans) {
    const order = ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'];
    for (const p of order) if (plans.includes(p)) return p;
    return 'PREMIUM';
  }
}

module.exports = new JobAccessService();