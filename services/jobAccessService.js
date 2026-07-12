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

function parseCtcLimit(ctcRangeStr) {
  if (!ctcRangeStr) return Infinity;

  const str = ctcRangeStr.toUpperCase().replace(/\s+/g, '');

  if (str.includes('ALL') || str.includes('NO_LIMIT') || str.includes('ANY') || str === '') {
    return Infinity;
  }

  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const value = parseFloat(match[1]);

    // Check if the range implies Lakhs/L/LPA
    if (str.includes('L') || str.includes('LPA') || str.includes('LAKH')) {
      return value * 100000;
    }

    // If it's a raw number without L, but is small (e.g. <= 100), assume it's in LPA
    if (value <= 100) {
      return value * 100000;
    }

    return value;
  }

  return Infinity;
}

class JobAccessService {

  async getPlanCtcLimits() {
    const SubscriptionPlan = require('../models/SubscriptionPlan');
    try {
      const plans = await SubscriptionPlan.find({ isActive: true });

      const limits = {
        'FREE': 500000,
        'GROWTH': 2000000,
        'PROFESSIONAL': 3500000,
        'PREMIUM': Infinity
      };

      for (const plan of plans) {
        const key = plan.planKey.toUpperCase();
        const limit = parseCtcLimit(plan.ctcRange);

        if (key === 'FREE') {
          limits['FREE'] = limit;
        } else if (key.startsWith('GROWTH')) {
          limits['GROWTH'] = limit;
        } else if (key.startsWith('PROFESSIONAL')) {
          limits['PROFESSIONAL'] = limit;
        } else if (key.startsWith('PREMIUM')) {
          limits['PREMIUM'] = limit;
        }
      }

      return limits;
    } catch (error) {
      console.error('[JobAccessService] Failed to fetch subscription plans for CTC limits:', error);
      return {
        'FREE': 500000,
        'GROWTH': 2000000,
        'PROFESSIONAL': 3500000,
        'PREMIUM': Infinity
      };
    }
  }

