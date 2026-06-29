const Job = require('../models/Job');

class CandidateScoringService {

  /**
   * Score candidate profile against job using the same 8-component weights as the AI engine.
   * 
   * Weights (aligned with aiService.js):
   *   skills:       30%
   *   experience:   20%
   *   domain:       15%
   *   education:    10%
   *   salary:       10%
   *   location:      5%
   *   noticePeriod:  5%
   *   stability:     5%
   *   ─────────────────
   *   TOTAL:       100%
   *
   * @param {object} profile - Candidate profile data
   * @param {object} job - Job document
   * @returns {object} Score breakdown
   */
  scoreAgainstJob(profile, job) {
    if (!profile || !job) {
      return { overallScore: 0, matchLevel: 'UNKNOWN', breakdown: {} };
    }

    const scores = {};
    let totalScore = 0;

    // 1. Skills Match (30%)
    const skillResult = this._scoreSkills(
      profile.skills || [],
      job.skills?.required || [],
      job.skills?.preferred || []
    );
    scores.skills = {
      score: skillResult.score,
      weight: 30,
      matchedRequired: skillResult.matchedRequired,
      missingRequired: skillResult.missingRequired,
      matchedPreferred: skillResult.matchedPreferred,
      coveragePercent: skillResult.coveragePercent
    };
    totalScore += skillResult.score * 0.30;

    // 2. Experience Match (20%)
    const expScore = this._scoreExperience(profile.totalExperience, job.experienceRange);
    scores.experience = {
      score: expScore.score,
      weight: 20,
      actual: profile.totalExperience ? `${profile.totalExperience} years` : 'Not provided',
      required: job.experienceRange ? `${job.experienceRange.min}-${job.experienceRange.max} years` : 'Not specified',
      status: expScore.status,
      detail: expScore.detail
    };
    totalScore += expScore.score * 0.20;

    // 3. Domain Match (15%)
    const domainScore = this._scoreDomain(profile, job);
    scores.domain = {
      score: domainScore.score,
      weight: 15,
      jobDomain: job.category || 'Not specified',
      candidateDomain: profile.domain || profile.currentDesignation || 'Not specified',
      status: domainScore.status
    };
    totalScore += domainScore.score * 0.15;

    // 4. Education Match (10%)
    const eduScore = this._scoreEducation(profile.education, job);
    scores.education = {
      score: eduScore.score,
      weight: 10,
      minimumRequired: job.educationRequirement || 'Not specified',
      candidateEducation: eduScore.candidateEducation || 'Not provided',
      status: eduScore.status
    };
    totalScore += eduScore.score * 0.10;

    // 5. Salary Fit (10%)
    const salaryScore = this._scoreSalary(profile.expectedSalary, job.salary);
    scores.salary = {
      score: salaryScore.score,
      weight: 10,
      budget: job.salary ? `₹${(job.salary.min || 0).toLocaleString('en-IN')}-₹${(job.salary.max || 0).toLocaleString('en-IN')}` : 'Not specified',
      expected: profile.expectedSalary ? `₹${profile.expectedSalary.toLocaleString('en-IN')}` : 'Not provided',
      deltaPercent: salaryScore.deltaPercent || 0,
      status: salaryScore.status,
      withinBudget: salaryScore.withinBudget
    };
    totalScore += salaryScore.score * 0.10;

    // 6. Location Match (5%)
    const locScore = this._scoreLocation(
      profile.currentLocation,
      profile.preferredLocations,
      profile.canRelocate,
      job.location
    );
    scores.location = {
      score: locScore.score,
      weight: 5,
      jobLocation: job.location?.city || 'Not specified',
      candidateLocation: profile.currentLocation || profile.location || 'Not specified',
      status: locScore.status,
      detail: locScore.detail
    };
    totalScore += locScore.score * 0.05;

    // 7. Notice Period Fit (5%)
    const npScore = this._scoreNoticePeriod(profile.noticePeriod);
    scores.noticePeriod = {
      score: npScore.score,
      weight: 5,
      actual: profile.noticePeriod || 'Not specified',
      days: npScore.days,
      status: npScore.status
    };
    totalScore += npScore.score * 0.05;

    // 8. Stability Score (5%)
    const stabScore = this._scoreStability(profile);
    scores.stability = {
      score: stabScore.score,
      weight: 5,
      averageTenureYears: stabScore.averageTenureYears || 0,
      isJobHopper: stabScore.isJobHopper || false,
      risk: stabScore.risk,
      detail: stabScore.detail
    };
    totalScore += stabScore.score * 0.05;

    const overall = Math.round(totalScore);

    // Summary
    scores.summary = {
      weightedScore: overall,
      riskPenalty: 0,
      riskBreakdown: {
        careerGapPenalty: 0,
        jobHopperPenalty: 0,
        domainMismatchPenalty: 0,
        experienceDiscrepancyPenalty: 0,
        salaryOverBudgetPenalty: 0
      },
      finalAdjustedScore: overall,
      matchLevel: this._getMatchLevel(overall)
    };

    return {
      overallScore: overall,
      matchLevel: this._getMatchLevel(overall),
      recommendation: this._getRecommendation(overall),
      breakdown: scores,
      flags: this._getFlags(profile, job),
      advice: this._getAdvice(scores)
    };
  }

