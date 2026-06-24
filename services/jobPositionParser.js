// services/jobPositionParser.js
// TASK-001 + TASK-002: Layer 1 — JD Parser
// Fires when a job is created. Parses raw JD → structured parsedRequirements.
// Scoring calls then use parsedRequirements JSON (not raw JD text).

const { getOpenAI, getModel } = require('../config/ai');
const JobPosition = require('../models/JobPosition');

/**
 * Parse a Job document → create/update a JobPosition with parsedRequirements.
 * Called async after job creation — does NOT block the job creation response.
 *
 * @param {Object} job - Mongoose Job document
 */
async function parseJobPosition(job) {
  const openai = getOpenAI();
  if (!openai) {
    console.warn('[JD-PARSER] OpenAI not configured — skipping JD parse');
    return null;
  }

  const jobObj = job?.toObject ? job.toObject() : job;

  // Build raw JD text from job fields
  const rawJDText = buildRawJDText(jobObj);

  console.log(`[JD-PARSER] Parsing JD for job: ${jobObj._id} — "${jobObj.title}"`);

  try {
    const prompt = buildJDParserPrompt({
      title:       jobObj.title,
      category:    jobObj.category || '',
      subCategory: jobObj.subCategory || jobObj.employmentType || '',
      rawJDText,
      salary:      jobObj.salary,
      location:    jobObj.location
    });

    const model = getModel();
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role:    'system',
          content: 'You are a job description parser. Output ONLY valid JSON. No text outside JSON.'
        },
        {
          role:    'user',
          content: prompt
        }
      ],
      temperature:     0.1,
      max_tokens:      1500,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(responseText);
    parsed.parsedAt = new Date();

    // Fall back to job form data if Claude didn't detect salary/location
    if (!parsed.salaryBudgetMax && jobObj.salary?.max) parsed.salaryBudgetMax = jobObj.salary.max;
    if (!parsed.salaryBudgetMin && jobObj.salary?.min) parsed.salaryBudgetMin = jobObj.salary.min;
    if (!parsed.remoteAllowed && jobObj.location?.isRemote) parsed.remoteAllowed = true;

    // Upsert JobPosition document
    const jobPosition = await JobPosition.findOneAndUpdate(
      { jobId: jobObj._id },
      {
        $set: {
          jobId:              jobObj._id,
          title:              jobObj.title,
          category:           jobObj.category || '',
          subCategory:        jobObj.subCategory || jobObj.employmentType || '',
          rawJDText,
          salaryBudgetMin:    jobObj.salary?.min,
          salaryBudgetMax:    jobObj.salary?.max,
          location:           [jobObj.location?.city, jobObj.location?.state].filter(Boolean).join(', '),
          remoteAllowed:      jobObj.location?.isRemote || false,
          postedBy:           jobObj.postedBy,
          parsedRequirements: parsed,
          parseStatus:        'SUCCESS',
          parseError:         null,
          updatedAt:          new Date()
        }
      },
      { upsert: true, new: true }
    );

    console.log(`[JD-PARSER] ✅ Parsed job ${jobObj._id} — domain: "${parsed.detectedDomain}"`);
    console.log(`[JD-PARSER]    mustHave: ${parsed.skills?.mustHave?.length || 0} skills`);
    console.log(`[JD-PARSER]    shouldHave: ${parsed.skills?.shouldHave?.length || 0} skills`);

    // Log the successful parsing (TASK-011)
    const ScoringLog = require('../models/ScoringLog');
    await ScoringLog.create({
      logType: 'JD_PARSE',
      positionId: jobPosition._id,
      promptSent: prompt,
      rawResponse: responseText,
      success: true
    }).catch(err => console.error('[JD-PARSER] Failed to create success scoring log:', err.message));

    // Trigger market intelligence generation asynchronously (TASK-005)
    const { triggerMarketIntel } = require('./marketIntelService');
    triggerMarketIntel(jobPosition._id, {
      title: jobPosition.title,
      category: jobPosition.category,
      subCategory: jobPosition.subCategory
    }).catch(err => {
      console.error(`[JD-PARSER] Asynchronous market intelligence trigger failed: ${err.message}`);
    });

    return jobPosition;

  } catch (err) {
    console.error(`[JD-PARSER] ❌ Failed to parse job ${jobObj._id}: ${err.message}`);

    // Save failed status so we can retry later
    const failedPosition = await JobPosition.findOneAndUpdate(
      { jobId: jobObj._id },
      {
        $set: {
          jobId:       jobObj._id,
          title:       jobObj.title,
          category:    jobObj.category || '',
          parseStatus: 'FAILED',
          parseError:  err.message,
          updatedAt:   new Date()
        }
      },
      { upsert: true, new: true }
    );

    // Log the failed parsing (TASK-011)
    const ScoringLog = require('../models/ScoringLog');
    await ScoringLog.create({
      logType: 'JD_PARSE',
      positionId: failedPosition ? failedPosition._id : null,
      promptSent: typeof prompt !== 'undefined' ? prompt : 'Prompt building failed',
      rawResponse: typeof responseText !== 'undefined' ? responseText : null,
      success: false,
      error: err.message
    }).catch(e => console.error('[JD-PARSER] Failed to create error scoring log:', e.message));

    return null;
  }
}

