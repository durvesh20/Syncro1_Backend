/**
 * Job Status Migration - Merge `approvalStatus` into unified `status`
 *
 * Usage:
 *   node scripts/migrateJobStatus.js             -> dry run (safe, no writes)
 *   node scripts/migrateJobStatus.js --execute    -> actually migrate
 *   node scripts/migrateJobStatus.js --rollback   -> undo migration
 *
 * Safety features:
 *   1. Dry-run by default - must pass --execute to write anything
 *   2. Pre-migration snapshot printed before any writes
 *   3. Rollback file written to disk before migrating (restore anytime)
 *   4. Post-migration validation - counts verified, invalid statuses caught
 *   5. Script exits with code 1 and prints rollback instructions on failure
 */

const fs = require('fs');
const path = require('path');

// Auto-detect env file: .env > .env.development > .env.production
const envCandidates = ['.env.production'];
const envFile = envCandidates.find(f => fs.existsSync(path.join(__dirname, '..', f)));
if (envFile) {
  require('dotenv').config({ path: path.join(__dirname, '..', envFile) });
  console.log(`Loaded env from: ${envFile}`);
} else {
  require('dotenv').config();
}

const mongoose = require('mongoose');

const MONGO_URI    = process.env.MONGODB_URI || process.env.MONGO_URI;
const IS_EXECUTE   = process.argv.includes('--execute');
const IS_ROLLBACK  = process.argv.includes('--rollback');
const ROLLBACK_FILE = path.join(__dirname, 'migrateJobStatus_rollback.json');

const APPROVAL_PRIORITY  = ['PENDING_APPROVAL', 'REJECTED', 'EDIT_REQUESTED', 'DISCONTINUED'];
const OPERATIONAL_RICH   = ['PAUSED', 'ON_HOLD', 'FILLED', 'CLOSED'];
const ALL_VALID_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE',
  'PAUSED', 'ON_HOLD', 'FILLED', 'CLOSED',
  'REJECTED', 'EDIT_REQUESTED', 'DISCONTINUED'
];

function resolveStatus(status, approvalStatus) {
  if (APPROVAL_PRIORITY.includes(approvalStatus)) return approvalStatus;
  if (['APPROVED', 'ACTIVE'].includes(approvalStatus)) {
    return OPERATIONAL_RICH.includes(status) ? status : 'ACTIVE';
  }
  if (approvalStatus === 'DRAFT') return 'DRAFT';
  return status || 'DRAFT';
}

async function takeSnapshot(collection) {
  const byStatus = {}, byApproval = {}, combined = {};
  const cursor = collection.find({}, { projection: { status: 1, approvalStatus: 1 } });
  for await (const doc of cursor) {
    const s = doc.status || 'null';
    const a = doc.approvalStatus || 'null';
    byStatus[s]   = (byStatus[s]   || 0) + 1;
    byApproval[a] = (byApproval[a] || 0) + 1;
    const key = `${s} + ${a}`;
    combined[key] = (combined[key] || 0) + 1;
  }
  return { byStatus, byApproval, combined };
}

function validateSnapshot(preSnap, postSnap, totalBefore, totalAfter) {
  const errors = [];
  if (totalBefore !== totalAfter)
    errors.push(`CRITICAL: Total count changed! Before=${totalBefore}, After=${totalAfter}`);
  const preTotal  = Object.values(preSnap.byStatus).reduce((a, b) => a + b, 0);
  const postTotal = Object.values(postSnap.byStatus).reduce((a, b) => a + b, 0);
  if (preTotal !== postTotal)
    errors.push(`CRITICAL: Status count totals mismatch! Before=${preTotal}, After=${postTotal}`);
  for (const [s] of Object.entries(postSnap.byStatus)) {
    if (!ALL_VALID_STATUSES.includes(s))
      errors.push(`INVALID STATUS found after migration: "${s}"`);
  }
  return errors;
}

async function rollback(collection) {
  if (!fs.existsSync(ROLLBACK_FILE)) {
    console.error('No rollback file found at:', ROLLBACK_FILE);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(ROLLBACK_FILE, 'utf8'));
  console.log(`Rolling back ${data.length} documents...`);
  let count = 0;
  for (const { _id, status, approvalStatus } of data) {
    await collection.updateOne(
      { _id: new mongoose.Types.ObjectId(_id) },
      { $set: { status, approvalStatus } }
    );
    count++;
  }
  console.log(`Rollback complete. Restored ${count} documents.`);
}

