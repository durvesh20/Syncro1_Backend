const Job = require('../models/Job');

class CandidateScoringService {

  /**
   * Score candidate profile against job
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

    // 1. Experience Match (25%)
    const expScore = this._scoreExperience(profile.totalExperience, job.experienceRange);
    scores.experience = {
      score: expScore,
      weight: 25,
      detail: this._experienceDetail(profile.totalExperience, job.experienceRange)
    };
    totalScore += expScore * 0.25;

    // 2. Skills Match (30%)
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
      matchedPreferred: skillResult.matchedPreferred
    };
    totalScore += skillResult.score * 0.30;

    // 3. Salary Fit (15%)
    const salaryScore = this._scoreSalary(profile.expectedSalary, job.salary);
    scores.salary = {
      score: salaryScore.score,
      weight: 15,
      detail: salaryScore.detail
    };
    totalScore += salaryScore.score * 0.15;

    // 4. Location Match (15%)
    const locScore = this._scoreLocation(
      profile.currentLocation,
      profile.preferredLocations,
      profile.canRelocate,
      job.location
    );
    scores.location = {
      score: locScore.score,
      weight: 15,
      detail: locScore.detail
    };
    totalScore += locScore.score * 0.15;

    // 5. Notice Period (15%)
    const npScore = this._scoreNoticePeriod(profile.noticePeriod);
    scores.noticePeriod = {
      score: npScore.score,
      weight: 15,
      detail: npScore.detail
    };
    totalScore += npScore.score * 0.15;

    const overall = Math.round(totalScore);

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
    if (candidateExp === undefined || candidateExp === null || !range) return 50;

    const { min, max } = range;

    if (candidateExp >= min && candidateExp <= max) return 100;
    if (candidateExp > max && candidateExp <= max + 2) return 70;
    if (candidateExp < min && candidateExp >= min - 1) return 60;
    if (candidateExp > max + 4) return 30; // Overqualified
    return 20;
  }

  _experienceDetail(exp, range) {
    if (exp === undefined || !range) return 'Not specified';
    if (exp >= range.min && exp <= range.max) return `${exp} years — within range (${range.min}-${range.max})`;
    if (exp > range.max) return `${exp} years — ${exp - range.max} year(s) above max`;
    return `${exp} years — ${range.min - exp} year(s) below min`;
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

    const reqScore = required.length > 0 ? (matchedRequired.length / required.length) * 80 : 80;
    const prefScore = preferred.length > 0 ? (matchedPreferred.length / preferred.length) * 20 : 20;

    return {
      score: Math.round(reqScore + prefScore),
      matchedRequired,
      missingRequired,
      matchedPreferred
    };
  }

  _scoreSalary(expected, jobSalary) {
    if (!expected || !jobSalary?.max) {
      return { score: 50, detail: 'Salary data not available' };
    }

    const min = jobSalary.min || 0;
    const max = jobSalary.max;

    if (expected >= min && expected <= max) return { score: 100, detail: 'Within budget' };
    if (expected <= max * 1.10) return { score: 70, detail: `${Math.round(((expected / max) - 1) * 100)}% above — may be negotiable` };
    if (expected <= max * 1.25) return { score: 40, detail: `${Math.round(((expected / max) - 1) * 100)}% above budget` };
    if (expected < min * 0.7) return { score: 60, detail: 'Below range — may indicate level mismatch' };
    return { score: 15, detail: `${Math.round(((expected / max) - 1) * 100)}% above — unlikely to fit` };
  }

  _scoreLocation(current, preferred, canRelocate, jobLoc) {
    if (!jobLoc?.city) return { score: 50, detail: 'Job location not specified' };

    const city = jobLoc.city.toLowerCase();

    if (jobLoc.isRemote) return { score: 100, detail: 'Remote — no location constraint' };
    if (current?.toLowerCase().includes(city)) return { score: 100, detail: `Already in ${jobLoc.city}` };
    if (preferred?.some(l => l.toLowerCase().includes(city))) return { score: 85, detail: `${jobLoc.city} is preferred` };
    if (jobLoc.isHybrid && canRelocate) return { score: 70, detail: 'Hybrid + willing to relocate' };
    if (canRelocate) return { score: 60, detail: 'Different city — willing to relocate' };
    return { score: 20, detail: `In ${current || 'unknown city'} — relocation not confirmed` };
  }

  _scoreNoticePeriod(np) {
    if (!np) return { score: 50, detail: 'Not specified' };

    const p = np.toLowerCase();
    if (p.includes('immediate') || p.includes('0')) return { score: 100, detail: 'Immediately available' };
    if (p.includes('15') || p.includes('2 week')) return { score: 90, detail: '2 weeks' };
    if (p.includes('30') || p.includes('1 month')) return { score: 80, detail: '1 month' };
    if (p.includes('60') || p.includes('2 month')) return { score: 55, detail: '2 months' };
    if (p.includes('90') || p.includes('3 month')) return { score: 35, detail: '3 months — may delay joining' };
    return { score: 30, detail: np };
  }

  // ── HELPERS ──

  _getMatchLevel(score) {
    if (score >= 80) return 'STRONG_MATCH';
    if (score >= 60) return 'GOOD_MATCH';
    if (score >= 40) return 'PARTIAL_MATCH';
    return 'WEAK_MATCH';
  }

  _getRecommendation(score) {
    if (score >= 85) return 'Highly Recommended';
    if (score >= 70) return 'Recommended';
    if (score >= 55) return 'Worth Considering';
    if (score >= 40) return 'Below Average';
    return 'Not Recommended';
  }

  _getFlags(profile, job) {
    const flags = [];

    if (profile.totalExperience > (job.experienceRange?.max || 0) + 5) {
      flags.push({ type: 'WARNING', message: 'Potentially overqualified' });
    }

    if (profile.expectedSalary > (job.salary?.max || 0) * 1.3) {
      flags.push({ type: 'RISK', message: 'Salary expectation 30%+ above budget' });
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