/**
 * Get or create the JobPosition for a given job.
 * Used by scoring service before scoring a candidate.
 * If missing/failed, triggers a fresh parse.
 */
async function getOrParseJobPosition(job) {
  const jobId = job?._id || job;

  const existing = await JobPosition.findOne({ jobId, parseStatus: 'SUCCESS' });
  if (existing) return existing;

  // Not found or failed — re-parse
  const jobDoc = job?.title ? job : await require('../models/Job').findById(jobId);
  if (!jobDoc) return null;

  return parseJobPosition(jobDoc);
}

// ==================== PROMPT BUILDER ====================

function buildJDParserPrompt({ title, category, subCategory, rawJDText, salary, location }) {
  const salaryHint = salary?.min || salary?.max
    ? `Salary budget: ₹${salary.min?.toLocaleString('en-IN') || '?'} – ₹${salary.max?.toLocaleString('en-IN') || '?'} per annum`
    : '';
  const locationHint = location
    ? `Location: ${[location.city, location.state].filter(Boolean).join(', ')}${location.isRemote ? ' (Remote OK)' : ''}`
    : '';

  return `You are Syncro1's job position analysis engine.
Parse the job description below into structured JSON.
This system works for ANY domain — Tech, HR, Sales, Finance, Marketing, Operations, Healthcare, Legal, or any other field.
Do NOT assume a technology stack. Extract only what the JD explicitly states or strongly implies.

RULES:
- Output ONLY valid JSON. No text outside JSON.
- All arrays must have at least one entry if the JD mentions relevant content, or [] if not mentioned.
- Classify skills into three tiers:
    mustHave:   explicitly required ("must have", "required", "mandatory", "essential")
    shouldHave: strongly preferred ("preferred", "good to have", "plus", "advantage")
    niceToHave: optional bonus ("nice to have", "bonus", "optional", "exposure to")
  If a JD does not use these qualifiers, use context and position to infer tier.
- detectedDomain: derive from JD content. Be specific.
    Examples: "Full Stack Web Development", "Talent Acquisition", "B2B Sales",
              "Financial Accounting", "Digital Marketing", "Supply Chain Operations"
- minEducation: use standard levels: "10th Pass", "12th Pass", "Diploma",
    "Bachelor's", "Master's", "MBA", "PhD", "Any Graduate"
- noticePeriodMaxDays: convert to days. "Immediate"=0, "15 days"=15,
    "1 month"=30, "2 months"=60, "3 months"=90. If not mentioned: 60.
- workType: FULLTIME / PARTTIME / CONTRACT / INTERNSHIP
- salaryBudgetMin/Max: annual CTC in INR numbers (not strings). 0 if not mentioned.
- remoteAllowed: true/false

### Job Details:
Title:       ${title}
Category:    ${category}
SubCategory: ${subCategory || 'Not specified'}
${salaryHint}
${locationHint}

### Raw Job Description:
${rawJDText}

### REQUIRED OUTPUT (JSON ONLY):
{
  "skills": {
    "mustHave":   ["skill1", "skill2"],
    "shouldHave": ["skill1", "skill2"],
    "niceToHave": ["skill1", "skill2"]
  },
  "domainKeywords":      ["keyword1", "keyword2"],
  "detectedDomain":      "specific domain string",
  "minExperienceYears":  0,
  "maxExperienceYears":  5,
  "minEducation":        "Bachelor's",
  "noticePeriodMaxDays": 30,
  "workType":            "FULLTIME",
  "salaryBudgetMin":     0,
  "salaryBudgetMax":     0,
  "location":            "city or Remote",
  "remoteAllowed":       false
}`;
}

/**
 * Build a raw JD text string from the Job document fields
 */
function buildRawJDText(jobObj) {
  const parts = [];

  if (jobObj.description) parts.push(`Job Description:\n${jobObj.description}`);

  if (jobObj.requirements?.length > 0) {
    parts.push(`Requirements:\n${jobObj.requirements.map(r => `- ${r}`).join('\n')}`);
  }

  if (jobObj.responsibilities?.length > 0) {
    parts.push(`Responsibilities:\n${jobObj.responsibilities.map(r => `- ${r}`).join('\n')}`);
  }

  if (jobObj.skills?.required?.length > 0) {
    parts.push(`Must-Have Skills: ${jobObj.skills.required.join(', ')}`);
  }

  if (jobObj.skills?.preferred?.length > 0) {
    parts.push(`Preferred Skills: ${jobObj.skills.preferred.join(', ')}`);
  }

  if (jobObj.experienceRange) {
    parts.push(`Experience: ${jobObj.experienceRange.min}–${jobObj.experienceRange.max} years`);
  }

  return parts.join('\n\n');
}

module.exports = { parseJobPosition, getOrParseJobPosition };
