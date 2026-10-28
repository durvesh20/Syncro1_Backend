// backend/config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Self-healing: Repair candidates prematurely auto-mutated from SUBMITTED to SLOTS_NOT_PUBLISHED / ASSESSMENT_PENDING
    setTimeout(async () => {
      try {
        const Candidate = mongoose.models.Candidate || require('../models/Candidate');
        const candidatesToFix = await Candidate.find({
          status: { $in: ['SLOTS_NOT_PUBLISHED', 'SLOTS_PUBLISHED', 'ASSESSMENT_PENDING'] },
          'statusHistory.status': 'SUBMITTED',
          'auditTrail.action': { $ne: 'SHORTLIST' },
          'statusHistory.notes': { $not: /shortlist/i }
        });

        if (candidatesToFix.length > 0) {
          let count = 0;
          for (const cand of candidatesToFix) {
            cand.status = 'SUBMITTED';
            if (cand.rounds && cand.rounds.length > 0) {
              cand.rounds.forEach(r => {
                if (['SLOTS_NOT_PUBLISHED', 'SLOTS_PUBLISHED', 'ASSESSMENT_PENDING'].includes(r.status)) {
                  r.status = 'NOT_STARTED';
                }
              });
            }
            await cand.save();
            count++;
          }
          console.log(`[DB SELF-HEAL] Successfully restored ${count} candidate(s) back to SUBMITTED (Company Review).`);
        }

        // Auto-detect & migrate legacy candidate statuses (ADMIN_REVIEW, ADMIN_REJECTED, UNDER_REVIEW, REVIEWING)
        const s1ReviewRes = await Candidate.updateMany(
          { status: { $in: ['ADMIN_REVIEW', 'PENDING_ADMIN_APPROVAL'] } },
          { $set: { status: 'S1_REVIEW' } }
        );
        const s1RejectedRes = await Candidate.updateMany(
          { status: 'ADMIN_REJECTED' },
          { $set: { status: 'S1_REJECTED' } }
        );
        const clientReviewRes = await Candidate.updateMany(
          { status: { $in: ['UNDER_REVIEW', 'REVIEWING', 'COMPANY_REVIEW'] } },
          { $set: { status: 'CLIENT_REVIEW' } }
        );
        const totalMigrated = s1ReviewRes.modifiedCount + s1RejectedRes.modifiedCount + clientReviewRes.modifiedCount;
        if (totalMigrated > 0) {
          console.log(`[DB SELF-HEAL] Auto-migrated ${totalMigrated} candidate(s) to modern statuses (S1_REVIEW: ${s1ReviewRes.modifiedCount}, S1_REJECTED: ${s1RejectedRes.modifiedCount}, CLIENT_REVIEW: ${clientReviewRes.modifiedCount}).`);
        }

        // Migrate any legacy staffing / staffing_partner role users to talent_partner
        const User = mongoose.models.User || require('../models/User');
        const updatedUsers = await User.updateMany(
          { role: { $in: ['staffing_partner', 'staffing'] } },
          { $set: { role: 'talent_partner' } }
        );
        if (updatedUsers.modifiedCount > 0) {
          console.log(`[DB SELF-HEAL] Migrated ${updatedUsers.modifiedCount} user(s) from staffing_partner/staffing to talent_partner`);
        }

        const AdminActionLog = mongoose.models.AdminActionLog || require('../models/AdminActionLog');
        await AdminActionLog.updateMany(
          { actorRole: { $in: ['staffing_partner', 'staffing'] } },
          { $set: { actorRole: 'talent_partner' } }
        );
      } catch (err) {
        console.error('[DB SELF-HEAL] Candidate status repair error:', err.message);
      }
    }, 2000);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;