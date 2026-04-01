// backend/jobs/payoutEligibilityJob.js - NEW FILE

/**
 * Cron job to check and mark eligible payouts daily
 * Run via: node jobs/payoutEligibilityJob.js
 * Or schedule with PM2: pm2 start jobs/payoutEligibilityJob.js --cron "0 0 * * *"
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const connectDB = require('../config/db');
const commissionService = require('../services/commissionService');

const runJob = async () => {
    try {
        console.log('═'.repeat(60));
        console.log('  PAYOUT ELIGIBILITY CHECK JOB');
        console.log('  Started at:', new Date().toISOString());
        console.log('═'.repeat(60));

        await connectDB();
        console.log('✅ Database connected\n');

        const result = await commissionService.checkEligiblePayouts();

        console.log('\n' + '─'.repeat(60));
        console.log('  JOB COMPLETED');
        console.log(`  Payouts processed: ${result.processed}`);
        console.log('  Finished at:', new Date().toISOString());
        console.log('═'.repeat(60) + '\n');

        process.exit(0);
    } catch (error) {
        console.error('❌ Job failed:', error);
        process.exit(1);
    }
};

runJob();