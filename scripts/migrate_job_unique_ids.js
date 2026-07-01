const mongoose = require("mongoose");
const Job = require("../models/Job");
const Company = require("../models/Company");
const envFile = process.argv[2] === "production" ? "../.env.production" : "../.env.development";
require("dotenv").config({ path: require('path').resolve(__dirname, envFile) });

(async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected successfully!");

    console.log("Fetching all companies...");
    const companies = await Company.find({});
    console.log(`Found ${companies.length} companies.`);

    for (const company of companies) {
      console.log(`Processing jobs for company: ${company.companyName} (${company._id})`);
      const name = company.companyName || 'JOB';
      const prefix = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 3).padEnd(3, 'x');

      // Find all jobs for this company, sorted by creation date so that we migrate them sequentially
      const jobs = await Job.find({ company: company._id }).sort({ createdAt: 1 });
      console.log(`  Found ${jobs.length} jobs for ${company.companyName}`);

      let count = 1;
      for (const job of jobs) {
        const formattedNum = String(count).padStart(3, '0');
        const newUniqueId = `${prefix}${formattedNum}`;
        const oldUniqueId = job.uniqueId;
        
        job.uniqueId = newUniqueId;
        await job.save();
        
        console.log(`    Updated Job ID: ${job._id} from "${oldUniqueId}" -> "${newUniqueId}"`);
        count++;
      }
    }

    console.log("✅ All job uniqueIds migrated successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
})();