  /**
   * Pre-submission check for partners
   * Returns score + whether they should submit or not
   */
  preSubmissionCheck(profile, job) {
    const result = this.scoreAgainstJob(profile, job);

    return {
      ...result,
      shouldSubmit: result.overallScore >= 40,
      message: result.overallScore >= 80
        ? 'Excellent match! Submit with confidence.'
        : result.overallScore >= 60
          ? 'Good match. Candidate looks suitable for this role.'
          : result.overallScore >= 40
            ? 'Moderate match. Some gaps exist — proceed if candidate has other strengths not captured here.'
            : 'Weak match. This candidate may not be suitable for this role. Consider other opportunities.'
    };
  }

  // ── SCORING METHODS ──

  _scoreExperience(candidateExp, range) {
    if (candidateExp === undefined || candidateExp === null || !range) {
      return { score: 50, status: 'UNKNOWN', detail: 'Not specified' };
    }

    const { min, max } = range;

    if (candidateExp >= min && candidateExp <= max) {
      return { score: 100, status: 'MEETS', detail: `${candidateExp} years — within range (${min}-${max})` };
    }
    if (candidateExp > max && candidateExp <= max + 2) {
      return { score: 70, status: 'EXCEEDS', detail: `${candidateExp} years — ${candidateExp - max} year(s) above max` };
    }
    if (candidateExp < min && candidateExp >= min - 1) {
      return { score: 70, status: 'BELOW', detail: `${candidateExp} years — ${min - candidateExp} year(s) below min` };
    }
    if (candidateExp < min && candidateExp >= min - 3) {
      return { score: 40, status: 'BELOW', detail: `${candidateExp} years — ${min - candidateExp} year(s) below min` };
    }
    if (candidateExp > max + 4) {
      return { score: 30, status: 'EXCEEDS', detail: `${candidateExp} years — overqualified` };
    }
    return { score: 20, status: 'BELOW', detail: `${candidateExp} years — significant gap` };
  }

  _scoreSkills(candidateSkills, required, preferred) {
    const normalize = s => s.toLowerCase().trim();
    const candidateNorm = candidateSkills.map(normalize);

    const matchedRequired = [];
    const missingRequired = [];

    required.forEach(skill => {
      const n = normalize(skill);
      const found = candidateNorm.some(cs => cs.includes(n) || n.includes(cs));
      (found ? matchedRequired : missingRequired).push(skill);
    });

    const matchedPreferred = preferred.filter(skill => {
      const n = normalize(skill);
      return candidateNorm.some(cs => cs.includes(n) || n.includes(cs));
    });

    const reqScore = required.length > 0 ? (matchedRequired.length / required.length) * 100 : 80;
    const coveragePercent = required.length > 0 ? Math.round((matchedRequired.length / required.length) * 100) : 100;
    
    // Apply cap: if coverage < 70%, cap score at 50
    let score = Math.round(reqScore);
    if (coveragePercent < 70) score = Math.min(score, 50);

    return {
      score,
      matchedRequired,
      missingRequired,
      matchedPreferred,
      coveragePercent
    };
  }

