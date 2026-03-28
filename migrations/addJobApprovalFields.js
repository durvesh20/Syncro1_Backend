const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const migrateJobs = async () => {
  try {
    console.log('🔄 Starting job approval fields migration...\n');

    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get jobs collection directly (bypass validation)
    const db = mongoose.connection.db;
    const jobsCollection = db.collection('jobs');

    // Get all jobs
    const jobs = await jobsCollection.find({}).toArray();
    console.log(`📊 Found ${jobs.length} jobs to migrate\n`);

    let updated = 0;
    let skipped = 0;

    for (const job of jobs) {
      const updates = {};
      let needsUpdate = false;

      // Add approvalStatus if missing
      if (!job.approvalStatus) {
        if (job.status === 'ACTIVE') {
          updates.approvalStatus = 'ACTIVE';
        } else if (job.status === 'DRAFT') {
          updates.approvalStatus = 'DRAFT';
        } else if (job.status === 'PENDING_APPROVAL') {
          updates.approvalStatus = 'PENDING_APPROVAL';
        } else {
          updates.approvalStatus = 'DRAFT';
        }
        needsUpdate = true;
      }

      // Initialize edit tracking fields
      if (job.editRequestCount === undefined) {
        updates.editRequestCount = 0;
        updates.approvedEditCount = 0;
        updates.rejectedEditCount = 0;
        needsUpdate = true;
      }

      // Initialize changeHistory if empty
      if (!job.changeHistory || job.changeHistory.length === 0) {
        updates.changeHistory = [{
          changedAt: job.createdAt || new Date(),
          changedBy: job.postedBy,
          changeType: 'CREATED',
          notes: 'Job created (migrated)'
        }];
        needsUpdate = true;
      }

      if (needsUpdate) {
        await jobsCollection.updateOne(
          { _id: job._id },
          { $set: updates }
        );
        updated++;
        console.log(`✅ Updated: "${job.title}" (ID: ${job._id})`);
      } else {
        skipped++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📈 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`   Total jobs:     ${jobs.length}`);
    console.log(`   ✅ Updated:     ${updated}`);
    console.log(`   ⏭️  Skipped:     ${skipped}`);
    console.log('='.repeat(60));
    console.log('\n✨ Migration completed successfully!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
};

migrateJobs();