// backend/seeders/seed.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Import models
const User = require("../models/User");
const StaffingPartner = require("../models/StaffingPartner");
const Company = require("../models/Company");
const Job = require("../models/Job");
const { SubscriptionPlan } = require("../models/Subscription");

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("📦 Connected to MongoDB");

    // Clear existing data (optional - comment out in production)
    // await User.deleteMany({});
    // await StaffingPartner.deleteMany({});
    // await Company.deleteMany({});
    // await Job.deleteMany({});
    // await SubscriptionPlan.deleteMany({});
    // console.log('🗑️  Cleared existing data');

    // 1. Create Admin User
    const adminExists = await User.findOne({ email: "admin@Syncro1.com" });
    if (!adminExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("Admin@123", salt);

      await User.create({
        email: "admin@Syncro1.com",
        mobile: "9999999999",
        password: hashedPassword,
        role: "admin",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      console.log("✅ Admin user created");
      console.log("   📧 Email: admin@Syncro1.com");
      console.log("   🔑 Password: Admin@123");
    } else {
      console.log("ℹ️  Admin user already exists");
    }

    // 2. Create Subscription Plans
    const plans = [
      {
        name: "FREE",
        displayName: "Free Plan",
        price: 0,
        gstPercentage: 0,
        duration: 365,
        features: {
          jobLevels: ["Entry"],
          databaseAccess: "basic",
          commissionRate: "standard",
          support: "email",
          analytics: "basic",
          notifications: "standard",
          accountManager: false,
          performanceBonuses: false,
          exclusiveClientAccess: false,
          customStrategies: false,
          quarterlyReviews: false,
          monthlyReviews: false,
          revenueShare: false,
        },
        isActive: true,
      },
      {
        name: "GROWTH",
        displayName: "Growth Plan",
        price: 4999,
        gstPercentage: 18,
        duration: 30,
        features: {
          jobLevels: ["Entry", "Mid"],
          databaseAccess: "advanced",
          commissionRate: "priority",
          support: "priority",
          analytics: "advanced",
          notifications: "priority",
          accountManager: true,
          performanceBonuses: true,
          exclusiveClientAccess: false,
          customStrategies: false,
          quarterlyReviews: false,
          monthlyReviews: false,
          revenueShare: false,
        },
        isActive: true,
      },
      {
        name: "PROFESSIONAL",
        displayName: "Professional Plan",
        price: 7999,
        gstPercentage: 18,
        duration: 30,
        features: {
          jobLevels: ["Entry", "Mid", "Senior"],
          databaseAccess: "premium",
          commissionRate: "premium",
          support: "dedicated",
          analytics: "premium",
          notifications: "exclusive",
          accountManager: true,
          performanceBonuses: true,
          exclusiveClientAccess: true,
          customStrategies: true,
          quarterlyReviews: true,
          monthlyReviews: false,
          revenueShare: true,
        },
        isActive: true,
      },
      {
        name: "PREMIUM",
        displayName: "Premium Plan",
        price: 11999,
        gstPercentage: 18,
        duration: 30,
        features: {
          jobLevels: ["Entry", "Mid", "Senior", "Executive", "C-Suite"],
          databaseAccess: "unlimited",
          commissionRate: "highest",
          support: "white-glove",
          analytics: "custom",
          notifications: "exclusive",
          accountManager: true,
          performanceBonuses: true,
          exclusiveClientAccess: true,
          customStrategies: true,
          quarterlyReviews: true,
          monthlyReviews: true,
          revenueShare: true,
        },
        isActive: true,
      },
    ];

    for (const plan of plans) {
      await SubscriptionPlan.findOneAndUpdate({ name: plan.name }, plan, {
        upsert: true,
        new: true,
      });
    }
    console.log("✅ Subscription plans created/updated");

    // 3. Create Sample Verified Partner (for testing)
    const testPartnerExists = await User.findOne({ email: "partner@test.com" });
    if (!testPartnerExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("Partner@123", salt);

      const partnerUser = await User.create({
        email: "partner@test.com",
        mobile: "9876543210",
        password: hashedPassword,
        role: "staffing_partner",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      await StaffingPartner.create({
        user: partnerUser._id,
        firstName: "Test",
        lastName: "Partner",
        firmName: "Test Syncro1ers Pvt Ltd",
        designation: "Director",
        city: "Mumbai",
        state: "Maharashtra",
        firmDetails: {
          tradeName: "Test Recruiters", // ✅ optional but nice
          entityType: "pvt_ltd", // ✅ optional but nice
          registeredName: "Test Syncro1ers Private Limited",
          gstNumber: "27AABCT1234A1Z5",
          panNumber: "AABCT1234A",
          employeeCount: "6-20",
          yearEstablished: 2020,
        },

        Syncro1Competency: {
          primaryHiringSectors: ["Technology", "Finance", "Healthcare"],
          hiringLevels: ["Entry", "Mid", "Senior"],
          avgCtcRangeHandled: "5-20 LPA",
          averageMonthlyClosures: 3,
          yearsOfRecruitmentExperience: 6,
        },
        geographicReach: {
          operatingCities: ["Mumbai", "Pune", "Bangalore"],
          operatingStates: ["Maharashtra", "Karnataka"],
          panIndiaCapability: true,
        },
        compliance: {
          termsAccepted: true,
          ndaSigned: true,
          agreementSigned: true,
          agreementSignedAt: new Date(),
        },
        subscription: {
          plan: "PROFESSIONAL",
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isActive: true,
        },
        verificationStatus: "APPROVED",
        profileCompletion: {
          basicInfo: true,
          firmDetails: true,
          Syncro1Competency: true,
          geographicReach: true,
          compliance: true,
          financeDetails: true,
        },
      });

      console.log("✅ Test partner created");
      console.log("   📧 Email: partner@test.com");
      console.log("   🔑 Password: Partner@123");
    }

    // 4. Create Sample Verified Company (for testing)
    const testCompanyExists = await User.findOne({ email: "company@test.com" });
    if (!testCompanyExists) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash("Company@123", salt);

      const companyUser = await User.create({
        email: "company@test.com",
        mobile: "9876543211",
        password: hashedPassword,
        role: "company",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      const company = await Company.create({
        user: companyUser._id,
        companyName: "TechCorp Solutions Pvt Ltd",
        decisionMakerName: "John Doe",
        designation: "HR Director",
        city: "Bangalore",
        state: "Karnataka",
        kyc: {
          registeredName: "TechCorp Solutions Private Limited",
          cin: "U72200KA2018PTC123456",
          gstNumber: "29AABCT5678A1Z5",
          panNumber: "AABCT5678A",
          industry: "Technology",
          companyType: "Enterprise",
          employeeCount: "501-1000",
          yearEstablished: 2018,
          website: "https://techcorp.com",
          description: "Leading technology solutions provider",
        },
        hiringPreferences: {
          preferredIndustries: ["Technology"],
          experienceLevels: ["Mid", "Senior", "Executive"],
          locations: ["Bangalore", "Mumbai", "Hyderabad"],
          hiringVolume: "High (16-30/month)",
          urgencyLevel: "Ongoing",
        },
        billing: {
          billingName: "TechCorp Solutions Private Limited",
          billingEmail: "accounts@techcorp.com",
          paymentTerms: "Net 30",
        },
        legalConsents: {
          termsAccepted: true,
          termsAcceptedAt: new Date(),
          privacyPolicyAccepted: true,
          agreementSigned: true,
          agreementSignedAt: new Date(),
        },
        verificationStatus: "APPROVED",
        profileCompletion: {
          basicInfo: true,
          kyc: true,
          hiringPreferences: true,
          billing: true,
          legalConsents: true,
          documents: true,
        },
      });

      // Create sample jobs for the company
      const sampleJobs = [
        {
          company: company._id,
          postedBy: companyUser._id,
          title: "Senior Software Engineer",
          description:
            "We are looking for an experienced Senior Software Engineer to join our growing team. You will be responsible for designing, developing, and maintaining scalable software solutions.",
          requirements: [
            "5+ years of experience in software development",
            "Strong proficiency in JavaScript, React, and Node.js",
            "Experience with cloud services (AWS/GCP/Azure)",
            "Excellent problem-solving skills",
          ],
          responsibilities: [
            "Design and implement new features",
            "Code review and mentoring junior developers",
            "Collaborate with product team on requirements",
            "Ensure code quality and best practices",
          ],
          category: "Technology",
          employmentType: "Full-time",
          experienceLevel: "Senior",
          experienceRange: { min: 5, max: 10 },
          salary: {
            min: 2500000,
            max: 4000000,
            currency: "INR",
            isNegotiable: true,
          },
          commission: { type: "percentage", value: 8.33 },
          location: {
            city: "Bangalore",
            state: "Karnataka",
            isRemote: false,
            isHybrid: true,
          },
          skills: {
            required: ["JavaScript", "React", "Node.js", "MongoDB", "AWS"],
            preferred: ["TypeScript", "GraphQL", "Docker", "Kubernetes"],
          },
          vacancies: 3,
          status: "ACTIVE",
          eligiblePlans: ["GROWTH", "PROFESSIONAL", "PREMIUM"],
        },
        {
          company: company._id,
          postedBy: companyUser._id,
          title: "Product Manager",
          description:
            "Join our product team to lead the development of innovative solutions. You will work closely with engineering, design, and business teams.",
          requirements: [
            "4+ years of product management experience",
            "Strong analytical and communication skills",
            "Experience with agile methodologies",
            "Technical background preferred",
          ],
          category: "Technology",
          employmentType: "Full-time",
          experienceLevel: "Mid",
          experienceRange: { min: 4, max: 8 },
          salary: {
            min: 2000000,
            max: 3500000,
            currency: "INR",
            isNegotiable: true,
          },
          commission: { type: "percentage", value: 8.33 },
          location: { city: "Bangalore", state: "Karnataka", isRemote: true },
          skills: {
            required: [
              "Product Management",
              "Agile",
              "Data Analysis",
              "Roadmapping",
            ],
            preferred: ["SQL", "Jira", "Figma"],
          },
          vacancies: 2,
          status: "ACTIVE",
          eligiblePlans: ["FREE", "GROWTH", "PROFESSIONAL", "PREMIUM"],
        },
        {
          company: company._id,
          postedBy: companyUser._id,
          title: "Junior Frontend Developer",
          description:
            "Great opportunity for freshers and junior developers to kickstart their career with a leading tech company.",
          requirements: [
            "0-2 years of experience",
            "Knowledge of HTML, CSS, JavaScript",
            "Familiarity with React or Vue.js",
            "Eagerness to learn and grow",
          ],
          category: "Technology",
          employmentType: "Full-time",
          experienceLevel: "Entry",
          experienceRange: { min: 0, max: 2 },
          salary: { min: 400000, max: 800000, currency: "INR" },
          commission: { type: "fixed", value: 25000 },
          location: { city: "Mumbai", state: "Maharashtra", isRemote: false },
          skills: {
            required: ["HTML", "CSS", "JavaScript", "React"],
            preferred: ["TypeScript", "Tailwind CSS"],
          },
          vacancies: 5,
          status: "ACTIVE",
          eligiblePlans: ["FREE", "GROWTH", "PROFESSIONAL", "PREMIUM"],
        },
      ];

      for (const jobData of sampleJobs) {
        await Job.create(jobData);
      }

      console.log("✅ Test company created with sample jobs");
      console.log("   📧 Email: company@test.com");
      console.log("   🔑 Password: Company@123");
      console.log("   📋 3 sample jobs created");
    }

    console.log("\n🎉 Database seeding completed!");
    console.log("\n📝 Test Credentials:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Admin:    admin@Syncro1.com / Admin@123");
    console.log("Partner:  partner@test.com / Partner@123");
    console.log("Company:  company@test.com / Company@123");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding error:", error);
    process.exit(1);
  }
};

seedDatabase();