  async isPlanEligibleForJob(partnerPlan, job, providedCtcLimits = null) {
    const plan = partnerPlan || 'FREE';

    // 1. Resolve accessible plans dynamically from the database
    const SubscriptionPlan = require('../models/SubscriptionPlan');
    let partnerAccessiblePlans = PLAN_HIERARCHY[plan] || ['FREE'];
    try {
      const planDoc = await SubscriptionPlan.findOne({
        $or: [
          { planKey: plan },
          { planKey: new RegExp(`^${plan}`, 'i') }
        ]
      });
      if (planDoc && planDoc.accessiblePlanJobs && planDoc.accessiblePlanJobs.length > 0) {
        partnerAccessiblePlans = planDoc.accessiblePlanJobs;
      }
    } catch (err) {
      console.error('[JobAccessService] Failed to load dynamic accessible plan jobs, using fallback:', err);
    }

    // 2. Determine CTC limit as the highest limit among all accessible plans
    const ctcLimits = providedCtcLimits || await this.getPlanCtcLimits();
    let ctcLimit = 0;
    for (const p of partnerAccessiblePlans) {
      const limit = ctcLimits[p] || 0;
      if (limit === Infinity) {
        ctcLimit = Infinity;
        break;
      }
      if (limit > ctcLimit) {
        ctcLimit = limit;
      }
    }
    if (ctcLimit === 0) {
      ctcLimit = ctcLimits[plan] || 500000;
    }

    // 3. CTC Limit check
    if (ctcLimit !== Infinity) {
      let jobMinSalary = job.salary?.min || job.salary?.max || 0;
      // Normalize salary: if <= 100, treat it as LPA and convert to raw Rupees
      if (jobMinSalary <= 100) {
        jobMinSalary = jobMinSalary * 100000;
      }
      if (jobMinSalary > ctcLimit) {
        return false;
      }
    }

    // 4. Plan tier eligibility check
    if (job.eligiblePlans && job.eligiblePlans.length > 0) {
      const hasPlanAccess = job.eligiblePlans.some(p => partnerAccessiblePlans.includes(p));
      if (!hasPlanAccess) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get jobs accessible to a partner based on their subscription plan
   * Includes enriched metadata (commission estimate, my submissions count)
   */
  async getAccessibleJobs(partnerId, partnerPlan, filters = {}) {
    const plan = partnerPlan || 'FREE';
    const SubscriptionPlan = require('../models/SubscriptionPlan');
    let accessiblePlans = PLAN_HIERARCHY[plan] || ['FREE'];
    try {
      const planDoc = await SubscriptionPlan.findOne({
        $or: [
          { planKey: plan },
          { planKey: new RegExp(`^${plan}`, 'i') }
        ]
      });
      if (planDoc && planDoc.accessiblePlanJobs && planDoc.accessiblePlanJobs.length > 0) {
        accessiblePlans = planDoc.accessiblePlanJobs;
      }
    } catch (err) {
      console.error('[JobAccessService] Failed to load dynamic accessible plan jobs, using fallback:', err);
    }

    // Fetch CTC limits from DB
    const ctcLimits = await this.getPlanCtcLimits();
    let ctcLimit = 0;
    for (const p of accessiblePlans) {
      const limit = ctcLimits[p] || 0;
      if (limit === Infinity) {
        ctcLimit = Infinity;
        break;
      }
      if (limit > ctcLimit) {
        ctcLimit = limit;
      }
    }
    if (ctcLimit === 0) {
      ctcLimit = ctcLimits[plan] || 500000;
    }

    // Auto-update expired active jobs on the platform to ON_HOLD
    await Job.updateMany(
      {
        status: 'ACTIVE',
        applicationDeadline: { $lt: new Date() }
      },
      {
        $set: { status: 'ON_HOLD' }
      }
    );

    // Build query
    const query = {
      status: 'ACTIVE',
      eligiblePlans: { $in: accessiblePlans }
    };

    // Apply experience level filter if provided by parameters
    if (filters.experienceLevel) {
      query.experienceLevel = filters.experienceLevel;
    }

    // Build conditions to combine via $and
    const conditions = [];

    // CTC limit restriction
    if (ctcLimit !== Infinity) {
      const lpaLimit = ctcLimit / 100000;
      conditions.push({
        $or: [
          // If stored as raw Rupees (value > 100)
          {
            $and: [
              { 'salary.min': { $gt: 100 } },
              { 'salary.min': { $lte: ctcLimit } }
            ]
          },
          // If stored as LPA (value <= 100)
          {
            $and: [
              { 'salary.min': { $lte: 100 } },
              { 'salary.min': { $lte: lpaLimit } }
            ]
          },
          // If min salary is not defined, check max salary in raw Rupees
          {
            $and: [
              { $or: [{ 'salary.min': { $exists: false } }, { 'salary.min': null }] },
              { 'salary.max': { $gt: 100 } },
              { 'salary.max': { $lte: ctcLimit } }
            ]
          },
          // If min salary is not defined, check max salary in LPA
          {
            $and: [
              { $or: [{ 'salary.min': { $exists: false } }, { 'salary.min': null }] },
              { 'salary.max': { $lte: 100 } },
              { 'salary.max': { $lte: lpaLimit } }
            ]
          }
        ]
      });
    }

    // Apply filters
    if (filters.category) query.category = filters.category;
    if (filters.employmentType) query.employmentType = filters.employmentType;
    
    if (filters.isUrgent === 'true' || filters.isUrgent === true) {
      query.isUrgent = true;
    } else if (filters.isUrgent === 'false' || filters.isUrgent === false) {
      query.isUrgent = false;
    }

    if (filters.isFeatured === 'true' || filters.isFeatured === true) {
      query.isFeatured = true;
    } else if (filters.isFeatured === 'false' || filters.isFeatured === false) {
      query.isFeatured = false;
    }

    if (filters.workMode) {
      const modes = filters.workMode.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (modes.length > 0) {
        const modeConditions = [];
        if (modes.includes('remote')) modeConditions.push({ 'location.isRemote': true });
        if (modes.includes('hybrid')) modeConditions.push({ 'location.isHybrid': true });
        if (modes.includes('onsite')) modeConditions.push({ 'location.isOnSite': true });
        if (modeConditions.length > 0) {
          conditions.push({ $or: modeConditions });
        }
      }
    }

    if (filters.companyName) {
      const companyNames = filters.companyName.split(',').map(s => s.trim()).filter(Boolean);
      if (companyNames.length > 0) {
        const companyConditions = companyNames.map(name => {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return { companyName: new RegExp(escaped, 'i') };
        });
        const Company = require('../models/Company');
        const matchingCompanies = await Company.find({
          $or: companyConditions
        }).select('_id').lean();
        const companyIds = matchingCompanies.map(c => c._id);
        query.company = { $in: companyIds };
      }
    }

    if (filters.location) {
      const cities = filters.location.split(',').map(s => s.trim()).filter(Boolean);
      if (cities.length > 0) {
        const locationConditions = cities.map(city => {
          const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return { 'location.city': new RegExp(escaped, 'i') };
        });
        locationConditions.push({ 'location.isRemote': true });
        conditions.push({
          $or: locationConditions
        });
      }
    }

    if (filters.search) {
      const searchTerm = filters.search.slice(0, 100);
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Find matching companies to allow search by company name
      const Company = require('../models/Company');
      const matchingCompanies = await Company.find({
        companyName: new RegExp(escaped, 'i')
      }).select('_id').lean();
      const companyIds = matchingCompanies.map(c => c._id);

      conditions.push({
        $or: [
          { title: new RegExp(escaped, 'i') },
          { uniqueId: new RegExp(escaped, 'i') },
          { category: new RegExp(escaped, 'i') },
          { 'skills.required': new RegExp(escaped, 'i') },
          { tags: new RegExp(escaped, 'i') },
          { company: { $in: companyIds } }
        ]
      });
    }

    if (filters.salaryMin) query['salary.max'] = { $gte: Number(filters.salaryMin) };
    if (filters.salaryMax) query['salary.min'] = { $lte: Number(filters.salaryMax) };

    if (conditions.length > 0) {
      query.$and = conditions;
    }

    let sort = { createdAt: -1 };

    switch (filters.sortBy) {
      case 'newest': sort = { createdAt: -1 }; break;
      case 'oldest': sort = { createdAt: 1 }; break;
      case 'salary_high': sort = { 'salary.max': -1, createdAt: -1 }; break;
      case 'salary_low': sort = { 'salary.min': 1, createdAt: -1 }; break;
      case 'commission': sort = { 'commission.value': -1, createdAt: -1 }; break;
      case 'urgent': sort = { isUrgent: -1, createdAt: -1 }; break;
    }

    const page = Math.max(1, Math.min(1000, parseInt(filters.page) || 1));
    const limit = Math.max(1, Math.min(1000, parseInt(filters.limit) || 10));
    const skip = (page - 1) * limit;

    let partnerObjectId;
    try {
      partnerObjectId = new mongoose.Types.ObjectId(partnerId.toString());
    } catch (err) {
      partnerObjectId = partnerId;
    }

    const jobs = await Job.aggregate([
      { $match: query },
      { $sort: sort },
      // Join company data
      {
        $lookup: {
          from: 'companies',
          localField: 'company',
          foreignField: '_id',
          as: 'companyInfo'
        }
      },
      {
        $unwind: {
          path: '$companyInfo',
          preserveNullAndEmptyArrays: true
        }
      },
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
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                latestStatus: { $last: '$status' }
              }
            }
          ],
          as: 'mySubmissions'
        }
      },
      {
        $addFields: {
          company: {
            companyName: '$companyInfo.companyName',
            logo: '$companyInfo.kyc.logo',
            industry: '$companyInfo.kyc.industry'
          },
          '_meta.mySubmissions': {
            $ifNull: [{ $arrayElemAt: ['$mySubmissions.count', 0] }, 0]
          },
          '_meta.myLatestStatus': {
            $arrayElemAt: ['$mySubmissions.latestStatus', 0]
          }
        }
      },
      { $project: { companyInfo: 0, mySubmissions: 0 } }
    ]);

    // =========================
    // PART 9: JOB INTEREST LOGIC ADDED
    // =========================

    // Fetch partner's interests for these jobs
    const jobIds = jobs.map(j => j._id);
    const JobInterest = require('../models/JobInterest');

    const interests = await JobInterest.find({
      partner: partnerId,
      job: { $in: jobIds },
      status: 'ACTIVE'
    });

    const interestMap = interests.reduce((acc, i) => {
      acc[i.job.toString()] = {
        hasInterest: true,
        submissionCount: i.submissionCount,
        submissionLimit: i.submissionLimit,
        remainingSlots: i.submissionLimit - i.submissionCount,
        canSubmit: i.submissionCount < i.submissionLimit
      };
      return acc;
    }, {});

    // Enrich jobs with interest data
    const enrichedJobs = jobs.map(job => {
      const jobIdStr = job._id.toString();
      const interest = interestMap[jobIdStr] || {
        hasInterest: false,
        submissionCount: 0,
        submissionLimit: (job.vacancies || 1) * 5,
        remainingSlots: 0,
        canSubmit: false
      };

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
          canSubmit: interest.hasInterest && interest.canSubmit,
          interest
        }
      };
    });

    const total = await Job.countDocuments(query);

    // Fetch unique locations and companies for filter options
    const activeJobs = await Job.find({
      status: 'ACTIVE',
      eligiblePlans: { $in: accessiblePlans }
    }).select('location company').populate('company', 'companyName').lean();

    const locationsSet = new Set();
    const companiesSet = new Set();

    activeJobs.forEach(j => {
      if (j.location?.city) {
        if (Array.isArray(j.location.city)) {
          j.location.city.forEach(c => locationsSet.add(c));
        } else {
          locationsSet.add(j.location.city);
        }
      }
      if (j.company?.companyName) {
        companiesSet.add(j.company.companyName);
      }
    });

    const uniqueLocations = Array.from(locationsSet).filter(Boolean).sort();
    const uniqueCompanies = Array.from(companiesSet).filter(Boolean).sort();

    return {
      jobs: enrichedJobs,
      pagination: {
        current: 1,
        pages: 1,
        total,
        hasNext: false,
        hasPrev: false
      },
      partnerAccess: {
        plan,
        accessiblePlans,
        totalAccessibleJobs: total
      },
      filterOptions: {
        locations: uniqueLocations,
        companies: uniqueCompanies
      }
    };
  }

  async getAccessibleJobsCount(partnerPlan) {
    const plan = partnerPlan || 'FREE';
    const SubscriptionPlan = require('../models/SubscriptionPlan');
    let accessiblePlans = PLAN_HIERARCHY[plan] || ['FREE'];
    try {
      const planDoc = await SubscriptionPlan.findOne({
        $or: [
          { planKey: plan },
          { planKey: new RegExp(`^${plan}`, 'i') }
        ]
      });
      if (planDoc && planDoc.accessiblePlanJobs && planDoc.accessiblePlanJobs.length > 0) {
        accessiblePlans = planDoc.accessiblePlanJobs;
      }
    } catch (err) {
      console.error('[JobAccessService] Failed to load dynamic accessible plan jobs, using fallback:', err);
    }

    const ctcLimits = await this.getPlanCtcLimits();
    let ctcLimit = 0;
    for (const p of accessiblePlans) {
      const limit = ctcLimits[p] || 0;
      if (limit === Infinity) {
        ctcLimit = Infinity;
        break;
      }
      if (limit > ctcLimit) {
        ctcLimit = limit;
      }
    }
    if (ctcLimit === 0) {
      ctcLimit = ctcLimits[plan] || 500000;
    }

    const query = {
      status: 'ACTIVE',
      eligiblePlans: { $in: accessiblePlans }
    };

    if (ctcLimit !== Infinity) {
      const lpaLimit = ctcLimit / 100000;
      query.$and = [
        {
          $or: [
            {
              $and: [
                { 'salary.min': { $gt: 100 } },
                { 'salary.min': { $lte: ctcLimit } }
              ]
            },
            {
              $and: [
                { 'salary.min': { $lte: 100 } },
                { 'salary.min': { $lte: lpaLimit } }
              ]
            },
            {
              $and: [
                { $or: [{ 'salary.min': { $exists: false } }, { 'salary.min': null }] },
                { 'salary.max': { $gt: 100 } },
                { 'salary.max': { $lte: ctcLimit } }
              ]
            },
            {
              $and: [
                { $or: [{ 'salary.min': { $exists: false } }, { 'salary.min': null }] },
                { 'salary.max': { $lte: 100 } },
                { 'salary.max': { $lte: lpaLimit } }
              ]
            }
          ]
        }
      ];
    }

    return await Job.countDocuments(query);
  }

  _getLowestPlan(plans) {
    const order = ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'];
    for (const p of order) if (plans.includes(p)) return p;
    return 'PREMIUM';
  }
}

module.exports = new JobAccessService();