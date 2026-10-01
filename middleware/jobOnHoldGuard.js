// middleware/jobOnHoldGuard.js
// Blocks mutating pipeline actions when the parent job is ON_HOLD.
// Admin and sub_admin roles are EXEMPT (they get a frontend warning instead).

const Job = require('../models/Job');
const Candidate = require('../models/Candidate');

/**
 * Middleware that blocks any mutating action when the parent job is ON_HOLD.
 *
 * Resolves the job via:
 *   1. req.params.jobId  → direct job route
 *   2. req.params.id     → candidate route (looks up candidate.job)
 *
 * Admin / sub_admin users are exempt — the frontend shows a warning dialog instead.
 *
 * Attach AFTER auth middleware and BEFORE the controller.
 */
const jobOnHoldGuard = async (req, res, next) => {
  try {
    // Admin and sub_admin are exempt from the backend block
    const userRole = req.user?.role;
    if (userRole === 'admin' || userRole === 'sub_admin') {
      return next();
    }

    let jobId = req.params.jobId;

    // For candidate-level routes, resolve job from candidate
    if (!jobId && req.params.id) {
      const candidate = await Candidate.findById(req.params.id).select('job').lean();
      if (!candidate) {
        return res.status(404).json({
          success: false,
          message: 'Candidate not found'
        });
      }
      jobId = candidate.job;
    }

    if (!jobId) {
      return next(); // No job context — skip guard
    }

    const job = await Job.findById(jobId).select('status').lean();
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    if (job.status === 'ON_HOLD') {
      return res.status(403).json({
        success: false,
        code: 'JOB_ON_HOLD',
        message: 'This job is currently on hold. All actions are frozen until the job is reactivated.'
      });
    }

    next();
  } catch (error) {
    console.error('[JOB_ON_HOLD_GUARD] Error:', error.message);
    next(error);
  }
};

module.exports = jobOnHoldGuard;

