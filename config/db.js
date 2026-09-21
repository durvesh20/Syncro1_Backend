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