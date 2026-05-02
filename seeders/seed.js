// backend/seeders/seed.js
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Import models
const User = require("../models/User");
const StaffingPartner = require("../models/StaffingPartner");
const Company = require("../models/Company");
const Job = require("../models/Job");
const { SubscriptionPlan, Subscription } = require("../models/Subscription");
const Candidate = require("../models/Candidate");
const JobInterest = require("../models/JobInterest");
const Notification = require("../models/Notification");
const AdminActionLog = require("../models/AdminActionLog");
const AgreementQuery = require("../models/AgreementQuery");

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const log = (emoji, msg) => console.log(`${emoji}  ${msg}`);
const skip = (msg) => console.log(`ℹ️   Already exists: ${msg}`);
const err = (msg, e) => console.error(`❌  ${msg}:`, e.message);

// ─────────────────────────────────────────────
// MAIN SEEDER
// ─────────────────────────────────────────────

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    log("📦", "Connected to MongoDB");

    // ══════════════════════════════════════════
    // 1. SUBSCRIPTION PLANS
    // ══════════════════════════════════════════

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
    log("✅", "Subscription plans seeded");

    // ══════════════════════════════════════════
    // 2. ADMIN USER
    // ══════════════════════════════════════════

    let adminUser = await User.findOne({ email: "admin@syncro1.com" });
    if (!adminUser) {
      adminUser = await User.create({
        email: "admin@syncro1.com",
        mobile: "9999999999",
        password: "Admin@123",
        role: "admin",
        status: "ACTIVE",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });
      log("✅", "Admin user created → admin@syncro1.com / Admin@123");
    } else {
      skip("Admin user (admin@syncro1.com)");
    }

    // ══════════════════════════════════════════
    // 3. SUB-ADMIN USER
    // ══════════════════════════════════════════

    let subAdminUser = await User.findOne({ email: "subadmin@syncro1.com" });
    if (!subAdminUser) {
      subAdminUser = await User.create({
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
          "VIEW_ANALYTICS",
          "VIEW_VERIFICATIONS",
          "APPROVE_PARTNER",
          "REJECT_PARTNER",
          "APPROVE_COMPANY",
          "REJECT_COMPANY",
          "VIEW_PENDING_JOBS",
          "APPROVE_JOB",
          "REJECT_JOB",
          "DISCONTINUE_JOB",
          "VIEW_JOB_EDIT_HISTORY",
          "VIEW_EDIT_REQUESTS",
          "VIEW_EDIT_REQUEST_DETAILS",
          "APPROVE_EDIT_REQUEST",
          "REJECT_EDIT_REQUEST",
          "VIEW_ALL_CANDIDATES",
          "VIEW_ALL_JOBS",
          "VIEW_ALL_PARTNERS",
          "VIEW_ALL_COMPANIES",
          "VIEW_PAYOUTS",
          "VIEW_PAYOUT_DETAILS",
          "APPROVE_PAYOUT",
          "PROCESS_PAYOUT",
          "HOLD_PAYOUT",
          "RELEASE_PAYOUT",
          "FORFEIT_PAYOUT",
          "RUN_PAYOUT_ELIGIBILITY",
          "VIEW_INVOICES",
          "VIEW_INVOICE_DETAILS",
          "VIEW_AUDIT_LOGS",
          "VIEW_USERS",
          "UPDATE_USER_STATUS",
          "VIEW_NOTIFICATIONS",
          "VIEW_EXTENSION_REQUESTS",
          "APPROVE_EXTENSION_REQUEST",
          "REJECT_EXTENSION_REQUEST",
          "VIEW_AGREEMENT_QUERIES",
          "RESPOND_AGREEMENT_QUERY",
        ],
        createdBy: adminUser._id,
      });
      log("✅", "Sub-admin created → subadmin@syncro1.com / SubAdmin@123");
    } else {
      skip("Sub-admin (subadmin@syncro1.com)");
    }

    // ══════════════════════════════════════════
    // 4. STAFFING PARTNER — FULLY VERIFIED
    // ══════════════════════════════════════════

    let partnerUser = await User.findOne({ email: "partner@test.com" });
    let partnerProfile;

    if (!partnerUser) {
      partnerUser = await User.create({
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
      const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      partnerProfile = await StaffingPartner.create({
        user: partnerUser._id,
        firstName: "Rajesh",
        lastName: "Kumar",
        firmName: "RK Talent Solutions Pvt Ltd",
        designation: "Managing Director",
        linkedinProfile: "https://linkedin.com/in/rajeshkumar",
        city: "Mumbai",
        state: "Maharashtra",

        firmDetails: {
          registeredName: "RK Talent Solutions Private Limited",
          tradeName: "RK Talent Solutions",
          entityType: "Private Limited",
          yearEstablished: 2018,
          website: "https://rktalent.com",
          registeredOfficeAddress: {
            street: "401 Business Hub, BKC",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400051",
            country: "India",
          },
          operatingAddress: {
            street: "401 Business Hub, BKC",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400051",
            country: "India",
            sameAsRegistered: true,
          },
          panNumber: "AABCR1234A",
          gstNumber: "27AABCR1234A1Z5",
          cinNumber: "U74999MH2018PTC312345",
          employeeCount: "6-20",
        },

        Syncro1Competency: {
          primaryHiringSectors: [
            "Technology",
            "BFSI",
            "Healthcare",
            "E-commerce",
          ],
          hiringLevels: ["Entry", "Mid", "Senior"],
          avgCtcRangeHandled: "5-20 LPA",
          averageMonthlyClosures: 8,
          yearsOfRecruitmentExperience: 7,
          functionalAreas: [
            "Software Development",
            "Product Management",
            "Data Science",
          ],
          topClients: ["Infosys", "TCS", "Wipro"],
          specializations: ["IT Staffing", "Banking & Finance"],
        },

        geographicReach: {
          preferredHiringLocations: [
            "Mumbai",
            "Pune",
            "Bangalore",
            "Delhi",
            "Hyderabad",
          ],
          panIndiaCapability: true,
          operatingCities: ["Mumbai", "Pune", "Bangalore"],
          operatingStates: ["Maharashtra", "Karnataka", "Delhi"],
          internationalReach: false,
        },

        compliance: {
          syncrotechAgreement: {
            noCvRecycling: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            noFakeProfiles: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            noDoubleRepresentation: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            vendorCodeOfConduct: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            dataPrivacyPolicy: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            candidateConsentPolicy: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            nonCircumventionClause: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            commissionPayoutTerms: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            replacementBackoutLiability: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
          },
          allClausesAccepted: true,
          agreementAcceptedAt: now,
          agreementAcceptedIp: "127.0.0.1",
          digitalSignature: "Rajesh Kumar",
          termsAccepted: true,
          ndaSigned: true,
          agreementSigned: true,
          agreementSignedAt: now,
        },

        commercialDetails: {
          payoutEntityName: "RK Talent Solutions Private Limited",
          gstRegistration: "Regular",
          tdsApplicable: true,
          bankAccountHolderName: "RK Talent Solutions Pvt Ltd",
          bankName: "HDFC Bank",
          accountNumber: "50200012345678",
          ifscCode: "HDFC0001234",
        },

        documents: {
          panCard:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_pan.pdf",
          gstCertificate:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_gst.pdf",
        },

        agreement: {
          agreed: true,
          agreedAt: now,
          agreedIp: "127.0.0.1",
          pdfUrl:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/syncro1/agreements/sample_agreement.pdf",
          generatedAt: now,
        },

        subscription: {
          plan: "PROFESSIONAL",
          startDate: now,
          endDate: subEnd,
          isActive: true,
        },

        verificationStatus: "APPROVED",
        verifiedBy: adminUser._id,
        verifiedAt: now,
        submittedAt: now,

        profileCompletion: {
          basicInfo: true,
          firmDetails: true,
          Syncro1Competency: true,
          geographicReach: true,
          compliance: true,
          commercialDetails: true,
          documents: true,
        },

        metrics: {
          totalSubmissions: 0,
          totalPlacements: 0,
          totalJobsInterested: 0,
          totalShortlisted: 0,
          totalInterviewed: 0,
          totalOffered: 0,
          totalEarnings: 0,
          pendingPayouts: 0,
          eligiblePayouts: 0,
          paidOut: 0,
          forfeitedAmount: 0,
          rating: 0,
          totalRatings: 0,
        },
      });

      // Create subscription record
      await Subscription.create({
        user: partnerUser._id,
        staffingPartner: partnerProfile._id,
        plan: "PROFESSIONAL",
        startDate: now,
        endDate: subEnd,
        status: "ACTIVE",
        payment: {
          orderId: "seed_order_" + Date.now(),
          paymentId: "seed_payment_" + Date.now(),
          amount: 7999,
          currency: "INR",
          method: "mock",
          status: "COMPLETED",
          paidAt: now,
        },
      });

      log("✅", "Staffing partner created → partner@test.com / Partner@123");
    } else {
      partnerProfile = await StaffingPartner.findOne({
        user: partnerUser._id,
      });
      skip("Staffing partner (partner@test.com)");
    }

    // ══════════════════════════════════════════
    // 5. COMPANY — FULLY VERIFIED
    // ══════════════════════════════════════════

    let companyUser = await User.findOne({ email: "company@test.com" });
    let companyProfile;

    if (!companyUser) {
      companyUser = await User.create({
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

      companyProfile = await Company.create({
        user: companyUser._id,
        companyName: "TechCorp Solutions Pvt Ltd",
        decisionMakerName: "Priya Sharma",
        designation: "Chief HR Officer",
        department: "HR",
        linkedinProfile: "https://linkedin.com/in/priyasharma",
        city: "Bangalore",
        state: "Karnataka",

        kyc: {
          registeredName: "TechCorp Solutions Private Limited",
          tradeName: "TechCorp",
          companyType: "Private Limited",
          employeeCount: "500+",
          yearEstablished: 2015,
          website: "https://techcorp.in",
          description:
            "TechCorp Solutions is a leading IT services and consulting company helping businesses transform digitally.",
          industry: "Technology",
          cinNumber: "U72200KA2015PTC081234",
          panNumber: "AABCT5678A",
          gstNumber: "29AABCT5678A1Z5",
          registeredAddress: {
            street: "WeWork Galaxy, Residency Road",
            city: "Bangalore",
            state: "Karnataka",
            pincode: "560025",
            country: "India",
          },
          operatingAddress: {
            street: "WeWork Galaxy, Residency Road",
            city: "Bangalore",
            state: "Karnataka",
            pincode: "560025",
            country: "India",
            sameAsRegistered: true,
          },
        },

        hiringPreferences: {
          preferredIndustries: ["Technology", "SaaS", "Fintech"],
          functionalAreas: [
            "Software Development",
            "Product",
            "Data Science",
            "DevOps",
          ],
          experienceLevels: ["Mid", "Senior", "Executive"],
          hiringType: "Permanent",
          avgMonthlyHiringVolume: "16-30",
          typicalCtcBand: "5-20 LPA",
          preferredLocations: ["Bangalore", "Mumbai", "Hyderabad", "Pune"],
          workModePreference: "Hybrid",
          urgencyLevel: "Ongoing",
        },

        billing: {
          billingEntityName: "TechCorp Solutions Private Limited",
          billingAddress: {
            street: "WeWork Galaxy, Residency Road",
            city: "Bangalore",
            state: "Karnataka",
            pincode: "560025",
          },
          gstRegistrationType: "Regular",
          gstNumber: "29AABCT5678A1Z5",
          panNumber: "AABCT5678A",
          poRequired: false,
          tdsApplicable: true,
          paymentTerms: "Net 30",
          preferredPaymentMethod: "Bank Transfer",
        },

        documents: {
          gstCertificate:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_gst.pdf",
          panCard:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_pan.pdf",
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
          cookiePolicyAccepted: true,
          cookiePolicyAcceptedAt: now,
          cookiePolicyAcceptedIp: "127.0.0.1",
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
        verifiedBy: adminUser._id,
        verifiedAt: now,

        profileCompletion: {
          basicInfo: true,
          kyc: true,
          hiringPreferences: true,
          billing: true,
          legalConsents: true,
          documents: true,
        },

        metrics: {
          totalJobsPosted: 0,
          activeJobs: 0,
          totalHires: 0,
          totalSpent: 0,
        },
      });

      log("✅", "Company created → company@test.com / Company@123");
    } else {
      companyProfile = await Company.findOne({ user: companyUser._id });
      skip("Company (company@test.com)");
    }

    // ══════════════════════════════════════════
    // 6. JOBS — 4 SAMPLE JOBS
    // ══════════════════════════════════════════

    const existingJobs = await Job.countDocuments({
      company: companyProfile._id,
    });

    let job1, job2, job3, job4;

    if (existingJobs === 0) {
      const jobBase = {
        company: companyProfile._id,
        postedBy: companyUser._id,
        status: "ACTIVE",
        approvalStatus: "ACTIVE",
        approvedBy: adminUser._id,
        approvedAt: new Date(),
      };

      job1 = await Job.create({
        ...jobBase,
        title: "Senior Software Engineer — React & Node.js",
        description:
          "We are looking for an experienced Senior Software Engineer to join our growing engineering team. You will design and develop scalable web applications using React and Node.js, collaborate with product managers and designers, and mentor junior engineers.",
        requirements: [
          "5+ years of software development experience",
          "Strong proficiency in React.js and Node.js",
          "Experience with MongoDB or PostgreSQL",
          "Knowledge of microservices architecture",
          "Experience with AWS or GCP",
        ],
        responsibilities: [
          "Design and implement scalable backend services",
          "Build responsive React frontend components",
          "Participate in code reviews",
          "Mentor junior developers",
          "Work with product team on requirements",
        ],
        category: "Technology",
        subCategory: "Full Stack",
        employmentType: "Full-time",
        experienceLevel: "Senior",
        experienceRange: { min: 5, max: 10 },
        salary: {
          min: 2000000,
          max: 4000000,
          currency: "INR",
          isNegotiable: true,
          isConfidential: false,
        },
        location: {
          city: "Bangalore",
          state: "Karnataka",
          country: "India",
          isRemote: false,
          isHybrid: true,
          isOnSite: false,
        },
        skills: {
          required: ["React.js", "Node.js", "JavaScript", "MongoDB"],
          preferred: ["AWS", "Docker", "GraphQL", "TypeScript"],
        },
        education: {
          minimum: "B.Tech/B.E.",
          preferred: ["Computer Science", "Information Technology"],
        },
        vacancies: 3,
        expectedJoiningDate: "0-30 days",
        eligiblePlans: ["FREE", "GROWTH", "PROFESSIONAL", "PREMIUM"],
        isUrgent: false,
        isFeatured: true,
        commission: { type: "percentage", value: 8.33 },
        editRequestCount: 0,
        approvedEditCount: 0,
        rejectedEditCount: 0,
        changeHistory: [
          {
            changedAt: new Date(),
            changedBy: adminUser._id,
            changeType: "APPROVED",
            notes: "Initial approval — seeded",
          },
        ],
      });

      job2 = await Job.create({
        ...jobBase,
        title: "Product Manager — SaaS Platform",
        description:
          "Join our product team as a Product Manager. You will own the product roadmap for our flagship SaaS platform, work closely with engineering and design teams, and drive product strategy based on customer feedback and market research.",
        requirements: [
          "4+ years of product management experience",
          "Experience with SaaS products",
          "Strong analytical and problem-solving skills",
          "Proficiency with Agile/Scrum methodologies",
          "Excellent communication skills",
        ],
        responsibilities: [
          "Define and maintain product roadmap",
          "Write clear product requirements and user stories",
          "Conduct user research and market analysis",
          "Collaborate with engineering and design teams",
          "Track and report key product metrics",
        ],
        category: "Technology",
        subCategory: "Product",
        employmentType: "Full-time",
        experienceLevel: "Mid",
        experienceRange: { min: 4, max: 8 },
        salary: {
          min: 1800000,
          max: 3500000,
          currency: "INR",
          isNegotiable: true,
          isConfidential: false,
        },
        location: {
          city: "Bangalore",
          state: "Karnataka",
          country: "India",
          isRemote: false,
          isHybrid: true,
          isOnSite: false,
        },
        skills: {
          required: ["Product Management", "Agile", "User Research", "SQL"],
          preferred: ["Figma", "JIRA", "Data Analytics", "A/B Testing"],
        },
        education: {
          minimum: "B.Tech/MBA",
          preferred: ["MBA", "Engineering + MBA"],
        },
        vacancies: 2,
        expectedJoiningDate: "0-30 days",
        eligiblePlans: ["FREE", "GROWTH", "PROFESSIONAL", "PREMIUM"],
        isUrgent: false,
        isFeatured: false,
        commission: { type: "percentage", value: 8.33 },
        editRequestCount: 0,
        approvedEditCount: 0,
        rejectedEditCount: 0,
        changeHistory: [
          {
            changedAt: new Date(),
            changedBy: adminUser._id,
            changeType: "APPROVED",
            notes: "Initial approval — seeded",
          },
        ],
      });

      job3 = await Job.create({
        ...jobBase,
        title: "Data Scientist — ML & AI",
        description:
          "We are looking for a talented Data Scientist to build and deploy machine learning models that power our AI-driven product features. You will work with large datasets, develop predictive models, and collaborate with engineering teams to bring ML solutions to production.",
        requirements: [
          "3+ years of data science experience",
          "Strong proficiency in Python (scikit-learn, TensorFlow, PyTorch)",
          "Experience with large-scale data processing (Spark, Hadoop)",
          "Strong knowledge of statistics and ML algorithms",
          "Experience deploying ML models to production",
        ],
        responsibilities: [
          "Develop and maintain ML models",
          "Analyze complex datasets",
          "Collaborate with engineering on model deployment",
          "Communicate findings to stakeholders",
          "Stay updated on latest ML research",
        ],
        category: "Technology",
        subCategory: "Data Science",
        employmentType: "Full-time",
        experienceLevel: "Mid",
        experienceRange: { min: 3, max: 7 },
        salary: {
          min: 1500000,
          max: 3000000,
          currency: "INR",
          isNegotiable: true,
          isConfidential: false,
        },
        location: {
          city: "Bangalore",
          state: "Karnataka",
          country: "India",
          isRemote: true,
          isHybrid: false,
          isOnSite: false,
        },
        skills: {
          required: ["Python", "Machine Learning", "SQL", "TensorFlow"],
          preferred: ["PyTorch", "Spark", "AWS SageMaker", "MLflow"],
        },
        education: {
          minimum: "B.Tech/M.Tech",
          preferred: ["M.Tech in CS/AI/ML", "Ph.D preferred"],
        },
        vacancies: 2,
        expectedJoiningDate: "0-30 days",
        eligiblePlans: ["GROWTH", "PROFESSIONAL", "PREMIUM"],
        isUrgent: true,
        isFeatured: false,
        commission: { type: "percentage", value: 8.33 },
        editRequestCount: 0,
        approvedEditCount: 0,
        rejectedEditCount: 0,
        changeHistory: [
          {
            changedAt: new Date(),
            changedBy: adminUser._id,
            changeType: "APPROVED",
            notes: "Initial approval — seeded",
          },
        ],
      });

      job4 = await Job.create({
        ...jobBase,
        title: "DevOps Engineer — Kubernetes & AWS",
        description:
          "We need a skilled DevOps Engineer to manage our cloud infrastructure, CI/CD pipelines, and Kubernetes clusters. You will work closely with development teams to improve deployment processes and system reliability.",
        requirements: [
          "3+ years of DevOps/SRE experience",
          "Strong knowledge of Kubernetes and Docker",
          "Experience with AWS services (EKS, EC2, RDS, S3)",
          "Experience with CI/CD tools (Jenkins, GitHub Actions)",
          "Infrastructure as Code experience (Terraform, CloudFormation)",
        ],
        responsibilities: [
          "Manage Kubernetes clusters and deployments",
          "Build and maintain CI/CD pipelines",
          "Monitor system health and performance",
          "Implement security best practices",
          "Automate infrastructure provisioning",
        ],
        category: "Technology",
        subCategory: "DevOps",
        employmentType: "Full-time",
        experienceLevel: "Mid",
        experienceRange: { min: 3, max: 7 },
        salary: {
          min: 1600000,
          max: 3200000,
          currency: "INR",
          isNegotiable: true,
          isConfidential: false,
        },
        location: {
          city: "Bangalore",
          state: "Karnataka",
          country: "India",
          isRemote: false,
          isHybrid: true,
          isOnSite: false,
        },
        skills: {
          required: ["Kubernetes", "Docker", "AWS", "Linux", "Terraform"],
          preferred: ["Prometheus", "Grafana", "Ansible", "Python"],
        },
        education: {
          minimum: "B.Tech/B.E.",
          preferred: ["Computer Science", "Information Technology"],
        },
        vacancies: 2,
        expectedJoiningDate: "0-15 days",
        eligiblePlans: ["PROFESSIONAL", "PREMIUM"],
        isUrgent: true,
        isFeatured: false,
        commission: { type: "percentage", value: 8.33 },
        editRequestCount: 0,
        approvedEditCount: 0,
        rejectedEditCount: 0,
        changeHistory: [
          {
            changedAt: new Date(),
            changedBy: adminUser._id,
            changeType: "APPROVED",
            notes: "Initial approval — seeded",
          },
        ],
      });

      // Update company metrics
      await Company.findByIdAndUpdate(companyProfile._id, {
        $inc: { "metrics.totalJobsPosted": 4, "metrics.activeJobs": 4 },
      });

      log("✅", "4 sample jobs created and approved");
    } else {
      skip(`Jobs (${existingJobs} already exist)`);
      const jobs = await Job.find({ company: companyProfile._id }).limit(4);
      job1 = jobs[0];
      job2 = jobs[1];
      job3 = jobs[2];
      job4 = jobs[3];
    }

    // ══════════════════════════════════════════
    // 7. JOB INTEREST — Partner interested in job1
    // ══════════════════════════════════════════

    if (partnerProfile && job1) {
      const existingInterest = await JobInterest.findOne({
        partner: partnerProfile._id,
        job: job1._id,
      });

      if (!existingInterest) {
        await JobInterest.create({
          partner: partnerProfile._id,
          job: job1._id,
          user: partnerUser._id,
          status: "ACTIVE",
          submissionCount: 0,
          submissionLimit: 5,
          limitExtended: false,
        });

        // Update job interest count
        await Job.findByIdAndUpdate(job1._id, {
          $inc: { "metrics.interestedPartners": 1 },
        });

        // Update partner metrics
        await StaffingPartner.findByIdAndUpdate(partnerProfile._id, {
          $inc: { "metrics.totalJobsInterested": 1 },
        });

        log("✅", `Job interest created: ${partnerProfile.firmName} → ${job1.title}`);
      } else {
        skip("Job interest already exists");
      }
    }

    // ══════════════════════════════════════════
    // 8. SECOND PARTNER — PENDING VERIFICATION
    // ══════════════════════════════════════════

    let partner2User = await User.findOne({
      email: "partner2@test.com",
    });

    if (!partner2User) {
      partner2User = await User.create({
        email: "partner2@test.com",
        mobile: "9876543212",
        password: "Partner@123",
        role: "staffing_partner",
        status: "UNDER_VERIFICATION",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      const now = new Date();

      await StaffingPartner.create({
        user: partner2User._id,
        firstName: "Sunita",
        lastName: "Mehta",
        firmName: "SM Recruitment Agency",
        designation: "Founder",
        city: "Delhi",
        state: "Delhi",

        firmDetails: {
          registeredName: "SM Recruitment Agency",
          entityType: "Proprietor",
          yearEstablished: 2020,
          panNumber: "AABCS9876B",
          gstNumber: "07AABCS9876B1Z5",
        },

        Syncro1Competency: {
          primaryHiringSectors: ["BFSI", "Healthcare"],
          hiringLevels: ["Entry", "Mid"],
          avgCtcRangeHandled: "0-5 LPA",
          yearsOfRecruitmentExperience: 3,
        },

        geographicReach: {
          preferredHiringLocations: ["Delhi", "Noida", "Gurgaon"],
          panIndiaCapability: false,
          operatingCities: ["Delhi", "Noida"],
          operatingStates: ["Delhi", "Haryana"],
        },

        compliance: {
          syncrotechAgreement: {
            noCvRecycling: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            noFakeProfiles: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            noDoubleRepresentation: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            vendorCodeOfConduct: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            dataPrivacyPolicy: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            candidateConsentPolicy: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            nonCircumventionClause: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            commissionPayoutTerms: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
            replacementBackoutLiability: {
              accepted: true,
              acceptedAt: now,
              acceptedIp: "127.0.0.1",
            },
          },
          allClausesAccepted: true,
          agreementAcceptedAt: now,
          agreementAcceptedIp: "127.0.0.1",
          digitalSignature: "Sunita Mehta",
          termsAccepted: true,
          ndaSigned: true,
          agreementSigned: true,
          agreementSignedAt: now,
        },

        commercialDetails: {
          payoutEntityName: "SM Recruitment Agency",
          gstRegistration: "Regular",
          tdsApplicable: true,
          bankAccountHolderName: "Sunita Mehta",
          bankName: "SBI",
          accountNumber: "32456789012",
          ifscCode: "SBIN0001234",
        },

        documents: {
          panCard:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_pan.pdf",
          gstCertificate:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_gst.pdf",
        },

        agreement: {
          agreed: true,
          agreedAt: now,
          agreedIp: "127.0.0.1",
          pdfUrl:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/syncro1/agreements/sample_agreement.pdf",
          generatedAt: now,
        },

        subscription: {
          plan: "FREE",
          startDate: now,
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          isActive: true,
        },

        verificationStatus: "UNDER_REVIEW",
        submittedAt: now,

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

      log(
        "✅",
        "Second partner (PENDING) created → partner2@test.com / Partner@123"
      );
    } else {
      skip("Second partner (partner2@test.com)");
    }

    // ══════════════════════════════════════════
    // 9. SECOND COMPANY — PENDING VERIFICATION
    // ══════════════════════════════════════════

    let company2User = await User.findOne({ email: "company2@test.com" });

    if (!company2User) {
      company2User = await User.create({
        email: "company2@test.com",
        mobile: "9876543213",
        password: "Company@123",
        role: "company",
        status: "UNDER_VERIFICATION",
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
      });

      const now = new Date();

      await Company.create({
        user: company2User._id,
        companyName: "FinServe Capital Pvt Ltd",
        decisionMakerName: "Amit Gupta",
        designation: "Head of Talent",
        department: "Talent Acquisition",
        city: "Mumbai",
        state: "Maharashtra",

        kyc: {
          registeredName: "FinServe Capital Private Limited",
          companyType: "Private Limited",
          yearEstablished: 2019,
          industry: "BFSI",
          employeeCount: "51-200",
          gstNumber: "27AABCF4567B1Z8",
          panNumber: "AABCF4567B",
          registeredAddress: {
            street: "201 Finance Tower, Nariman Point",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400021",
            country: "India",
          },
        },

        hiringPreferences: {
          preferredIndustries: ["BFSI", "Fintech"],
          experienceLevels: ["Entry", "Mid"],
          hiringType: "Permanent",
          avgMonthlyHiringVolume: "6-15",
          typicalCtcBand: "5-20 LPA",
          workModePreference: "Onsite",
          urgencyLevel: "Within 30 days",
        },

        billing: {
          billingEntityName: "FinServe Capital Private Limited",
          paymentTerms: "Net 30",
        },

        legalConsents: {
          termsAccepted: true,
          termsAcceptedAt: now,
          termsAcceptedIp: "127.0.0.1",
          privacyPolicyAccepted: true,
          privacyPolicyAcceptedAt: now,
          privacyPolicyAcceptedIp: "127.0.0.1",
          dataStorageConsent: true,
          dataStorageConsentAt: now,
          dataStorageConsentIp: "127.0.0.1",
          vendorSharingConsent: true,
          vendorSharingConsentAt: now,
          vendorSharingConsentIp: "127.0.0.1",
        },

        documents: {
          gstCertificate:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_gst.pdf",
          panCard:
            "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_pan.pdf",
        },

        verificationStatus: "UNDER_REVIEW",

        profileCompletion: {
          basicInfo: true,
          kyc: true,
          hiringPreferences: true,
          billing: true,
          legalConsents: true,
          documents: true,
        },
      });

      log(
        "✅",
        "Second company (PENDING) created → company2@test.com / Company@123"
      );
    } else {
      skip("Second company (company2@test.com)");
    }

    // ══════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════

    console.log("");
    console.log("═".repeat(60));
    console.log("  🎉  SEEDING COMPLETE");
    console.log("═".repeat(60));
    console.log("");
    console.log("  CREDENTIALS:");
    console.log("  ─────────────────────────────────────────────────");
    console.log("  👑 Admin:       admin@syncro1.com       / Admin@123");
    console.log("  🛡️  Sub-Admin:   subadmin@syncro1.com    / SubAdmin@123");
    console.log("  🤝 Partner:     partner@test.com        / Partner@123  [APPROVED]");
    console.log("  🤝 Partner2:    partner2@test.com       / Partner@123  [PENDING]");
    console.log("  🏢 Company:     company@test.com        / Company@123  [APPROVED]");
    console.log("  🏢 Company2:    company2@test.com       / Company@123  [PENDING]");
    console.log("  ─────────────────────────────────────────────────");
    console.log("");
    console.log("  SEEDED DATA:");
    console.log("  ─────────────────────────────────────────────────");
    console.log("  📦 Subscription Plans:    4 (FREE, GROWTH, PROFESSIONAL, PREMIUM)");
    console.log("  👥 Users:                 6 total");
    console.log("  💼 Jobs (ACTIVE):         4 jobs");
    console.log("    • Senior Software Engineer     [FREE+]   🌟 Featured");
    console.log("    • Product Manager              [FREE+]");
    console.log("    • Data Scientist               [GROWTH+] 🔴 Urgent");
    console.log("    • DevOps Engineer              [PRO+]    🔴 Urgent");
    console.log("  🤝 Job Interest:          Partner→Job1");
    console.log("  ─────────────────────────────────────────────────");
    console.log("");
    console.log("  READY TO TEST:");
    console.log("  ─────────────────────────────────────────────────");
    console.log("  1. Login as partner@test.com → view jobs → submit candidate");
    console.log("  2. Login as admin → verify partner2 & company2");
    console.log("  3. Login as company → post new job → submit for approval");
    console.log("  4. Login as admin → approve job → partner submits candidate");
    console.log("═".repeat(60));
    console.log("");

    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    console.error(error.stack);
    process.exit(1);
  }
};

seedDatabase();