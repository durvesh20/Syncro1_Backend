// backend/jobs/webhookRetryJob.js
/**
 * Cron job to process failed webhook retries
 * Run via: node jobs/webhookRetryJob.js
 * Or schedule with PM2: pm2 start jobs/webhookRetryJob.js --cron "*/1 * * * *"
 */

const mongoose = require('mongoose');
const path = require('path');
require('../config/env');

const connectDB = require('../config/db');
const webhookService = require('../services/webhookService');

const runJob = async () => {
  try {
    console.log('═'.repeat(60));
    console.log('  WEBHOOK RETRY PROCESSOR JOB');
    console.log('  Started at:', new Date().toISOString());
    console.log('═'.repeat(60));

    await connectDB();
    console.log('✅ Database connected\n');

    const retriedCount = await webhookService.processRetryQueue();

    console.log('\n' + '─'.repeat(60));
    console.log('  JOB COMPLETED');
    console.log(`  Webhooks retried: ${retriedCount}`);
    console.log('  Finished at:', new Date().toISOString());
    console.log('═'.repeat(60) + '\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Webhook retry job failed:', error);
    process.exit(1);
  }
};

runJob();