  _scoreSalary(expected, jobSalary) {
    if (!expected || !jobSalary?.max) {
      return { score: 50, status: 'UNKNOWN', detail: 'Salary data not available', deltaPercent: 0, withinBudget: false };
    }

    const min = jobSalary.min || 0;
    const max = jobSalary.max;
    const deltaPercent = max > 0 ? Math.round(((expected / max) - 1) * 100) : 0;

    if (expected <= max) {
      return { score: 100, status: 'WITHIN', detail: 'Within budget', deltaPercent, withinBudget: true };
    }
    if (expected <= max * 1.10) {
      return { score: 80, status: 'SLIGHTLY_OVER', detail: `${deltaPercent}% above — may be negotiable`, deltaPercent, withinBudget: false };
    }
    if (expected <= max * 1.20) {
      return { score: 60, status: 'OVER', detail: `${deltaPercent}% above budget`, deltaPercent, withinBudget: false };
    }
    if (expected <= max * 1.30) {
      return { score: 40, status: 'OVER', detail: `${deltaPercent}% above budget`, deltaPercent, withinBudget: false };
    }
    return { score: 0, status: 'OVER', detail: `${deltaPercent}% above — unlikely to fit`, deltaPercent, withinBudget: false };
  }

  _scoreLocation(current, preferred, canRelocate, jobLoc) {
    if (!jobLoc?.city) return { score: 50, status: 'UNKNOWN', detail: 'Job location not specified' };

    const cities = Array.isArray(jobLoc.city) 
      ? jobLoc.city.map(c => c.toLowerCase()) 
      : [jobLoc.city.toLowerCase()];
    
    const displayCities = Array.isArray(jobLoc.city) ? jobLoc.city.join(', ') : jobLoc.city;

    if (jobLoc.isRemote) return { score: 100, status: 'EXACT', detail: 'Remote — no location constraint' };
    
    const currentLower = current?.toLowerCase();
    const isExact = currentLower && cities.some(c => currentLower.includes(c) || c.includes(currentLower));
    if (isExact) return { score: 100, status: 'EXACT', detail: `Already in ${displayCities}` };
    
    const isPreferred = preferred?.some(pref => {
      const prefLower = pref.toLowerCase();
      return cities.some(c => prefLower.includes(c) || c.includes(prefLower));
    });
    if (isPreferred) return { score: 80, status: 'NEARBY', detail: `${displayCities} is preferred` };
    
    if (jobLoc.isHybrid && canRelocate) return { score: 60, status: 'NEARBY', detail: 'Hybrid + willing to relocate' };
    if (canRelocate) return { score: 60, status: 'DIFFERENT', detail: 'Different city — willing to relocate' };
    return { score: 20, status: 'DIFFERENT', detail: `In ${current || 'unknown city'} — relocation not confirmed` };
  }

  _scoreNoticePeriod(np) {
    if (!np) return { score: 50, status: 'UNKNOWN', detail: 'Not specified', days: 0 };

    const p = np.toLowerCase();
    if (p.includes('immediate') || p.includes('0')) return { score: 100, status: 'IMMEDIATE', detail: 'Immediately available', days: 0 };
    if (p.includes('15') || p.includes('2 week')) return { score: 100, status: 'IMMEDIATE', detail: '2 weeks', days: 15 };
    if (p.includes('30') || p.includes('1 month')) return { score: 90, status: 'ACCEPTABLE', detail: '1 month', days: 30 };
    if (p.includes('45')) return { score: 80, status: 'ACCEPTABLE', detail: '45 days', days: 45 };
    if (p.includes('60') || p.includes('2 month')) return { score: 70, status: 'ACCEPTABLE', detail: '2 months', days: 60 };
    if (p.includes('90') || p.includes('3 month')) return { score: 50, status: 'LONG', detail: '3 months — may delay joining', days: 90 };
    return { score: 30, status: 'LONG', detail: np, days: 120 };
  }

