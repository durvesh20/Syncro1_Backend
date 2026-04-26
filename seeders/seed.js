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
    await mongoose.connect(process.env.MONGO_URI);
    console.log("📦 Connected to MongoDB");

    // 1. Admin
    const adminExists = await User.findOne({ email: "admin@Syncro1.com" });
    if (!adminExists) {
      await User.create({
        email: "admin@Syncro1.com",
        mobile: "9999999999",
        password: "Admin@123",
        role: "admin",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });
      console.log("✅ Admin user created");
    } else {
      console.log("ℹ️  Admin user already exists");
    }

    // 2. Sub-Admin
    const subAdminExists = await User.findOne({ email: "subadmin@syncro1.com" });
    if (!subAdminExists) {
      await User.create({
        email: "subadmin@syncro1.com",
        mobile: "9999999998",
        password: "SubAdmin@123",
        role: "sub_admin",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
        permissions: [
          "VIEW_ADMIN_DASHBOARD",
          "VIEW_VERIFICATIONS",
          "APPROVE_PARTNER",
          "REJECT_PARTNER",
          "APPROVE_COMPANY",
          "REJECT_COMPANY",
          "VIEW_PENDING_JOBS",
          "APPROVE_JOB",
          "REJECT_JOB",
          "VIEW_NOTIFICATIONS",
        ],
        createdBy: null,
      });
      console.log("✅ Sub-admin created");
    } else {
      console.log("ℹ️  Sub-admin already exists");
    }

    // 3. Subscription Plans
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
      await SubscriptionPlan.findOneAndUpdate(
        { name: plan.name },
        plan,
        { upsert: true, new: true }
      );
    }

    console.log("✅ Subscription plans created/updated");

    // 4. Partner
    const partnerExists = await User.findOne({ email: "partner@test.com" });
    if (!partnerExists) {
      const partnerUser = await User.create({
        email: "partner@test.com",
        mobile: "9876543210",
        password: "Partner@123",
        role: "staffing_partner",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      const now = new Date();

      await StaffingPartner.create({
        user: partnerUser._id,
        firstName: "Test",
        lastName: "Partner",
        firmName: "Test Recruiters Pvt Ltd",
        designation: "Director",
        city: "Mumbai",
        state: "Maharashtra",

        firmDetails: {
          registeredName: "Test Recruiters Private Limited",
          tradeName: "Test Recruiters",
          entityType: "Private Limited",
          yearEstablished: 2020,
          website: "https://testRecruiters.com",
          registeredOfficeAddress: {
            street: "123 Business Park",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400001",
            country: "India",
          },
          operatingAddress: {
            street: "456 Tech Hub",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
            country: "India",
            sameAsRegistered: false,
          },
          panNumber: "AABCT1234A",
          gstNumber: "27AABCT1234A1Z5",
          cinNumber: "U74999MH2020PTC123456",
          employeeCount: "6-20",
        },

        Syncro1Competency: {
          primaryHiringSectors: ["Technology", "BFSI", "Healthcare"],
          hiringLevels: ["Entry", "Mid", "Senior"],
          avgCtcRangeHandled: "5-20 LPA",
          averageMonthlyClosures: 8,
          yearsOfRecruitmentExperience: 6,
        },

        geographicReach: {
          preferredHiringLocations: ["Mumbai", "Pune", "Bangalore", "Delhi", "Hyderabad"],
          panIndiaCapability: true,
          operatingCities: ["Mumbai", "Pune", "Bangalore"],
          operatingStates: ["Maharashtra", "Karnataka"],
        },

        compliance: {
          syncrotechAgreement: {
            noCvRecycling: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            noFakeProfiles: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            noDoubleRepresentation: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            vendorCodeOfConduct: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            dataPrivacyPolicy: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            candidateConsentPolicy: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            nonCircumventionClause: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            commissionPayoutTerms: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
            replacementBackoutLiability: { accepted: true, acceptedAt: now, acceptedIp: "127.0.0.1" },
          },
          allClausesAccepted: true,
          agreementAcceptedAt: now,
          agreementAcceptedIp: "127.0.0.1",
          digitalSignature: "Test Partner",
          termsAccepted: true,
          ndaSigned: true,
          agreementSigned: true,
          agreementSignedAt: now,
        },

        commercialDetails: {
          payoutEntityName: "Test Recruiters Private Limited",
          gstRegistration: "Regular",
          tdsApplicable: true,
          bankAccountHolderName: "Test Recruiters Pvt Ltd",
          bankName: "HDFC Bank",
          accountNumber: "1234567890",
          ifscCode: "HDFC0001234",
        },

        subscription: {
          plan: "PROFESSIONAL",
          startDate: now,
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isActive: true,
        },

        verificationStatus: "APPROVED",
        verifiedAt: now,

        profileCompletion: {
          basicInfo: true,
          firmDetails: true,
          Syncro1Competency: true,
          geographicReach: true,
          compliance: true,
          commercialDetails: true,
          documents: true,
        },
      });

      console.log("✅ Test partner created");
    } else {
      console.log("ℹ️  Test partner already exists");
    }

    // 5. Company
    const companyExists = await User.findOne({ email: "company@test.com" });
    if (!companyExists) {
      const companyUser = await User.create({
        email: "company@test.com",
        mobile: "9876543211",
        password: "Company@123",
        role: "company",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      const now = new Date();

      const company = await Company.create({
        user: companyUser._id,
        companyName: "TechCorp Solutions Pvt Ltd",
        decisionMakerName: "John Doe",
        designation: "HR Director",
        department: "HR",
        city: "Bangalore",
        state: "Karnataka",

        kyc: {
          registeredName: "TechCorp Solutions Private Limited",
          tradeName: "TechCorp",
          companyType: "Private Limited",
          employeeCount: "500+",
          yearEstablished: 2018,
          website: "https://techcorp.com",
          description: "Leading technology solutions provider",
          industry: "Technology",
          cinNumber: "U72200KA2018PTC123456",
          registeredAddress: {
            street: "123 Tech Park",
            city: "Bangalore",
            state: "Karnataka",
            pincode: "560001",
            country: "India",
          },
          operatingAddress: {
            street: "123 Tech Park",
            city: "Bangalore",
            state: "Karnataka",
            pincode: "560001",
            country: "India",
            sameAsRegistered: true,
          },
          gstNumber: "29AABCT5678A1Z5",
          panNumber: "AABCT5678A",
        },

        hiringPreferences: {
          preferredIndustries: ["Technology"],
          hiringType: "Both",
          avgMonthlyHiringVolume: "16-30",
          typicalCtcBand: "5-20 LPA",
          workModePreference: "Hybrid",
          experienceLevels: ["Mid", "Senior", "Executive"],
          preferredLocations: ["Bangalore", "Mumbai", "Hyderabad"],
          urgencyLevel: "Ongoing",
        },

        billing: {
          billingEntityName: "TechCorp Solutions Private Limited",
          gstNumber: "29AABCT5678A1Z5",
          panNumber: "AABCT5678A",
          paymentTerms: "Net 30",
        },

        legalConsents: {
          termsAccepted: true,
          termsAcceptedAt: now,
          termsAcceptedIp: "127.0.0.1",
          privacyPolicyAccepted: true,
          privacyPolicyAcceptedAt: now,
          privacyPolicyAcceptedIp: "127.0.0.1",
          dataProcessingAgreementAccepted: true,
          dataProcessingAgreementAcceptedAt: now,
          dataProcessingAgreementAcceptedIp: "127.0.0.1",
          dataStorageConsent: true,
          dataStorageConsentAt: now,
          dataStorageConsentIp: "127.0.0.1",
          vendorSharingConsent: true,
          vendorSharingConsentAt: now,
          vendorSharingConsentIp: "127.0.0.1",
          communicationConsent: {
            email: true,
            whatsapp: true,
            sms: false,
          },
          communicationConsentAt: now,
          communicationConsentIp: "127.0.0.1",
        },

        verificationStatus: "APPROVED",
        verifiedAt: now,

        profileCompletion: {
          basicInfo: true,
          kyc: true,
          hiringPreferences: true,
          billing: true,
          legalConsents: true,
          documents: true,
        },
      });

      await Job.create([
        {
          company: company._id,
          postedBy: companyUser._id,
          title: "Senior Software Engineer",
          description: "We are looking for an experienced Senior Software Engineer...",
          requirements: ["5+ years experience", "React", "Node.js", "MongoDB"],
          responsibilities: ["Design systems", "Code review", "Mentor juniors"],
          category: "Technology",
          employmentType: "Full-time",
          experienceLevel: "Senior",
          experienceRange: { min: 5, max: 10 },
          salary: { min: 2500000, max: 4000000, currency: "INR", isNegotiable: true },
          location: { city: "Bangalore", state: "Karnataka", isRemote: false, isHybrid: true },
          skills: { required: ["JavaScript", "React", "Node.js"], preferred: ["AWS", "Docker"] },
          vacancies: 3,
          status: "ACTIVE",
          eligiblePlans: ["GROWTH", "PROFESSIONAL", "PREMIUM"],
        },
        {
          company: company._id,
          postedBy: companyUser._id,
          title: "Product Manager",
          description: "Join our product team...",
          requirements: ["4+ years PM experience", "Agile"],
          category: "Technology",
          employmentType: "Full-time",
          experienceLevel: "Mid",
          experienceRange: { min: 4, max: 8 },
          salary: { min: 2000000, max: 3500000, currency: "INR", isNegotiable: true },
          location: { city: "Bangalore", state: "Karnataka", isRemote: true },
          skills: { required: ["Product Management", "Agile"], preferred: ["SQL"] },
          vacancies: 2,
          status: "ACTIVE",
          eligiblePlans: ["FREE", "GROWTH", "PROFESSIONAL", "PREMIUM"],
        },
      ]);

      console.log("✅ Test company created");
      console.log("   📋 Sample jobs created");
    } else {
      console.log("ℹ️  Test company already exists");
    }

    console.log("\n🎉 Seeding complete!");
    console.log("━━━━━━━━━━━━━━━━━━━━");
    console.log("Admin: admin@syncro1.com / Admin@123");
    console.log("Sub-Admin: subadmin@syncro1.com / SubAdmin@123");
    console.log("Partner: partner@test.com / Partner@123");
    console.log("Company: company@test.com / Company@123");
    console.log("━━━━━━━━━━━━━━━━━━━━");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding error:", error);
    process.exit(1);
  }
};

seedDatabase();