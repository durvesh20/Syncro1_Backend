const Job = require('../models/Job');
const { matchSkills } = require('./skillMatcher');
const { matchCandidateCityToJobCities } = require('./cityNormalizer');
const { EDU_LEVELS, getEduLevel } = require('./educationUtils');

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
      mustHave: job.skills?.required || job.skills?.mustHave || [],
      shouldHave: job.skills?.preferred || job.skills?.shouldHave || [],
      niceToHave: job.skills?.niceToHave || [],
    };
    const skillMatch = matchSkills(profile.skills || [], jdSkills);
    const mustTotal = jdSkills.mustHave.length;
    const mustMatched = skillMatch.mustHaveMatched.length;
    let skillsScore = (mustMatched / Math.max(mustTotal, 1)) * 100;
    const mustCoverage = mustTotal > 0 ? Math.round((mustMatched / mustTotal) * 100) : 100;
    // Apply skill gate cap if coverage < 30%
    if (mustCoverage < 30) skillsScore = Math.min(skillsScore, 15);
    skillsScore = Math.round(skillsScore);
    const shouldTotal = jdSkills.shouldHave.length;
    const shouldMatched = skillMatch.shouldHaveMatched.length;
    const preferredBonus = (shouldTotal > 0 && (shouldMatched / shouldTotal) >= 0.5) ? 5 : 0;

    scores.skills = {
      score: skillsScore,
      weight: 30,
      matchedRequired: skillMatch.mustHaveMatched,
      missingRequired: skillMatch.mustHaveMissing,
      matchedPreferred: skillMatch.shouldHaveMatched,
      missingPreferred: skillMatch.shouldHaveMissing,
      coveragePercent: mustCoverage,
      preferredBonus: preferredBonus,
      skillGate: mustCoverage < 30,
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
      detail: locScore.detail,
      willingToRelocate: profile.willingToRelocate ?? null
    };
    totalScore += locScore.score * 0.10;

    // 7. Notice Period Fit (10%)
    const npScore = this._scoreNoticePeriod(profile.noticePeriod, job?.expectedJoiningDate);
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
      score: stabScore.score,
      weight: 10,
      averageTenureYears: stabScore.last5YearAverageTenureYears || 0,
      totalAverageTenureYears: stabScore.totalAverageTenureYears || 0,
      last5YearAverageTenureYears: stabScore.last5YearAverageTenureYears || 0,
      isJobHopper: stabScore.isJobHopper || false,
      risk: stabScore.risk,
      detail: stabScore.detail
    };
    totalScore += stabScore.score * 0.10;

    let overall = Math.min(100, Math.round(totalScore) + preferredBonus);
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
      if (gap <= 1) return { score: 70, status: 'BELOW', detail: `${expUsed} years (${usedLabel}) — ${gap} year(s) below min`, usedForScoring: expUsed, usedLabel };
      if (gap <= 3) return { score: 40, status: 'BELOW', detail: `${expUsed} years (${usedLabel}) — ${gap} year(s) below min`, usedForScoring: expUsed, usedLabel };
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

    const jobCities = Array.isArray(jobLoc.city) ? jobLoc.city : [jobLoc.city];
    const displayCities = jobCities.join(', ');

    // Remote jobs — no location constraint
    if (jobLoc.isRemote || matchCandidateCityToJobCities('remote', jobCities)) {
      return { score: 100, status: 'EXACT', detail: 'Remote — no location constraint' };
    }

    // Exact city match with alias normalization (Bengaluru == Bangalore, Bombay == Mumbai…)
    if (current && matchCandidateCityToJobCities(current, jobCities)) {
      return { score: 100, status: 'EXACT', detail: `Already in ${displayCities}` };
    }

    // Preferred locations match
    const prefMatch = (preferred || []).some(pref => matchCandidateCityToJobCities(pref, jobCities));
    if (prefMatch) {
      return { score: 80, status: 'NEARBY', detail: `${displayCities} is a preferred location` };
    }

    if (jobLoc.isHybrid && willingToRelocate) {
      return { score: 60, status: 'NEARBY', detail: 'Hybrid role — willing to relocate' };
    }
    if (willingToRelocate) {
      return { score: 60, status: 'DIFFERENT', detail: 'Different city — willing to relocate' };
    }
    return { score: 20, status: 'DIFFERENT', detail: `In ${current || 'unknown city'} — relocation not confirmed` };
  }

  _scoreNoticePeriod(candNp, companyNoticeInput) {
    let companyList = [];
    if (Array.isArray(companyNoticeInput)) {
      companyList = companyNoticeInput;
    } else if (typeof companyNoticeInput === 'string' && companyNoticeInput.trim() !== '') {
      companyList = [companyNoticeInput];
    } else {
      companyList = ['Any'];
    }

    const candStr = (candNp || 'Immediate').toString().trim();

    const daysMap = {
      'immediate': { label: 'Immediate', days: 0 },
      '0-15 days': { label: '0-15 Days', days: 15 },
      '15 days': { label: '0-15 Days', days: 15 },
      '2 week': { label: '0-15 Days', days: 15 },
      '15-30 days': { label: '15-30 Days', days: 30 },
      '30 days': { label: '15-30 Days', days: 30 },
      '1 month': { label: '15-30 Days', days: 30 },
      '30-45 days': { label: '30-45 Days', days: 45 },
      '45 days': { label: '30-45 Days', days: 45 },
      '45-60 days': { label: '45-60 Days', days: 60 },
      '60 days': { label: '45-60 Days', days: 60 },
      '2 month': { label: '45-60 Days', days: 60 },
      '60-75 days': { label: '60-75 Days', days: 75 },
      '75 days': { label: '60-75 Days', days: 75 },
      '75-90 days': { label: '75-90 Days', days: 90 },
      '90 days': { label: '75-90 Days', days: 90 },
      '3 month': { label: '75-90 Days', days: 90 },
      'more than 90 days': { label: '75-90 Days', days: 90 }
    };

    const candLower = candStr.toLowerCase();
    let matchedCand = null;
    for (const key of Object.keys(daysMap)) {
      if (candLower.includes(key)) {
        matchedCand = daysMap[key];
        break;
      }
    }
    if (!matchedCand) {
      if (candLower.includes('serving')) matchedCand = { label: 'Currently Serving', days: 15 };
      else matchedCand = { label: candStr, days: 30 };
    }

    const candDays = matchedCand.days;

    if (companyList.includes('Any') || companyList.length === 0) {
      return { score: 100, status: 'IMMEDIATE', detail: 'Company accepts any notice period', days: candDays, actual: candStr };
    }

    const hasCurrentlyServing = companyList.some(o => o.toLowerCase().includes('serving'));
    const specificOptions = companyList.filter(o => o !== 'Any' && !o.toLowerCase().includes('serving'));

    if (specificOptions.length === 0 && hasCurrentlyServing) {
      return {
        score: 50,
        status: 'ACCEPTABLE',
        detail: `Company requested currently serving candidates — candidate assigned 50 points (${candStr})`,
        days: candDays,
        actual: candStr
      };
    }

    const getOptionDays = (optStr) => {
      const ol = optStr.toLowerCase();
      for (const k of Object.keys(daysMap)) {
        if (ol.includes(k)) return daysMap[k].days;
      }
      return 30;
    };

    const maxAllowedDays = specificOptions.length > 0 ? Math.max(...specificOptions.map(getOptionDays)) : 30;

    const isExactMatch = specificOptions.some(o => {
      const oDays = getOptionDays(o);
      return oDays === candDays;
    });

    if (isExactMatch || candDays <= maxAllowedDays) {
      return {
        score: 100,
        status: 'IMMEDIATE',
        detail: `Candidate notice (${candStr}) meets company requirement`,
        days: candDays,
        actual: candStr
      };
    }

    const diffDays = candDays - maxAllowedDays;

    if (hasCurrentlyServing) {
      if (diffDays <= 30) {
        return {
          score: 30,
          status: 'LONG',
          detail: `Notice period (${candStr}) exceeds company range (${maxAllowedDays}d max), adjusted to 30 due to Currently Serving option`,
          days: candDays,
          actual: candStr
        };
      }
      return {
        score: 15,
        status: 'LONG',
        detail: `Notice period (${candStr}) exceeds company limit (${maxAllowedDays}d max)`,
        days: candDays,
        actual: candStr
      };
    } else {
      if (diffDays <= 15) {
        return {
          score: 40,
          status: 'ACCEPTABLE',
          detail: `Notice period (${candStr}) slightly exceeds company range (${maxAllowedDays}d max)`,
          days: candDays,
          actual: candStr
        };
      } else if (diffDays <= 30) {
        return {
          score: 20,
          status: 'LONG',
          detail: `Notice period (${candStr}) exceeds company range (${maxAllowedDays}d max)`,
          days: candDays,
          actual: candStr
        };
      }
      return {
        score: 0,
        status: 'LONG',
        detail: `Notice period (${candStr}) far exceeds requirement`,
        days: candDays,
        actual: candStr
      };
    }
  }

  _scoreDomain(profile, job) {
    const jobCategory = (job.category || '').toLowerCase().trim();
    const jobSubCategory = (job.subCategory || '').toLowerCase().trim();
    const candidateDomain = (profile.domain || '').toLowerCase().trim();
    const candidateDesignation = (profile.currentDesignation || '').toLowerCase().trim();

    const jobDomainLabel = job.category || 'Unknown';
    const candDomainLabel = profile.domain || profile.currentDesignation || 'Unknown';

    if (!jobCategory && !jobSubCategory) {
      return { score: 50, status: 'UNKNOWN', jobDomain: jobDomainLabel, candidateDomain: candDomainLabel };
    }
    if (!candidateDomain && !candidateDesignation) {
      return { score: 50, status: 'UNKNOWN', jobDomain: jobDomainLabel, candidateDomain: candDomainLabel };
    }

    // Exact match on category
    if (candidateDomain && (candidateDomain === jobCategory || candidateDomain === jobSubCategory)) {
      return { score: 100, status: 'EXACT', jobDomain: jobDomainLabel, candidateDomain: candDomainLabel };
    }

    // Partial overlap — candidate domain appears in job text or vice versa
    const jobText = `${jobCategory} ${jobSubCategory}`;
    const candText = `${candidateDomain} ${candidateDesignation}`;
    if (
      (candidateDomain && jobText.includes(candidateDomain)) ||
      (jobCategory && candText.includes(jobCategory)) ||
      (jobSubCategory && candText.includes(jobSubCategory))
    ) {
      return { score: 80, status: 'RELATED', jobDomain: jobDomainLabel, candidateDomain: candDomainLabel };
    }

    return { score: 50, status: 'UNKNOWN', jobDomain: jobDomainLabel, candidateDomain: candDomainLabel };
  }

  _scoreEducation(education, job) {
    const candidateDegrees = (Array.isArray(education) ? education : [])
      .map(e => e?.degree)
      .filter(d => d && typeof d === 'string');

    const primaryDegree = candidateDegrees[0] || (typeof education === 'string' ? education : null);
    if (!primaryDegree && candidateDegrees.length === 0) {
      return { score: 50, status: 'UNKNOWN', candidateEducation: 'Not provided' };
    }

    const preferredList = (job?.education && Array.isArray(job.education.preferred))
      ? job.education.preferred.filter(p => p && p.trim() !== '')
      : [];
    const minEdu = job?.education?.minimum || job?.educationRequirement || '';

    const degreesToCheck = candidateDegrees.length > 0 ? candidateDegrees : [primaryDegree];
    const candHighestLevel = Math.max(...degreesToCheck.map(d => getEduLevel(d)));

    // Step 1 — Match preferred first (any candidate degree >= any preferred degree level)
    if (preferredList.length > 0) {
      const prefHighestLevel = Math.max(...preferredList.map(p => getEduLevel(p)));
      if (prefHighestLevel !== -1 && candHighestLevel >= prefHighestLevel) {
        return { score: 100, status: 'EXCEEDS', candidateEducation: primaryDegree };
      }
    }

    // Step 2 — Match against minimum requirement
    if (minEdu) {
      const minLevel = getEduLevel(minEdu);
      if (minLevel === -1) {
        // Cannot parse minimum requirement string → give neutral pass
        return { score: 75, status: 'MEETS', candidateEducation: primaryDegree };
      }
        // Meets minimum requirement
        return { score: 100, status: 'MEETS', candidateEducation: primaryDegree };
      // Below minimum — grade by distance
      const diff = minLevel - candHighestLevel;
      if (diff === 1) return { score: 60, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
      if (diff === 2) return { score: 30, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
      return { score: 0, status: 'BELOW_MINIMUM', candidateEducation: primaryDegree };
    }

    // No education requirements specified → any degree is fine
    return { score: 100, status: 'MEETS', candidateEducation: primaryDegree };
  }



  _scoreStability(profile) {
    let rawHistory = (Array.isArray(profile.jobHistory) && profile.jobHistory.length > 0)
      ? profile.jobHistory
      : (Array.isArray(profile.experience) ? profile.experience : []);

    if (!Array.isArray(rawHistory)) rawHistory = [];

    if (rawHistory.length === 0) {
      return {
        score: 60,
        totalAverageTenureYears: 0,
        last5YearAverageTenureYears: 0,
        averageTenureYears: 0,
        isJobHopper: false,
        risk: 'UNKNOWN',
        detail: 'Requires resume analysis for accurate stability scoring'
      };
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Helper to calculate job duration in months cleanly
    const computeDuration = (j) => {
      if (typeof j.durationMonths === 'number' && j.durationMonths > 0) {
        return j.durationMonths;
      }
      let sy = j.fromYear || (j.startDate ? parseInt(String(j.startDate).split('-')[0], 10) : null);
      let sm = j.fromMonth || (j.startDate && String(j.startDate).includes('-') ? parseInt(String(j.startDate).split('-')[1], 10) : 1);
      if (!sy || isNaN(sy)) return 12;
      if (!sm || isNaN(sm)) sm = 1;

      let isCurrent = !!(j.ongoing || j.isCurrent);
      let ey = isCurrent ? currentYear : (j.toYear || (j.endDate ? parseInt(String(j.endDate).split('-')[0], 10) : null));
      let em = isCurrent ? currentMonth : (j.toMonth || (j.endDate && String(j.endDate).includes('-') ? parseInt(String(j.endDate).split('-')[1], 10) : 12));
      if (!ey || isNaN(ey)) ey = currentYear;
      if (!em || isNaN(em)) em = 12;

      return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
    };

    const jobs = rawHistory.map(j => {
      let fromYear = j.fromYear || (j.startDate ? parseInt(String(j.startDate).split('-')[0], 10) : null);
      let fromMonth = j.fromMonth || (j.startDate && String(j.startDate).includes('-') ? parseInt(String(j.startDate).split('-')[1], 10) : 1);
      let ongoing = !!(j.ongoing || j.isCurrent);
      let toYear = ongoing ? currentYear : (j.toYear || (j.endDate ? parseInt(String(j.endDate).split('-')[0], 10) : null));
      let toMonth = ongoing ? currentMonth : (j.toMonth || (j.endDate && String(j.endDate).includes('-') ? parseInt(String(j.endDate).split('-')[1], 10) : 12));

      return {
        ...j,
        fromYear,
        fromMonth: fromMonth || 1,
        toYear: toYear || currentYear,
        toMonth: toMonth || 12,
        ongoing,
        durMonths: computeDuration(j)
      };
    });

    const totalDurationMonths = jobs.reduce((sum, j) => sum + j.durMonths, 0);
    const totalJobsCount = jobs.length;
    const totalCareerYears = totalDurationMonths / 12;
    const totalAvgTenureYears = Math.round((totalCareerYears / totalJobsCount) * 10) / 10;

    // Rule 3: Single company in career (0 job hops) -> 100 score, LOW risk
    if (totalJobsCount === 1) {
      const last5Avg = totalCareerYears <= 5.0 ? totalAvgTenureYears : 5.0;
      return {
        score: 100,
        totalAverageTenureYears: Math.round(totalCareerYears * 10) / 10,
        last5YearAverageTenureYears: Math.round(last5Avg * 10) / 10,
        averageTenureYears: Math.round(last5Avg * 10) / 10,
        isJobHopper: false,
        risk: 'LOW',
        detail: 'Single company in career (0 job hops) — maximum stability'
      };
    }

    let last5AvgTenureYears;

    // Rule 1: Candidate total exp <= 5 years -> last 5 yr avg MUST EQUAL total career avg
    if (totalCareerYears <= 5.0) {
      last5AvgTenureYears = totalAvgTenureYears;
    } else {
      // Rule 2: Candidate total exp > 5 years -> compute 5-year window average
      const windowStartYear = currentYear - 5;
      let last5Months = 0;
      let last5JobsCount = 0;

      jobs.forEach(job => {
        if (job.toYear && job.toYear < windowStartYear) return; // ended prior to 5-year window

        const effectiveStartYear = Math.max(windowStartYear, job.fromYear || windowStartYear);
        const effectiveStartMonth = (effectiveStartYear === windowStartYear && (job.fromYear || 0) < windowStartYear) ? currentMonth : (job.fromMonth || 1);

        const endY = job.ongoing ? currentYear : (job.toYear || currentYear);
        const endM = job.ongoing ? currentMonth : (job.toMonth || 12);

        const durationInWindow = Math.max(1, (endY - effectiveStartYear) * 12 + (endM - effectiveStartMonth) + 1);
        last5Months += Math.min(60, durationInWindow);
        last5JobsCount += 1;
      });

      const calculatedLast5 = last5JobsCount > 0 ? (last5Months / last5JobsCount) / 12 : totalAvgTenureYears;
      last5AvgTenureYears = Math.min(5.0, Math.round(calculatedLast5 * 10) / 10);
    }

    let score;
    if (last5AvgTenureYears >= 3.0) score = 100;
    else if (last5AvgTenureYears >= 2.0) score = 80;
    else if (last5AvgTenureYears >= 1.5) score = 60;
    else if (last5AvgTenureYears >= 1.0) score = 40;
    else score = 20;

    const isJobHopper = last5AvgTenureYears < 1.0;
    const risk = isJobHopper ? 'HIGH' : (last5AvgTenureYears < 2.0 ? 'MEDIUM' : 'LOW');

    return {
      score,
      totalAverageTenureYears: totalAvgTenureYears,
      last5YearAverageTenureYears: last5AvgTenureYears,
      averageTenureYears: last5AvgTenureYears,
      isJobHopper,
      risk,
      detail: `Full career avg ${totalAvgTenureYears.toFixed(1)}y, last 5 years avg ${last5AvgTenureYears.toFixed(1)}y`
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

const _instance = new CandidateScoringService();
module.exports = _instance;