  _scoreDomain(profile, job) {
    // Basic domain matching without AI
    const jobCategory = (job.category || '').toLowerCase();
    const candidateTitle = (profile.currentDesignation || '').toLowerCase();
    const candidateDomain = (profile.domain || '').toLowerCase();

    if (!jobCategory) return { score: 50, status: 'UNKNOWN' };

    // Check for exact or strong overlap
    if (candidateTitle.includes(jobCategory) || candidateDomain.includes(jobCategory) ||
        jobCategory.includes(candidateTitle) || jobCategory.includes(candidateDomain)) {
      return { score: 100, status: 'EXACT' };
    }

    // Related tech domains
    const techDomains = ['software', 'developer', 'engineer', 'frontend', 'backend', 'fullstack', 'mern', 'web', 'mobile', 'devops', 'cloud', 'data', 'ai', 'ml'];
    const isCandidateTech = techDomains.some(d => candidateTitle.includes(d) || candidateDomain.includes(d));
    const isJobTech = techDomains.some(d => jobCategory.includes(d));

    if (isCandidateTech && isJobTech) return { score: 70, status: 'RELATED' };

    return { score: 20, status: 'UNRELATED' };
  }

  _scoreEducation(education, job) {
    const candidateEdu = Array.isArray(education) && education.length > 0 ? education[0]?.degree : null;
    
    if (!candidateEdu) return { score: 50, status: 'UNKNOWN', candidateEducation: 'Not provided' };

    // Basic education scoring — without AI, we can't deeply compare
    const eduLower = candidateEdu.toLowerCase();
    const hasPostgrad = eduLower.includes('master') || eduLower.includes('mba') || eduLower.includes('m.tech') || eduLower.includes('m.s');
    const hasGrad = eduLower.includes('bachelor') || eduLower.includes('b.tech') || eduLower.includes('b.e') || eduLower.includes('bca') || eduLower.includes('b.sc');

    if (hasPostgrad) return { score: 100, status: 'EXCEEDS', candidateEducation: candidateEdu };
    if (hasGrad) return { score: 90, status: 'MEETS', candidateEducation: candidateEdu };
    return { score: 50, status: 'UNKNOWN', candidateEducation: candidateEdu };
  }

  _scoreStability(profile) {
    // Without detailed job history, provide a neutral score
    // This will be scored more accurately by the AI with full resume analysis
    return {
      score: 60,
      averageTenureYears: 0,
      isJobHopper: false,
      risk: 'UNKNOWN',
      detail: 'Requires resume analysis for accurate stability scoring'
    };
  }

  // ── HELPERS ──

  _getMatchLevel(score) {
    if (score >= 80) return 'STRONG';
    if (score >= 65) return 'GOOD';
    if (score >= 50) return 'PARTIAL';
    return 'WEAK';
  }

  _getRecommendation(score) {
    if (score >= 70) return 'SHORTLIST';
    if (score >= 50) return 'HOLD';
    return 'REJECT';
  }

  _getFlags(profile, job) {
    const flags = [];

    if (profile.totalExperience > (job.experienceRange?.max || 0) + 5) {
      flags.push({ type: 'WARNING', message: 'Potentially overqualified' });
    }

    if (profile.expectedSalary > (job.salary?.max || 0) * 1.3) {
      flags.push({ type: 'WARNING', message: 'Salary expectation 30%+ above budget' });
    }

    const np = profile.noticePeriod?.toLowerCase() || '';
    if ((np.includes('90') || np.includes('3 month')) && job.isUrgent) {
      flags.push({ type: 'WARNING', message: 'Long notice period vs urgent requirement' });
    }

    return flags;
  }

  _getAdvice(breakdown) {
    const advice = [];

    if (breakdown.skills?.missingRequired?.length > 0) {
      advice.push(`Missing required skills: ${breakdown.skills.missingRequired.join(', ')}. Verify with candidate.`);
    }

    if (breakdown.salary?.score < 50) {
      advice.push('Salary gap is significant. Check if candidate is flexible.');
    }

    if (breakdown.noticePeriod?.score < 50) {
      advice.push('Long notice period. Ask if early release is possible.');
    }

    if (breakdown.location?.score < 50) {
      advice.push('Location mismatch. Confirm relocation willingness.');
    }

    return advice;
  }
}

module.exports = new CandidateScoringService();