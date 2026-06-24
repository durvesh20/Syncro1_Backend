// services/marketIntelService.js
// TASK-005 & TASK-006: Layer 2 — Market Intelligence Service & Weekly Cron
const fs = require('fs');
const path = require('path');
const JobPosition = require('../models/JobPosition');
const { getOpenAI, getModel } = require('../config/ai');
const cron = require('node-cron');

/**
 * Generate market intelligence for a JobPosition document using OpenAI.
 * Stored inside JobPosition's marketIntel field.
 *
 * @param {String} positionId - MongoDB ID of JobPosition
 * @param {Object} jobDetails - Title, category, subCategory
 */
async function triggerMarketIntel(positionId, { title, category, subCategory }) {
  const openai = getOpenAI();
  if (!openai) {
    console.warn('[MARKET-INTEL] OpenAI not configured — skipping market intelligence generation');
    return null;
  }

  const position = await JobPosition.findById(positionId);
  if (!position) {
    console.error(`[MARKET-INTEL] Position not found: ${positionId}`);
    return null;
  }

  const detectedDomain = position.parsedRequirements?.detectedDomain || category || 'General';

  console.log(`[MARKET-INTEL] Generating market intelligence for position ${positionId} — "${title}" (${detectedDomain})`);

  // Load template
  const promptPath = path.join(__dirname, '../prompts/market-intel-prompt.txt');
  let template;
  try {
    template = fs.readFileSync(promptPath, 'utf-8');
  } catch (err) {
    console.error('[MARKET-INTEL] Could not load market-intel-prompt.txt template:', err.message);
    return null;
  }

  const prompt = template
    .replace('{{title}}', title || 'Not specified')
    .replace('{{category}}', category || 'Not specified')
    .replace('{{subCategory}}', subCategory || 'Not specified')
    .replace('{{detectedDomain}}', detectedDomain);

  try {
    const model = getModel();
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are a talent market analyst. Output ONLY valid JSON. No text outside JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error('Empty response from OpenAI');
    }

    const marketIntel = JSON.parse(responseText);
    marketIntel.refreshedAt = new Date();

    const updated = await JobPosition.findByIdAndUpdate(
      positionId,
      { $set: { marketIntel, updatedAt: new Date() } },
      { new: true }
    );

    // Log the successful market intel generation (TASK-011)
    const ScoringLog = require('../models/ScoringLog');
    await ScoringLog.create({
      logType: 'MARKET_INTEL',
      positionId: positionId,
      promptSent: prompt,
      rawResponse: responseText,
      success: true
    }).catch(err => console.error('[MARKET-INTEL] Failed to write success log:', err.message));

    console.log(`[MARKET-INTEL] ✅ Market intelligence populated for job position: ${positionId}`);
    return updated;
  } catch (error) {
    console.error(`[MARKET-INTEL] ❌ Failed to generate market intelligence for position ${positionId}: ${error.message}`);

    // Log the failed market intel generation (TASK-011)
    const ScoringLog = require('../models/ScoringLog');
    await ScoringLog.create({
      logType: 'MARKET_INTEL',
      positionId: positionId,
      promptSent: typeof prompt !== 'undefined' ? prompt : 'Prompt building failed',
      rawResponse: typeof responseText !== 'undefined' ? responseText : null,
      success: false,
      error: error.message
    }).catch(err => console.error('[MARKET-INTEL] Failed to write error log:', err.message));

    return null;
  }
}

/**
 * Weekly cron job to refresh market intelligence data for active positions.
 * Triggers every Monday at 2:00 AM.
 * Only refreshes positions that have received candidate applications in the last 30 days.
 */
function startMarketIntelCron() {
  // Cron schedule: "0 2 * * 1" represents every Monday at 2:00 AM
  cron.schedule('0 2 * * 1', async () => {
    console.log('[MARKET-INTEL-CRON] Starting weekly market intelligence refresh...');

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Find jobs that have had candidate applications/submissions in the last 30 days
      const Candidate = require('../models/Candidate');
      const recentCandidateJobs = await Candidate.distinct('job', {
        createdAt: { $gte: thirtyDaysAgo }
      });

      // Find JobPositions that are active, linked to those jobs or created recently,
      // and whose market intel refreshedAt is older than 7 days (or missing)
      const activePositions = await JobPosition.find({
        $or: [
          { jobId: { $in: recentCandidateJobs } },
          { isActive: true }
        ],
        $or: [
          { 'marketIntel.refreshedAt': { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          { 'marketIntel.refreshedAt': { $exists: false } }
        ]
      }).select('_id jobId title category subCategory');

      console.log(`[MARKET-INTEL-CRON] Found ${activePositions.length} positions needing refresh.`);

      for (const pos of activePositions) {
        try {
          await triggerMarketIntel(pos._id, {
            title: pos.title,
            category: pos.category,
            subCategory: pos.subCategory
          });
          // Avoid overloading OpenAI API by adding a 1.5s delay
          await new Promise(r => setTimeout(r, 1500));
        } catch (err) {
          console.error(`[MARKET-INTEL-CRON] Failed to refresh position ${pos._id}: ${err.message}`);
        }
      }

      console.log(`[MARKET-INTEL-CRON] Refresh complete. Processed ${activePositions.length} positions.`);
    } catch (err) {
      console.error(`[MARKET-INTEL-CRON] Error during cron execution: ${err.message}`);
    }
  });
  console.log('[MARKET-INTEL-CRON] Weekly cron job registered successfully.');
}

module.exports = { triggerMarketIntel, startMarketIntelCron };
