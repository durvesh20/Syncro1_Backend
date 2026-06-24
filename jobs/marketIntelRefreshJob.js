// backend/jobs/marketIntelRefreshJob.js
/**
 * Cron job to refresh market intelligence weekly for active positions
 * Run via: node jobs/marketIntelRefreshJob.js
 * Or schedule with PM2: pm2 start jobs/marketIntelRefreshJob.js --cron "0 2 * * 1"
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectDB = require('../config/db');
const JobPosition = require('../models/JobPosition');
const Candidate = require('../models/Candidate');
const { triggerMarketIntel } = require('../services/marketIntelService');

const runJob = async () => {
    try {
        console.log('═'.repeat(60));
        console.log('  WEEKLY MARKET INTELLIGENCE REFRESH JOB');
        console.log('  Started at:', new Date().toISOString());
        console.log('═'.repeat(60));

        await connectDB();
        console.log('✅ Database connected\n');

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        // Find jobs that have had candidate applications/submissions in the last 30 days
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

        console.log(`Found ${activePositions.length} positions needing market intelligence refresh.\n`);

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
            console.error(`❌ Failed to refresh position ${pos._id}: ${err.message}`);
          }
        }

        console.log('\n' + '─'.repeat(60));
        console.log('  JOB COMPLETED');
        console.log(`  Positions refreshed: ${activePositions.length}`);
        console.log('  Finished at:', new Date().toISOString());
        console.log('═'.repeat(60) + '\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Job failed:', error);
        process.exit(1);
    }
};

runJob();
