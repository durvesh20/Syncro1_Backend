// backend/services/jobAccessService.js — NEW FILE

const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

// Plan hierarchy — higher plans see everything from lower plans too
const PLAN_HIERARCHY = {
  'FREE':         ['FREE'],
  'GROWTH':       ['FREE', 'GROWTH'],
  'PROFESSIONAL': ['FREE', 'GROWTH', 'PROFESSIONAL'],
  'PREMIUM':      ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM']
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
    if (filters.category) {
      query.category = filters.category;
    }

    if (filters.experienceLevel) {
      query.experienceLevel = filters.experienceLevel;
    }

    if (filters.employmentType) {
      query.employmentType = filters.employmentType;
    }

    if (filters.isUrgent === 'true' || filters.isUrgent === true) {
      query.isUrgent = true;
    }

    if (filters.location) {
      const escaped = filters.location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { 'location.city': new RegExp(escaped, 'i') },
        { 'location.isRemote': true }
      ];
    }

    if (filters.search) {
      const escaped = filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Don't override $or if location already set it
      const searchOr = [
        { title: new RegExp(escaped, 'i') },
        { category: new RegExp(escaped, 'i') },
        { 'skills.required': new RegExp(escaped, 'i') },
        { tags: new RegExp(escaped, 'i') }
      ];

      if (query.$or) {
        // Combine location + search with $and
        query.$and = [
          { $or: query.$or },
          { $or: searchOr }
        ];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    if (filters.salaryMin) {
      query['salary.max'] = { $gte: Number(filters.salaryMin) };
    }
    if (filters.salaryMax) {
      query['salary.min'] = { $lte: Number(filters.salaryMax) };
    }

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

    // Pagination
    const page = Math.max(1, parseInt(filters.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(filters.limit) || 10));
    const skip = (page - 1) * limit;

    // Fetch jobs + count in parallel
    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('company', 'companyName kyc.logo kyc.industry kyc.employeeCount')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Job.countDocuments(query)
    ]);

    // Get partner's existing submissions for these jobs
    const jobIds = jobs.map(j => j._id);
    const mySubmissions = await Candidate.aggregate([
      {
        $match: {
          submittedBy: partnerId,
          job: { $in: jobIds }
        }
      },
      {
        $group: {
          _id: '$job',
          count: { $sum: 1 },
          latestStatus: { $last: '$status' }
        }
      }
    ]);

    const submissionMap = {};
    mySubmissions.forEach(s => {
      submissionMap[s._id.toString()] = {
        count: s.count,
        latestStatus: s.latestStatus
      };
    });

    // Enrich jobs with metadata
    const enrichedJobs = jobs.map(job => {
      const jobIdStr = job._id.toString();
      const subs = submissionMap[jobIdStr];

      // Commission estimate
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

      // Check if this is a plan-exclusive job
      const lowestPlan = this._getLowestPlan(job.eligiblePlans || []);

      return {
        ...job,
        _meta: {
          mySubmissions: subs ? subs.count : 0,
          myLatestStatus: subs ? subs.latestStatus : null,
          commissionEstimate,
          isPlanExclusive: lowestPlan !== 'FREE',
          lowestRequiredPlan: lowestPlan,
          canSubmit: !subs || subs.count < (job.vacancies || 1) // Simple check
        }
      };
    });

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
    for (const p of order) {
      if (plans.includes(p)) return p;
    }
    return 'PREMIUM';
  }
}

module.exports = new JobAccessService();