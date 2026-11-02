/**
 * Candidate Status Migration - Adapt legacy candidate statuses to modern statuses
 *
 * Mappings:
 *   ADMIN_REVIEW           -> S1_REVIEW
 *   ADMIN_REJECTED         -> S1_REJECTED
 *   UNDER_REVIEW           -> COMPANY_REVIEW
 *   REVIEWING              -> COMPANY_REVIEW
 *   PENDING_ADMIN_APPROVAL -> S1_REVIEW
 *
 * Usage:
 *   node scripts/migrateCandidateStatus.js            -> dry run (safe, no writes)
 *   node scripts/migrateCandidateStatus.js --execute   -> execute migration
 *   node scripts/migrateCandidateStatus.js --rollback  -> rollback changes
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Auto-detect env file
const envCandidates = ['.env', '.env.development', '.env.production'];
const envFile = envCandidates.find(f => fs.existsSync(path.join(__dirname, '..', f)));
if (envFile) {
  require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
  console.log(`Loaded env from: ${envFile}`);
} else {
  require('dotenv').config();
}

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const IS_EXECUTE = process.argv.includes('--execute');
const IS_ROLLBACK = process.argv.includes('--rollback');
const ROLLBACK_FILE = path.join(__dirname, 'migrateCandidateStatus_rollback.json');

const STATUS_ADAPT_MAP = {
  ADMIN_REVIEW: 'S1_REVIEW',
  ADMIN_REJECTED: 'S1_REJECTED',
  PENDING_ADMIN_APPROVAL: 'S1_REVIEW',
  ADMIN_PENDING: 'S1_REVIEW',
  UNDER_REVIEW: 'SENT_TO_CLIENT',
  REVIEWING: 'SENT_TO_CLIENT',
  COMPANY_REVIEW: 'SENT_TO_CLIENT',
  CLIENT_REVIEW: 'SENT_TO_CLIENT',
  SUBMITTED: 'SENT_TO_CLIENT',
  SENT_TO_COMPANY: 'SENT_TO_CLIENT'
};

async function run() {
  if (!MONGO_URI) {
    console.error('❌ MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.');

  const db = mongoose.connection.db;
  const candidatesCollection = db.collection('candidates');

  if (IS_ROLLBACK) {
    if (!fs.existsSync(ROLLBACK_FILE)) {
      console.error(`❌ Rollback file not found at: ${ROLLBACK_FILE}`);
      process.exit(1);
    }
    console.log(`Loading rollback records from ${ROLLBACK_FILE}...`);
    const rollbackData = JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'));
    console.log(`Found ${rollbackData.length} records to rollback.`);

    for (const item of rollbackData) {
      await candidatesCollection.updateOne(
        { _id: new mongoose.Types.ObjectId(item._id) },
        { $set: { status: item.oldStatus } }
      );
    }
    console.log('✅ Rollback completed successfully.');
    process.exit(0);
  }

  // 1. Snapshot affected candidates
  const legacyStatuses = Object.keys(STATUS_ADAPT_MAP);
  const affectedDocs = await candidatesCollection.find(
    { status: { $in: legacyStatuses } },
    { projection: { _id: 1, status: 1, firstName: 1, lastName: 1 } }
  ).toArray();

  console.log(`\nFound ${affectedDocs.length} candidates with legacy status:`);
  const countsByStatus = {};
  affectedDocs.forEach(doc => {
    countsByStatus[doc.status] = (countsByStatus[doc.status] || 0) + 1;
  });
  console.table(countsByStatus);

  if (affectedDocs.length === 0) {
    console.log('✅ No candidates found with legacy statuses. Database is already clean!');
    process.exit(0);
  }

  if (!IS_EXECUTE) {
    console.log('\n🔍 [DRY RUN] No writes performed. To apply changes, run:');
    console.log('   node scripts/migrateCandidateStatus.js --execute\n');
    process.exit(0);
  }

  // 2. Save rollback snapshot
  const rollbackPayload = affectedDocs.map(doc => ({
    _id: doc._id.toString(),
    oldStatus: doc.status
  }));
  fs.writeFileSync(ROLLBACK_FILE, JSON.stringify(rollbackPayload, null, 2), 'utf8');
  console.log(`Saved rollback snapshot to ${ROLLBACK_FILE}`);

  // 3. Perform bulk migration
  let updatedCount = 0;
  for (const [oldStatus, newStatus] of Object.entries(STATUS_ADAPT_MAP)) {
    const result = await candidatesCollection.updateMany(
      { status: oldStatus },
      { $set: { status: newStatus } }
    );
    console.log(`Updated ${result.modifiedCount} records from "${oldStatus}" -> "${newStatus}"`);
    updatedCount += result.modifiedCount;
  }

  console.log(`\n✅ Successfully migrated ${updatedCount} candidates to modern statuses!`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

