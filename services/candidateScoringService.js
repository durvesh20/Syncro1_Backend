const Job = require('../models/Job');
const { matchSkills } = require('./skillMatcher');

class CandidateScoringService {

  /**
   * Score candidate profile against job using the same 8-component weights as the AI engine.
   *
   * Weights (aligned with scoring-prompt.txt v2):
   *   skills:       30%
   *   experience:   20%
   *   location:     10%
   *   salary:       10%
   *   noticePeriod: 10%
   *   stability:    10%
   *   domain:        5%
   *   education:     5%
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

    // 1. Skills Match (30%) — deterministic via skillMatcher
    const jdSkills = {
      mustHave:   job.skills?.required || job.skills?.mustHave || [],
      shouldHave: job.skills?.preferred || job.skills?.shouldHave || [],
      niceToHave: job.skills?.niceToHave || [],
    };
    const skillMatch = matchSkills(profile.skills || [], jdSkills);
    const mustTotal = jdSkills.mustHave.length;
    const mustMatched = skillMatch.mustHaveMatched.length;
    const shouldMatched = skillMatch.shouldHaveMatched.length;
    const shouldTotal = jdSkills.shouldHave.length;
    const niceMatched = skillMatch.niceToHaveMatched.length;
    const niceTotal = jdSkills.niceToHave.length;
    let skillsScore = (mustMatched / Math.max(mustTotal, 1) * 70)
                    + (shouldMatched / Math.max(shouldTotal, 1) * 25)
                    + (niceMatched  / Math.max(niceTotal, 1)  * 5);
    const mustCoverage = mustTotal > 0 ? Math.round(mustMatched / mustTotal * 100) : 100;
    // Apply skill caps
    if (mustCoverage < 30) skillsScore = Math.min(skillsScore, 15);
    else if (mustCoverage < 70) skillsScore = Math.min(skillsScore, 50);
    skillsScore = Math.round(skillsScore);
    scores.skills = {
      score:            skillsScore,
      weight:           30,
      matchedRequired:  skillMatch.mustHaveMatched,
      missingRequired:  skillMatch.mustHaveMissing,
      matchedPreferred: skillMatch.shouldHaveMatched,
      missingPreferred: skillMatch.shouldHaveMissing,
      coveragePercent:  mustCoverage,
      skillGate:        mustCoverage < 30,
    };
    totalScore += skillsScore * 0.30;

    // 2. Experience Match (20%) — uses AI-calculated experience from resume
    // Prefer AI-derived actualExperienceMonths (fractional years), fall back to form-reported values
    const aiExperienceYears = profile.totalExperienceMonths != null
      ? Math.round((profile.totalExperienceMonths / 12) * 10) / 10  // Round to 1 decimal place
      : (profile.experienceYears || null);
    const expScore = this._scoreExperience(aiExperienceYears, job.experienceRange, null);
    scores.experience = {
      score: expScore.score,
      weight: 20,
      totalExperience: profile.totalExperience ? `${profile.totalExperience} years` : 'Not provided',
      relevantExperience: profile.relevantExperience ? `${profile.relevantExperience} years` : 'Not provided',
      actual: expScore.usedForScoring ? `${expScore.usedForScoring} years` : 'Not provided',
      required: job.experienceRange ? `${job.experienceRange.min}-${job.experienceRange.max} years` : 'Not specified',
      status: expScore.status,
      detail: expScore.detail,
      usedForScoringLabel: expScore.usedLabel || 'total'
    };
    totalScore += expScore.score * 0.20;

    // 3. Domain Match (5%)
    const domainScore = this._scoreDomain(profile, job);
    scores.domain = {
      score: domainScore.score,
      weight: 5,
      jobDomain: job.category || 'Not specified',
      candidateDomain: profile.domain || profile.currentDesignation || 'Not specified',
      status: domainScore.status
    };
    totalScore += domainScore.score * 0.05;

    // 4. Education Match (5%)
    const eduScore = this._scoreEducation(profile.education, job);
    let detailedRequired = 'Not specified';
    if (job.education) {
      if (job.education.minimum) {
        detailedRequired = job.education.minimum;
      } else if (job.educationRequirement) {
        detailedRequired = job.educationRequirement;
      }
      
      if (Array.isArray(job.education.preferred) && job.education.preferred.length > 0) {
        const filteredPref = job.education.preferred.filter(p => p && p.trim() !== '');
        if (filteredPref.length > 0) {
          detailedRequired += ` (Preferred: ${filteredPref.join(', ')})`;
        }
      }
    } else if (job.educationRequirement) {
      detailedRequired = job.educationRequirement;
    }

    scores.education = {
      score: eduScore.score,
      weight: 5,
      minimumRequired: detailedRequired,
      candidateEducation: eduScore.candidateEducation || 'Not provided',
      status: eduScore.status
    };
    totalScore += eduScore.score * 0.05;

    // 5. Salary Fit (10%)
    const salaryScore = this._scoreSalary(profile.expectedSalary, job.salary);
    const formatValueToLPA = (val) => {
      if (val == null || val === '') return 'Not specified';
      const num = Number(val);
      if (isNaN(num)) return val;
      if (num >= 100000) {
        return `${(num / 100000).toFixed(1).replace(/\.0$/, '')} LPA`;
      }
      return `${num.toFixed(1).replace(/\.0$/, '')} LPA`;
    };
    scores.salary = {
      score: salaryScore.score,
      weight: 10,
      budget: job.salary ? (job.salary.min && job.salary.max ? `${formatValueToLPA(job.salary.min)} - ${formatValueToLPA(job.salary.max)}` : (job.salary.max ? `<= ${formatValueToLPA(job.salary.max)}` : 'Not specified')) : 'Not specified',
      expected: profile.expectedSalary ? formatValueToLPA(profile.expectedSalary) : 'Not provided',
      deltaPercent: salaryScore.deltaPercent || 0,
      status: salaryScore.status,
      withinBudget: salaryScore.withinBudget
    };
    totalScore += salaryScore.score * 0.10;

        // 6. Location Match (10%)
    const locScore = this._scoreLocation(
      profile.location,
      profile.preferredLocations,
      profile.willingToRelocate,
      job.location
    );
    scores.location = {
      score: locScore.score,
      weight: 10,
      jobLocation: job.location?.city || 'Not specified',
      candidateLocation: profile.location || 'Not specified',
      status: locScore.status,
      detail: locScore.detail
    };
    totalScore += locScore.score * 0.10;

    // 7. Notice Period Fit (10%)
    const npScore = this._scoreNoticePeriod(profile.noticePeriod);
    scores.noticePeriod = {
      score: npScore.score,
      weight: 10,
      actual: profile.noticePeriod || 'Not specified',
      days: npScore.days,
      status: npScore.status
    };
    totalScore += npScore.score * 0.10;

    // 8. Stability Score (10%)
    const stabScore = this._scoreStability(profile);
    scores.stability = {
      score:                      stabScore.score,
      weight:                     10,
      averageTenureYears:         stabScore.last5YearAverageTenureYears || 0,
      totalAverageTenureYears:    stabScore.totalAverageTenureYears    || 0,
      last5YearAverageTenureYears: stabScore.last5YearAverageTenureYears || 0,
      isJobHopper:                stabScore.isJobHopper || false,
      risk:                       stabScore.risk,
      detail:                     stabScore.detail
    };
    totalScore += stabScore.score * 0.10;

    let overall = Math.round(totalScore);
    // Apply skillGate hard-cutoff
    const skillGateTriggered = scores.skills.skillGate;
    if (skillGateTriggered) overall = Math.min(overall, 25);

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

    const rec = skillGateTriggered ? 'REJECT' : this._getRecommendation(overall);

    return {
      overallScore: overall,
      matchLevel: this._getMatchLevel(overall),
      recommendation: rec,
      skillGate: skillGateTriggered,
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

  _scoreExperience(candidateExp, range, relevantExp = null) {
    // Use relevantExperience for scoring if available and valid
    const expUsed = (relevantExp != null && relevantExp >= 0) ? relevantExp : candidateExp;
    const usedLabel = (relevantExp != null && relevantExp >= 0) ? 'relevant' : 'total';

    if (candidateExp === undefined || candidateExp === null || !range) {
      return { score: 50, status: 'UNKNOWN', detail: 'Not specified', usedForScoring: expUsed, usedLabel };
    }

    const { min, max } = range;

    // Within required range
    if (expUsed >= min && expUsed <= max) {
      return { score: 100, status: 'MEETS', detail: `${expUsed} years (${usedLabel}) — within range (${min}-${max})`, usedForScoring: expUsed, usedLabel };
    }

    // Below minimum
    if (expUsed < min) {
      const gap = min - expUsed;
      if (gap <= 1)  return { score: 70, status: 'BELOW', detail: `${expUsed} years (${usedLabel}) — ${gap} year(s) below min`, usedForScoring: expUsed, usedLabel };
      if (gap <= 3)  return { score: 40, status: 'BELOW', detail: `${expUsed} years (${usedLabel}) — ${gap} year(s) below min`, usedForScoring: expUsed, usedLabel };
                     return { score: 20, status: 'BELOW', detail: `${expUsed} years (${usedLabel}) — significant gap (${gap} years below min)`, usedForScoring: expUsed, usedLabel };
    }

    // Above maximum (overqualified)
    const excess = expUsed - max;
    if (excess <= 2) return { score: 70, status: 'EXCEEDS', detail: `${expUsed} years (${usedLabel}) — ${excess} year(s) above max`, usedForScoring: expUsed, usedLabel };
    if (excess <= 4) return { score: 50, status: 'EXCEEDS', detail: `${expUsed} years (${usedLabel}) — ${excess} years above max, moderately overqualified`, usedForScoring: expUsed, usedLabel };
                     return { score: 30, status: 'EXCEEDS', detail: `${expUsed} years (${usedLabel}) — overqualified by ${excess} years`, usedForScoring: expUsed, usedLabel };
  }


  _normalizeSalaryToLPA(val) {
    if (val == null || val === '') return 0;
    const num = Number(String(val).replace(/,/g, ''));
    if (isNaN(num)) return 0;
    if (num < 100) return num;
    return num / 100000;
  }

  _scoreSalary(expected, jobSalary) {
    if (expected == null || expected === '' || !jobSalary?.max) {
      return { score: 50, status: 'UNKNOWN', detail: 'Salary data not available', deltaPercent: 0, withinBudget: false };
    }

    const normExpected = this._normalizeSalaryToLPA(expected);
    const normMax = this._normalizeSalaryToLPA(jobSalary.max);
    const normMin = jobSalary.min ? this._normalizeSalaryToLPA(jobSalary.min) : 0;

    const deltaPercent = normMax > 0 ? Math.round(((normExpected / normMax) - 1) * 100) : 0;

    if (normMin > 0 && normExpected < normMin) {
      return { score: 100, status: 'BELOW_BUDGET', detail: 'Below budget minimum', deltaPercent, withinBudget: true };
    }
    if (normExpected <= normMax) {
      return { score: 100, status: 'WITHIN', detail: 'Within budget', deltaPercent, withinBudget: true };
    }
    if (normExpected <= normMax * 1.10) {
      return { score: 80, status: 'SLIGHTLY_OVER', detail: `${deltaPercent}% above — may be negotiable`, deltaPercent, withinBudget: false };
    }
    if (normExpected <= normMax * 1.20) {
      return { score: 60, status: 'OVER', detail: `${deltaPercent}% above budget`, deltaPercent, withinBudget: false };
    }
    if (normExpected <= normMax * 1.30) {
      return { score: 40, status: 'OVER', detail: `${deltaPercent}% above budget`, deltaPercent, withinBudget: false };
    }
    return { score: 0, status: 'OVER', detail: `${deltaPercent}% above — unlikely to fit`, deltaPercent, withinBudget: false };
  }

  _scoreLocation(current, preferred, willingToRelocate, jobLoc) {
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
    
    if (jobLoc.isHybrid && willingToRelocate) return { score: 60, status: 'NEARBY', detail: 'Hybrid + willing to relocate' };
    if (willingToRelocate) return { score: 60, status: 'DIFFERENT', detail: 'Different city — willing to relocate' };
    return { score: 20, status: 'DIFFERENT', detail: `In ${current || 'unknown city'} — relocation not confirmed` };
  }

  _scoreNoticePeriod(np) {
    if (!np) return { score: 50, status: 'UNKNOWN', detail: 'Not specified', days: 0 };

    const p = np.toLowerCase();
    if (p.includes('immediate') || p.includes('0')) return { score: 100, status: 'IMMEDIATE', detail: 'Immediately available', days: 0 };
    if (p.includes('15') || p.includes('2 week')) return { score: 100, status: 'WITHIN', detail: '2 weeks', days: 15 };
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
    const candidateDegrees = (Array.isArray(education) ? education : [])
      .map(e => e?.degree)
      .filter(d => d && typeof d === 'string');

    const primaryDegree = candidateDegrees[0] || (typeof education === 'string' ? education : null);
    if (!primaryDegree && candidateDegrees.length === 0) {
      return { score: 50, status: 'UNKNOWN', candidateEducation: 'Not provided' };
    }

    const EDU_MAP = {
      'btech': ['btech', 'bacheloroftechnology', 'be', 'bachelorofengineering'],
      'bacheloroftechnology': ['btech', 'bacheloroftechnology', 'be', 'bachelorofengineering'],
      'be': ['be', 'bachelorofengineering', 'btech', 'bacheloroftechnology'],
      'bachelorofengineering': ['be', 'bachelorofengineering', 'btech', 'bacheloroftechnology'],
      'mtech': ['mtech', 'masteroftechnology', 'me', 'masterofengineering'],
      'masteroftechnology': ['mtech', 'masteroftechnology', 'me', 'masterofengineering'],
      'me': ['me', 'masterofengineering', 'mtech', 'masteroftechnology'],
      'masterofengineering': ['me', 'masterofengineering', 'mtech', 'masteroftechnology'],
      'mca': ['mca', 'masterofcomputerapplications'],
      'masterofcomputerapplications': ['mca', 'masterofcomputerapplications'],
      'bca': ['bca', 'bachelorofcomputerapplications'],
      'bachelorofcomputerapplications': ['bca', 'bachelorofcomputerapplications'],
      'mba': ['mba', 'masterofbusinessadministration'],
      'masterofbusinessadministration': ['mba', 'masterofbusinessadministration'],
      'bsc': ['bsc', 'bachelorofscience'],
      'bachelorofscience': ['bsc', 'bachelorofscience'],
      'msc': ['msc', 'masterofscience'],
      'masterofscience': ['msc', 'masterofscience'],
      'bba': ['bba', 'bachelorofbusinessadministration'],
      'bachelorofbusinessadministration': ['bba', 'bachelorofbusinessadministration'],
      'bcom': ['bcom', 'bachelorofcommerce'],
      'bachelorofcommerce': ['bcom', 'bachelorofcommerce'],
      'mcom': ['mcom', 'masterofcommerce'],
      'masterofcommerce': ['mcom', 'masterofcommerce'],
      'phd': ['phd', 'doctorofphilosophy'],
      'doctorofphilosophy': ['phd', 'doctorofphilosophy']
    };

    const normalizeEduString = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    };

    const degreesMatch = (candDegree, jobDegree) => {
      if (!candDegree || !jobDegree) return false;
      const normCand = normalizeEduString(candDegree);
      const normJob = normalizeEduString(jobDegree);
      if (normCand === normJob) return true;
      const candEquivs = EDU_MAP[normCand] || [normCand];
      const jobEquivs = EDU_MAP[normJob] || [normJob];
      for (const c of candEquivs) {
        if (jobEquivs.includes(c)) return true;
      }
      if (normCand.includes(normJob) || normJob.includes(normCand)) {
        return true;
      }
      return false;
    };

    const preferredList = (job?.education && Array.isArray(job.education.preferred))
      ? job.education.preferred.filter(p => p && p.trim() !== '')
      : [];
    const minEdu = job?.education?.minimum || job?.educationRequirement || '';

    // Check candidate degrees against job requirements
    const degreesToCheck = candidateDegrees.length > 0 ? candidateDegrees : [primaryDegree];

    if (preferredList.length > 0) {
      // Check if any candidate degree matches any preferred education
      const matchesPreferred = degreesToCheck.some(candDeg => 
        preferredList.some(prefDeg => degreesMatch(candDeg, prefDeg))
      );
      if (matchesPreferred) {
        return { score: 100, status: 'EXCEEDS', candidateEducation: primaryDegree };
      }

      // Check if any candidate degree matches minimum education
      if (minEdu) {
        const matchesMin = degreesToCheck.some(candDeg => degreesMatch(candDeg, minEdu));
        if (matchesMin) {
          return { score: 85, status: 'MEETS', candidateEducation: primaryDegree };
        }
        return { score: 50, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
      }

      return { score: 50, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
    }

    // No preferred education specified, check against minimum
    if (minEdu) {
      const matchesMin = degreesToCheck.some(candDeg => degreesMatch(candDeg, minEdu));
      if (matchesMin) {
        return { score: 100, status: 'MEETS', candidateEducation: primaryDegree };
      }
      return { score: 50, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
    }

    // Default fallback if no requirements specified
    return { score: 100, status: 'MEETS', candidateEducation: primaryDegree };
  }

  _scoreStability(profile) {
    let rawHistory = profile.jobHistory || profile.experience;
    if (!Array.isArray(rawHistory)) {
      rawHistory = [];
    }

    const jobHistory = rawHistory.map(job => {
      if (job.fromYear !== undefined || job.toYear !== undefined) {
        return job;
      }
      
      let fromYear = null;
      let fromMonth = null;
      if (job.startDate) {
        const parts = String(job.startDate).split('-');
        fromYear = parseInt(parts[0], 10);
        if (parts[1]) {
          fromMonth = parseInt(parts[1], 10);
        }
      }
      
      let toYear = null;
      let toMonth = null;
      let ongoing = !!job.isCurrent;
      if (job.endDate) {
        const parts = String(job.endDate).split('-');
        toYear = parseInt(parts[0], 10);
        if (parts[1]) {
          toMonth = parseInt(parts[1], 10);
        }
      }

      return {
        fromYear,
        fromMonth: fromMonth != null ? fromMonth : 0,
        toYear,
        toMonth: toMonth != null ? toMonth : 11,
        ongoing,
        durationMonths: job.durationMonths
      };
    });

    if (jobHistory.length === 0) {
      // No job history available yet (resume not parsed at pre-submission stage) — neutral fallback
      return {
        score: 60,
        totalAverageTenureYears: 0,
        last5YearAverageTenureYears: 0,
        isJobHopper: false,
        risk: 'UNKNOWN',
        detail: 'Requires resume analysis for accurate stability scoring'
      };
    }

    // ── Total career average (informational only, not scored) ─────────
    const totalMonths = jobHistory.reduce((sum, j) => sum + (j.durationMonths || 0), 0);
    const totalAvgTenureYears = jobHistory.length > 0 ? (totalMonths / jobHistory.length) / 12 : 0;

    // ── Last 5 years window ───────────────────────────────────
    const now = new Date();
    const windowStart = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());

    let last5Months = 0;
    let last5JobCount = 0;

    jobHistory.forEach(job => {
      const jobEnd   = job.toYear   ? new Date(job.toYear,   (job.toMonth   || 11), 1) : now;
      const jobStart = job.fromYear ? new Date(job.fromYear, (job.fromMonth || 0),  1) : jobEnd;

      // Skip jobs that ended entirely before the 5-year window
      if (jobEnd < windowStart) return;

      const clippedStart  = jobStart < windowStart ? windowStart : jobStart;
      const clippedMonths = Math.max(
        0,
        (jobEnd.getFullYear()  - clippedStart.getFullYear())  * 12 +
        (jobEnd.getMonth()     - clippedStart.getMonth())
      );

      // Fall back to durationMonths when date fields are absent
      last5Months   += clippedMonths || job.durationMonths || 0;
      last5JobCount += 1;
    });

    const last5AvgTenureYears  = last5JobCount > 0 ? (last5Months / last5JobCount) / 12 : totalAvgTenureYears;
    const last5AvgTenureMonths = last5AvgTenureYears * 12;

    const hasOnlyOneJob = jobHistory.length === 1 || last5JobCount === 1;

    // ── Score on last-5-year average tenure ───────────────────────
    let score;
    if (hasOnlyOneJob) {
      score = 100;
    } else if (last5AvgTenureMonths >= 36) {
      score = 100;
    } else if (last5AvgTenureMonths >= 24) {
      score = 80;
    } else if (last5AvgTenureMonths >= 18) {
      score = 60;
    } else if (last5AvgTenureMonths >= 12) {
      score = 40;
    } else if (last5AvgTenureMonths >= 6) {
      score = 20;
    } else {
      score = 0;
    }

    return {
      score,
      totalAverageTenureYears:     Math.round(totalAvgTenureYears  * 10) / 10,
      last5YearAverageTenureYears: Math.round(last5AvgTenureYears  * 10) / 10,
      isJobHopper:  hasOnlyOneJob ? false : last5AvgTenureMonths < 12,
      risk: hasOnlyOneJob ? 'LOW' : (last5AvgTenureMonths < 12 ? 'HIGH' : last5AvgTenureMonths < 24 ? 'MEDIUM' : 'LOW'),
      detail: hasOnlyOneJob 
        ? `Only 1 job held in recent career — stable tenure`
        : `Total career avg ${totalAvgTenureYears.toFixed(1)}yrs, last 5 years avg ${last5AvgTenureYears.toFixed(1)}yrs — scored on recent stability`
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