async function main() {
  if (!MONGO_URI) {
    console.error('ERROR: MONGODB_URI or MONGO_URI env var not set.');
    process.exit(1);
  }

  const modeLabel = IS_ROLLBACK ? 'ROLLBACK' : IS_EXECUTE ? 'EXECUTE (writes to DB)' : 'DRY RUN (no writes)';
  console.log('\n===================================================');
  console.log('  Job Status Migration');
  console.log('  Mode:', modeLabel);
  console.log('===================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB.\n');

  const Job = mongoose.connection.collection('jobs');

  if (IS_ROLLBACK) {
    await rollback(Job);
    await mongoose.disconnect();
    return;
  }

  // --- Pre-migration snapshot ---
  const totalBefore = await Job.countDocuments({});
  const preSnap = await takeSnapshot(Job);
  console.log('PRE-MIGRATION SNAPSHOT');
  console.log('  Total documents:', totalBefore);
  console.log('\n  By status:');
  Object.entries(preSnap.byStatus).forEach(([k, v]) => console.log(`    ${String(v).padStart(5)}  ${k}`));
  console.log('\n  By approvalStatus:');
  Object.entries(preSnap.byApproval).forEach(([k, v]) => console.log(`    ${String(v).padStart(5)}  ${k}`));
  console.log('\n  Combined pairs:');
  Object.entries(preSnap.combined).forEach(([k, v]) => console.log(`    ${String(v).padStart(5)}  ${k}`));

  // --- Plan ---
  const rollbackData = [], planned = [], summary = {};
  let unchanged = 0;
  const planCursor = Job.find({});
  for await (const job of planCursor) {
    const oldStatus   = job.status;
    const oldApproval = job.approvalStatus;
    const newStatus   = resolveStatus(oldStatus, oldApproval);
    if (newStatus === oldStatus && oldApproval === newStatus) { unchanged++; continue; }
    rollbackData.push({ _id: String(job._id), status: oldStatus, approvalStatus: oldApproval });
    planned.push({ _id: job._id, newStatus });
    const key = `${oldStatus || 'null'} + ${oldApproval || 'null'} -> ${newStatus}`;
    summary[key] = (summary[key] || 0) + 1;
  }

  console.log('\nMIGRATION PLAN:');
  if (Object.keys(summary).length === 0) {
    console.log('  Nothing to change - all documents already have correct unified status.');
  } else {
    Object.entries(summary).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}x  ${k}`));
  }
  console.log(`\n  Will update:     ${planned.length} documents`);
  console.log(`  Already correct: ${unchanged} documents`);

  if (!IS_EXECUTE) {
    console.log('\n[DRY RUN] No changes made.');
    console.log('  Run with --execute to apply.\n');
    await mongoose.disconnect();
    return;
  }

  // --- Save rollback file ---
  fs.writeFileSync(ROLLBACK_FILE, JSON.stringify(rollbackData, null, 2));
  console.log(`\nRollback file saved: ${ROLLBACK_FILE} (${rollbackData.length} entries)`);
  console.log('  To undo: node scripts/migrateJobStatus.js --rollback\n');

  // --- Execute ---
  console.log('Migrating...');
  let updated = 0;
  for (const { _id, newStatus } of planned) {
    await Job.updateOne({ _id }, { $set: { status: newStatus, approvalStatus: newStatus } });
    updated++;
    if (updated % 100 === 0) process.stdout.write(`  Updated ${updated}/${planned.length}...\r`);
  }
  console.log(`  Updated ${updated}/${planned.length} documents.\n`);

  // --- Post-migration validation ---
  console.log('POST-MIGRATION VALIDATION...');
  const totalAfter = await Job.countDocuments({});
  const postSnap   = await takeSnapshot(Job);
  console.log('  By status (new):');
  Object.entries(postSnap.byStatus).forEach(([k, v]) => console.log(`    ${String(v).padStart(5)}  ${k}`));

  const errors = validateSnapshot(preSnap, postSnap, totalBefore, totalAfter);
  if (errors.length > 0) {
    console.log('\nVALIDATION FAILED:');
    errors.forEach(e => console.log('  [ERROR]', e));
    console.log('\nRun rollback to restore:');
    console.log('  node scripts/migrateJobStatus.js --rollback\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n  Total before: ${totalBefore}  |  Total after: ${totalAfter}  |  Match: OK`);
  console.log('  All statuses are valid unified values: OK');
  console.log('\n===================================================');
  console.log('  Migration complete. Safe to deploy new code now.');
  console.log('===================================================\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\nMigration crashed:', err.message);
  process.exit(1);
});
