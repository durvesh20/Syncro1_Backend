// backend/seeders/seedDemo.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
const envPath = path.resolve(__dirname, '../.env.development');
dotenv.config({ path: envPath });

if (!process.env.MONGO_URI) {
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
}

// Models
const User = require('../models/User');
const Company = require('../models/Company');
const StaffingPartner = require('../models/StaffingPartner');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const InterviewSlot = require('../models/InterviewSlot');
const JobInterest = require('../models/JobInterest');

const log = (emoji, msg) => console.log(`${emoji}  ${msg}`);

const seedDemoEnvironment = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    log('📦', 'Connected to MongoDB');

    // ─────────────────────────────────────────────────────────
    // STEP 0: CLEAN EXISTING DEMO DATA
    // ─────────────────────────────────────────────────────────
    log('🧹', 'Cleaning existing demo data...');
    await Candidate.deleteMany({ isDemo: true });
    await InterviewSlot.deleteMany({ isDemo: true });
    await JobInterest.deleteMany({ isDemo: true });
    await Job.deleteMany({ isDemo: true });
    await Company.deleteMany({ isDemo: true });
    await StaffingPartner.deleteMany({ isDemo: true });
    await User.deleteMany({ isDemo: true });
    log('✅', 'Existing demo data cleaned');

    const defaultPassword = 'Demo@12345';
    const now = new Date();

    // ─────────────────────────────────────────────────────────
    // STEP 1: CREATE 5 DEMO COMPANIES
    // ─────────────────────────────────────────────────────────
    log('🏢', 'Creating 5 Demo Companies...');

    const companyConfigs = [
      {
        email: 'demo.company1@syncro1.com',
        mobile: '9700000001',
        companyName: 'Nexus AI Technologies Pvt Ltd',
        decisionMakerName: 'Aarav Mehta',
        designation: 'VP of Engineering',
        department: 'Engineering',
        city: 'Bangalore',
        state: 'Karnataka',
        industry: 'Technology',
        employeeCount: '201-500',
        website: 'https://nexusai.demo.syncro1.com',
        description: 'Leading AI solutions provider pioneering generative enterprise workflows.'
      },
      {
        email: 'demo.company2@syncro1.com',
        mobile: '9700000002',
        companyName: 'CloudMatrix Systems LLP',
        decisionMakerName: 'Rohan Deshmukh',
        designation: 'Director of Technology',
        department: 'Infrastructure',
        city: 'Hyderabad',
        state: 'Telangana',
        industry: 'Cloud & DevOps',
        employeeCount: '51-200',
        website: 'https://cloudmatrix.demo.syncro1.com',
        description: 'Next-generation cloud optimization and Kubernetes orchestration agency.'
      },
      {
        email: 'demo.company3@syncro1.com',
        mobile: '9700000003',
        companyName: 'FinVertex Solutions Pvt Ltd',
        decisionMakerName: 'Kavita Sundaram',
        designation: 'Chief Technology Officer',
        department: 'Product & Tech',
        city: 'Mumbai',
        state: 'Maharashtra',
        industry: 'BFSI',
        employeeCount: '500+',
        website: 'https://finvertex.demo.syncro1.com',
        description: 'High-frequency payment gateway and secure digital lending infrastructure.'
      },
      {
        email: 'demo.company4@syncro1.com',
        mobile: '9700000004',
        companyName: 'HealthNova Digital Healthcare',
        decisionMakerName: 'Dr. Siddharth Rao',
        designation: 'Head of Digital Products',
        department: 'Innovation',
        city: 'Pune',
        state: 'Maharashtra',
        industry: 'Healthcare',
        employeeCount: '51-200',
        website: 'https://healthnova.demo.syncro1.com',
        description: 'Telemedicine and automated clinical diagnostic collaboration platform.'
      },
      {
        email: 'demo.company5@syncro1.com',
        mobile: '9700000005',
        companyName: 'RetailPulse E-Commerce Pvt Ltd',
        decisionMakerName: 'Neha Kapoor',
        designation: 'Head of Talent Acquisition',
        department: 'Human Resources',
        city: 'Gurgaon',
        state: 'Haryana',
        industry: 'E-Commerce',
        employeeCount: '201-500',
        website: 'https://retailpulse.demo.syncro1.com',
        description: 'Omnichannel retail operations and hyper-local inventory management engine.'
      }
    ];

    const companies = [];
    for (const cfg of companyConfigs) {
      const user = await User.create({
        email: cfg.email,
        mobile: cfg.mobile,
        password: defaultPassword,
        role: 'company',
        status: 'ACTIVE',
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
        isDemo: true,
        firstName: cfg.decisionMakerName.split(' ')[0],
        lastName: cfg.decisionMakerName.split(' ')[1] || 'Admin',
      });

      const profile = await Company.create({
        user: user._id,
        companyName: cfg.companyName,
        decisionMakerName: cfg.decisionMakerName,
        designation: cfg.designation,
        department: cfg.department,
        city: cfg.city,
        state: cfg.state,
        uniqueId: `DEMO-COMP-${cfg.mobile.slice(-4)}`,
        isDemo: true,
        verificationStatus: 'APPROVED',
        verifiedAt: now,
        kyc: {
          registeredName: cfg.companyName,
          tradeName: cfg.companyName.split(' ')[0],
          website: cfg.website,
          industry: cfg.industry,
          companyType: 'Private Limited',
          employeeCount: cfg.employeeCount,
          description: cfg.description,
          registeredAddress: {
            street: '100 Innovation Park, Tech Zone',
            city: cfg.city,
            state: cfg.state,
            pincode: '560001',
            country: 'India'
          }
        },
        hiringPreferences: {
          preferredIndustries: [cfg.industry, 'Technology'],
          experienceLevels: ['Mid', 'Senior', 'Executive'],
          hiringType: 'Permanent',
          avgMonthlyHiringVolume: '6-15',
          urgencyLevel: 'Within 30 days'
        },
        billing: {
          billingEntityName: cfg.companyName,
          paymentTerms: 'Net 30',
          preferredPaymentMethod: 'Bank Transfer'
        },
        legalConsents: {
          termsAccepted: true,
          termsAcceptedAt: now,
          privacyPolicyAccepted: true,
          privacyPolicyAcceptedAt: now
        },
        profileCompletion: {
          basicInfo: true,
          kyc: true,
          hiringPreferences: true,
          billing: true,
          legalConsents: true,
          documents: true
        }
      });

      companies.push({ user, profile });
    }
    log('✅', `Created ${companies.length} Demo Companies`);

    // ─────────────────────────────────────────────────────────
    // STEP 2: CREATE 10 DEMO TALENT PARTNERS (VENDORS)
    // ─────────────────────────────────────────────────────────
    log('🤝', 'Creating 10 Demo Talent Partners (Vendors)...');

    const partnerConfigs = [
      { email: 'demo.partner1@syncro1.com', mobile: '9600000001', name: 'Vikram Joshi', firm: 'Apex Talent Consultants', city: 'Bangalore', state: 'Karnataka', plan: 'PREMIUM' },
      { email: 'demo.partner2@syncro1.com', mobile: '9600000002', name: 'Sunita Menon', firm: 'Vanguard Search Partners', city: 'Mumbai', state: 'Maharashtra', plan: 'PROFESSIONAL' },
      { email: 'demo.partner3@syncro1.com', mobile: '9600000003', name: 'Rajesh Kulkarni', firm: 'PrimeHire Agency', city: 'Hyderabad', state: 'Telangana', plan: 'GROWTH' },
      { email: 'demo.partner4@syncro1.com', mobile: '9600000004', name: 'Meera Nambiar', firm: 'NextGen Staffing Solutions', city: 'Pune', state: 'Maharashtra', plan: 'FREE' },
      { email: 'demo.partner5@syncro1.com', mobile: '9600000005', name: 'Amitabh Sen', firm: 'TechHunt Executives', city: 'Gurgaon', state: 'Haryana', plan: 'GROWTH' },
      { email: 'demo.partner6@syncro1.com', mobile: '9600000006', name: 'Pooja Bhatt', firm: 'TalentBridge Global', city: 'Chennai', state: 'Tamil Nadu', plan: 'PROFESSIONAL' },
      { email: 'demo.partner7@syncro1.com', mobile: '9600000007', name: 'Gaurav Aggarwal', firm: 'Catalyst HR Services', city: 'Delhi', state: 'Delhi', plan: 'PREMIUM' },
      { email: 'demo.partner8@syncro1.com', mobile: '9600000008', name: 'Ananya Banerjee', firm: 'Elevate Talent Partners', city: 'Kolkata', state: 'West Bengal', plan: 'GROWTH' },
      { email: 'demo.partner9@syncro1.com', mobile: '9600000009', name: 'Hardik Patel', firm: 'SkillSync Staffing', city: 'Ahmedabad', state: 'Gujarat', plan: 'FREE' },
      { email: 'demo.partner10@syncro1.com', mobile: '9600000010', name: 'Divya Saxena', firm: 'Horizon Talent Search', city: 'Noida', state: 'Uttar Pradesh', plan: 'PROFESSIONAL' }
    ];

    const partners = [];
    for (const p of partnerConfigs) {
      const user = await User.create({
        email: p.email,
        mobile: p.mobile,
        password: defaultPassword,
        role: 'staffing_partner',
        status: 'ACTIVE',
        emailVerified: true,
        mobileVerified: true,
        isPasswordChanged: true,
        isDemo: true,
        firstName: p.name.split(' ')[0],
        lastName: p.name.split(' ')[1] || 'Partner',
      });

      const profile = await StaffingPartner.create({
        user: user._id,
        firstName: p.name.split(' ')[0],
        lastName: p.name.split(' ')[1] || 'Partner',
        firmName: p.firm,
        designation: 'Managing Partner',
        city: p.city,
        state: p.state,
        uniqueId: `DEMO-PART-${p.mobile.slice(-4)}`,
        isDemo: true,
        verificationStatus: 'APPROVED',
        verifiedAt: now,
        subscription: {
          plan: p.plan,
          status: 'ACTIVE',
          startDate: now,
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        },
        firmDetails: {
          registeredName: `${p.firm} Private Limited`,
          tradeName: p.firm,
          entityType: 'Private Limited',
          yearEstablished: 2018,
          registeredOfficeAddress: {
            street: '45 Business District Avenue',
            city: p.city,
            state: p.state,
            pincode: '110001',
            country: 'India'
          }
        },
        profileCompletion: {
          basicInfo: true,
          firmDetails: true,
          geographicReach: true,
          compliance: true,
          commercialDetails: true,
          documents: true
        }
      });

      partners.push({ user, profile });
    }
    log('✅', `Created ${partners.length} Demo Talent Partners (Vendors)`);

    // ─────────────────────────────────────────────────────────
    // STEP 3: CREATE 25 DEMO JOBS ACROSS COMPANIES
    // ─────────────────────────────────────────────────────────
    log('💼', 'Creating 25 Demo Jobs across companies...');

    const jobSpecs = [
      // Company 1: Nexus AI Technologies (5 Jobs)
      {
        companyIdx: 0,
        title: 'Staff Full-Stack Engineer (React, Node.js)',
        category: 'Technology',
        subCategory: 'Full Stack',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 5, max: 10 },
        salary: { min: 2500000, max: 4500000, currency: 'INR', isNegotiable: true },
        location: { city: 'Bangalore', state: 'Karnataka', isRemote: true, remoteType: 'Hybrid' },
        skills: ['React', 'Node.js', 'TypeScript', 'MongoDB', 'AWS', 'Redis'],
        vacancies: 3,
        description: 'Nexus AI is seeking a Staff Full-Stack Engineer to architect resilient web interfaces and scalable backend systems for our AI product suite.'
      },
      {
        companyIdx: 0,
        title: 'Lead AI/ML Research Engineer (PyTorch, LLMs)',
        category: 'Technology',
        subCategory: 'Machine Learning',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 6, max: 12 },
        salary: { min: 3500000, max: 6000000, currency: 'INR', isNegotiable: true },
        location: { city: 'Bangalore', state: 'Karnataka', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Python', 'PyTorch', 'HuggingFace', 'Transformers', 'CUDA', 'Vector Databases'],
        vacancies: 2,
        description: 'Join our Core AI Team to fine-tune open-source LLMs and build automated agentic pipelines for enterprise automation.'
      },
      {
        companyIdx: 0,
        title: 'Senior Prompt Engineer & LLM Evaluator',
        category: 'Technology',
        subCategory: 'AI Engineering',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 3, max: 7 },
        salary: { min: 1800000, max: 3000000, currency: 'INR', isNegotiable: true },
        location: { city: 'Bangalore', state: 'Karnataka', isRemote: true, remoteType: 'Remote' },
        skills: ['Prompt Engineering', 'LangChain', 'OpenAI API', 'Python', 'Evaluation Benchmarks'],
        vacancies: 2,
        description: 'Design, test, and benchmark domain-specific prompt templates and automated grading systems for generative AI assistants.'
      },
      {
        companyIdx: 0,
        title: 'AI Product Manager (Enterprise Agents)',
        category: 'Product',
        subCategory: 'AI Product',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 5, max: 10 },
        salary: { min: 2800000, max: 4800000, currency: 'INR', isNegotiable: true },
        location: { city: 'Bangalore', state: 'Karnataka', isRemote: true, remoteType: 'Hybrid' },
        skills: ['AI Product Strategy', 'SaaS', 'Roadmapping', 'User Research', 'Agent Workflows'],
        vacancies: 2,
        description: 'Lead the vision, discovery, and execution of autonomous enterprise workflows powered by LLMs and multi-agent systems.'
      },
      {
        companyIdx: 0,
        title: 'Enterprise Sales Director (SaaS / AI)',
        category: 'Sales',
        subCategory: 'Enterprise Sales',
        employmentType: 'Full-time',
        experienceLevel: 'Executive',
        experienceRange: { min: 8, max: 15 },
        salary: { min: 3500000, max: 6500000, currency: 'INR', isNegotiable: true },
        location: { city: 'Bangalore', state: 'Karnataka', isRemote: false, remoteType: 'On-site' },
        skills: ['B2B Sales', 'Enterprise SaaS', 'Contract Negotiation', 'C-Level Selling'],
        vacancies: 1,
        description: 'Spearhead revenue generation across Tier-1 enterprise clients for Nexus AI platform software and custom deployment suites.'
      },

      // Company 2: CloudMatrix Systems (5 Jobs)
      {
        companyIdx: 1,
        title: 'Senior Cloud Platform Engineer (AWS & Kubernetes)',
        category: 'Technology',
        subCategory: 'DevOps & Cloud',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 4, max: 9 },
        salary: { min: 2200000, max: 3800000, currency: 'INR', isNegotiable: false },
        location: { city: 'Hyderabad', state: 'Telangana', isRemote: false, remoteType: 'On-site' },
        skills: ['Kubernetes', 'AWS', 'Terraform', 'Helm', 'CI/CD', 'Prometheus'],
        vacancies: 3,
        description: 'Manage high-reliability multi-region AWS infrastructure with automated GitOps pipelines and zero-downtime releases.'
      },
      {
        companyIdx: 1,
        title: 'Site Reliability Engineer (Observability & CI/CD)',
        category: 'Technology',
        subCategory: 'SRE',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 3, max: 6 },
        salary: { min: 1600000, max: 2800000, currency: 'INR', isNegotiable: true },
        location: { city: 'Hyderabad', state: 'Telangana', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Datadog', 'Grafana', 'Prometheus', 'Linux', 'Python', 'Docker'],
        vacancies: 2,
        description: 'Drive reliability and telemetry observability across hundreds of microservices processing billions of events daily.'
      },
      {
        companyIdx: 1,
        title: 'Lead Security & DevSecOps Engineer',
        category: 'Technology',
        subCategory: 'Cloud Security',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 6, max: 11 },
        salary: { min: 2600000, max: 4500000, currency: 'INR', isNegotiable: true },
        location: { city: 'Hyderabad', state: 'Telangana', isRemote: true, remoteType: 'Hybrid' },
        skills: ['DevSecOps', 'Container Security', 'Falco', 'Trivy', 'AWS IAM', 'SAST/DAST'],
        vacancies: 2,
        description: 'Embed security guardrails directly into CI/CD pipelines, container registries, and cloud infrastructure.'
      },
      {
        companyIdx: 1,
        title: 'Solutions Architect (Cloud Migrations)',
        category: 'Technology',
        subCategory: 'Solutions Architecture',
        employmentType: 'Full-time',
        experienceLevel: 'Executive',
        experienceRange: { min: 8, max: 14 },
        salary: { min: 3600000, max: 6000000, currency: 'INR', isNegotiable: true },
        location: { city: 'Hyderabad', state: 'Telangana', isRemote: false, remoteType: 'On-site' },
        skills: ['Cloud Migration', 'AWS Well-Architected', 'Microservices', 'Cost Optimization'],
        vacancies: 2,
        description: 'Design end-to-end cloud migration blueprints for legacy monoliths moving to scalable cloud-native architectures.'
      },
      {
        companyIdx: 1,
        title: 'Technical Account Manager (Cloud Clients)',
        category: 'Customer Success',
        subCategory: 'Technical Accounts',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 3, max: 7 },
        salary: { min: 1400000, max: 2400000, currency: 'INR', isNegotiable: true },
        location: { city: 'Hyderabad', state: 'Telangana', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Account Management', 'SLA Management', 'Cloud Basics', 'Customer Retention'],
        vacancies: 2,
        description: 'Act as the primary technical point of contact for key enterprise accounts utilizing CloudMatrix infrastructure services.'
      },

      // Company 3: FinVertex Solutions (5 Jobs)
      {
        companyIdx: 2,
        title: 'Principal Backend Architect (Go & Distributed Systems)',
        category: 'Technology',
        subCategory: 'Backend Architecture',
        employmentType: 'Full-time',
        experienceLevel: 'Executive',
        experienceRange: { min: 8, max: 15 },
        salary: { min: 4000000, max: 7000000, currency: 'INR', isNegotiable: true },
        location: { city: 'Mumbai', state: 'Maharashtra', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Go', 'Kafka', 'PostgreSQL', 'Distributed Systems', 'gRPC', 'High Throughput'],
        vacancies: 2,
        description: 'Lead the architecture of our core high-throughput ledger transaction engine processing tens of thousands of requests per second.'
      },
      {
        companyIdx: 2,
        title: 'Senior Security & Compliance Engineer (FinTech / PCI-DSS)',
        category: 'Technology',
        subCategory: 'Cybersecurity',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 5, max: 10 },
        salary: { min: 2600000, max: 4200000, currency: 'INR', isNegotiable: true },
        location: { city: 'Mumbai', state: 'Maharashtra', isRemote: false, remoteType: 'On-site' },
        skills: ['PCI-DSS', 'SOC2', 'Threat Modeling', 'Penetration Testing', 'IAM', 'Cloud Security'],
        vacancies: 2,
        description: 'Ensure bank-grade security and strict compliance across our payments infrastructure and cloud services.'
      },
      {
        companyIdx: 2,
        title: 'Lead Android Engineer (Fintech Banking App)',
        category: 'Technology',
        subCategory: 'Mobile Engineering',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 5, max: 10 },
        salary: { min: 2400000, max: 4000000, currency: 'INR', isNegotiable: true },
        location: { city: 'Mumbai', state: 'Maharashtra', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Kotlin', 'Android SDK', 'Jetpack Compose', 'MVVM', 'Payment Gateways'],
        vacancies: 2,
        description: 'Build secure, lightning-fast digital banking and merchant payment apps serving over 5 million daily active users.'
      },
      {
        companyIdx: 2,
        title: 'Product Operations Manager (Payments)',
        category: 'Operations',
        subCategory: 'Fintech Operations',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 3, max: 7 },
        salary: { min: 1500000, max: 2600000, currency: 'INR', isNegotiable: true },
        location: { city: 'Mumbai', state: 'Maharashtra', isRemote: false, remoteType: 'On-site' },
        skills: ['Payment Reconciliation', 'Dispute Resolution', 'RBI Compliance', 'SQL'],
        vacancies: 2,
        description: 'Streamline payment settlement workflows, chargeback dispute resolutions, and bank partner integration audits.'
      },
      {
        companyIdx: 2,
        title: 'Senior Risk & Fraud Analyst',
        category: 'Finance',
        subCategory: 'Risk Management',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 4, max: 8 },
        salary: { min: 1800000, max: 3200000, currency: 'INR', isNegotiable: true },
        location: { city: 'Mumbai', state: 'Maharashtra', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Fraud Detection', 'Rule Engines', 'SQL', 'Python', 'Transaction Monitoring'],
        vacancies: 2,
        description: 'Formulate fraud rule heuristics and anomaly detection pipelines to safeguard transaction flows against financial risk.'
      },

      // Company 4: HealthNova Digital Healthcare (5 Jobs)
      {
        companyIdx: 3,
        title: 'Senior Frontend Engineer (React & TypeScript)',
        category: 'Technology',
        subCategory: 'Frontend',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 4, max: 8 },
        salary: { min: 2000000, max: 3400000, currency: 'INR', isNegotiable: true },
        location: { city: 'Pune', state: 'Maharashtra', isRemote: true, remoteType: 'Hybrid' },
        skills: ['React', 'TypeScript', 'Tailwind CSS', 'Redux Toolkit', 'WebRTC', 'Chart.js'],
        vacancies: 3,
        description: 'Build patient-facing consultation video apps and physician diagnostic dashboards with seamless responsiveness.'
      },
      {
        companyIdx: 3,
        title: 'Technical Product Manager (HealthTech Platforms)',
        category: 'Product',
        subCategory: 'Technical Product Management',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 5, max: 10 },
        salary: { min: 2400000, max: 4000000, currency: 'INR', isNegotiable: true },
        location: { city: 'Pune', state: 'Maharashtra', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Product Strategy', 'Agile / Scrum', 'FHIR / HL7', 'API Design', 'User Research'],
        vacancies: 2,
        description: 'Bridge clinical requirements and engineering execution to build the next standard in patient management platforms.'
      },
      {
        companyIdx: 3,
        title: 'Senior Backend Engineer (Python / FastAPI)',
        category: 'Technology',
        subCategory: 'Backend',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 4, max: 8 },
        salary: { min: 2000000, max: 3500000, currency: 'INR', isNegotiable: true },
        location: { city: 'Pune', state: 'Maharashtra', isRemote: true, remoteType: 'Remote' },
        skills: ['Python', 'FastAPI', 'PostgreSQL', 'Docker', 'AsyncIO', 'Redis'],
        vacancies: 2,
        description: 'Develop high-performance asynchronous microservices for electronic health records, prescription parsing, and scheduling.'
      },
      {
        companyIdx: 3,
        title: 'Healthcare Data Compliance Lead (HIPAA / FHIR)',
        category: 'Operations',
        subCategory: 'Healthcare Compliance',
        employmentType: 'Full-time',
        experienceLevel: 'Executive',
        experienceRange: { min: 7, max: 13 },
        salary: { min: 2800000, max: 4600000, currency: 'INR', isNegotiable: true },
        location: { city: 'Pune', state: 'Maharashtra', isRemote: false, remoteType: 'On-site' },
        skills: ['HIPAA', 'FHIR', 'Health Data Privacy', 'ISO 27799', 'Audit Management'],
        vacancies: 1,
        description: 'Enforce stringent clinical data governance, patient privacy policies, and regulatory compliance standards across services.'
      },
      {
        companyIdx: 3,
        title: 'UI/UX Product Designer (Healthcare Design Systems)',
        category: 'Design',
        subCategory: 'Product Design',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 3, max: 7 },
        salary: { min: 1400000, max: 2500000, currency: 'INR', isNegotiable: true },
        location: { city: 'Pune', state: 'Maharashtra', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Figma', 'Design Systems', 'User Research', 'Accessibility (WCAG)', 'Prototyping'],
        vacancies: 2,
        description: 'Create intuitive, accessible user interfaces for doctors, triage nurses, and elderly patients undergoing virtual consultations.'
      },

      // Company 5: RetailPulse E-Commerce (5 Jobs)
      {
        companyIdx: 4,
        title: 'Senior Data Engineer (Spark, Snowflake, dbt)',
        category: 'Technology',
        subCategory: 'Data Engineering',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 4, max: 9 },
        salary: { min: 2200000, max: 3800000, currency: 'INR', isNegotiable: true },
        location: { city: 'Gurgaon', state: 'Haryana', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Apache Spark', 'Snowflake', 'dbt', 'Python', 'Airflow', 'SQL'],
        vacancies: 3,
        description: 'Design and optimize robust ETL/ELT pipelines ingesting hundreds of millions of order events and customer telemetry data.'
      },
      {
        companyIdx: 4,
        title: 'Engineering Manager (E-Commerce Platform)',
        category: 'Technology',
        subCategory: 'Engineering Leadership',
        employmentType: 'Full-time',
        experienceLevel: 'Executive',
        experienceRange: { min: 8, max: 14 },
        salary: { min: 3800000, max: 6200000, currency: 'INR', isNegotiable: true },
        location: { city: 'Gurgaon', state: 'Haryana', isRemote: false, remoteType: 'On-site' },
        skills: ['Team Leadership', 'Agile Delivery', 'System Design', 'Hiring & Mentorship', 'Microservices'],
        vacancies: 1,
        description: 'Lead a high-performing squad of 10+ engineers building out our checkout, cart, and discount calculation systems.'
      },
      {
        companyIdx: 4,
        title: 'Lead iOS Engineer (Swift / E-Commerce)',
        category: 'Technology',
        subCategory: 'Mobile Engineering',
        employmentType: 'Full-time',
        experienceLevel: 'Senior',
        experienceRange: { min: 5, max: 10 },
        salary: { min: 2400000, max: 4200000, currency: 'INR', isNegotiable: true },
        location: { city: 'Gurgaon', state: 'Haryana', isRemote: true, remoteType: 'Hybrid' },
        skills: ['Swift', 'SwiftUI', 'iOS Architecture', 'Offline Caching', 'Performance Tuning'],
        vacancies: 2,
        description: 'Craft consumer-facing iOS shopping experiences with sub-second product page load times and fluid checkout flows.'
      },
      {
        companyIdx: 4,
        title: 'Growth & Digital Marketing Lead',
        category: 'Marketing',
        subCategory: 'Performance Marketing',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 4, max: 8 },
        salary: { min: 1600000, max: 2800000, currency: 'INR', isNegotiable: true },
        location: { city: 'Gurgaon', state: 'Haryana', isRemote: false, remoteType: 'On-site' },
        skills: ['Performance Marketing', 'SEO / SEM', 'Google Ads', 'CAC Optimization', 'Analytics'],
        vacancies: 2,
        description: 'Drive customer acquisition and retention strategies through data-backed performance marketing campaigns and viral loops.'
      },
      {
        companyIdx: 4,
        title: 'Supply Chain & Inventory Tech Specialist',
        category: 'Operations',
        subCategory: 'Supply Chain Tech',
        employmentType: 'Full-time',
        experienceLevel: 'Mid',
        experienceRange: { min: 3, max: 7 },
        salary: { min: 1300000, max: 2200000, currency: 'INR', isNegotiable: true },
        location: { city: 'Gurgaon', state: 'Haryana', isRemote: false, remoteType: 'On-site' },
        skills: ['WMS Systems', 'Inventory Forecasting', 'Logistics Analytics', 'SQL'],
        vacancies: 2,
        description: 'Optimize automated warehouse management system dispatching and predictive inventory restocking algorithms.'
      }
    ];

    const jobs = [];
    for (let i = 0; i < jobSpecs.length; i++) {
      const spec = jobSpecs[i];
      const comp = companies[spec.companyIdx];
      const deadline = new Date(Date.now() + (45 + (i * 2)) * 24 * 60 * 60 * 1000);

      const job = await Job.create({
        company: comp.profile._id,
        postedBy: comp.user._id,
        title: spec.title,
        category: spec.category,
        subCategory: spec.subCategory,
        employmentType: spec.employmentType,
        experienceLevel: spec.experienceLevel,
        experienceRange: spec.experienceRange,
        salary: spec.salary,
        location: spec.location,
        skills: {
          required: spec.skills,
          preferred: spec.skills.slice(-2)
        },
        vacancies: spec.vacancies,
        description: spec.description,
        requirements: [
          `${spec.experienceRange.min}+ years professional experience`,
          `Proficiency in ${spec.skills.slice(0, 3).join(', ')}`,
          'Strong analytical thinking and cross-functional collaboration skills'
        ],
        responsibilities: [
          'Lead feature delivery and maintain high engineering quality standards',
          'Collaborate directly with cross-functional stakeholders',
          'Participate in design and architectural peer reviews'
        ],
        applicationDeadline: deadline,
        status: 'ACTIVE',
        approvalStatus: 'ACTIVE',
        approvedAt: now,
        uniqueId: `DEMO-JOB-${i + 1}-${Date.now()}`,
        isDemo: true,
        eligiblePlans: ['FREE', 'GROWTH', 'PROFESSIONAL', 'PREMIUM'],
        isFeatured: i % 3 === 0,
        isUrgent: i % 4 === 0,
        metrics: { views: 50 + i * 15, applications: 10 + i * 4 }
      });

      jobs.push(job);
    }
    log('✅', `Created ${jobs.length} Demo Jobs across 5 companies`);

    // ─────────────────────────────────────────────────────────
    // STEP 4: CREATE JOB INTERESTS (VENDORS LINKED TO JOBS)
    // ─────────────────────────────────────────────────────────
    log('🔗', 'Creating Job Interests for all 10 Talent Partners (Vendors)...');
    let interestCount = 0;
    for (let pIdx = 0; pIdx < partners.length; pIdx++) {
      const partner = partners[pIdx];
      // Every vendor expresses interest in 6-8 jobs across companies
      for (let jOffset = 0; jOffset < 7; jOffset++) {
        const jIdx = (pIdx * 2 + jOffset) % jobs.length;
        const job = jobs[jIdx];

        await JobInterest.create({
          partner: partner.profile._id,
          job: job._id,
          user: partner.user._id,
          status: 'ACTIVE',
          submissionCount: 2 + (jOffset % 3),
          submissionLimit: 15,
          isDemo: true
        });
        interestCount++;
      }
    }
    log('✅', `Created ${interestCount} Demo Job Interests across 10 vendors`);

    // ─────────────────────────────────────────────────────────
    // STEP 5: CREATE DEMO INTERVIEW SLOTS (25 SLOTS)
    // ─────────────────────────────────────────────────────────
    log('📅', 'Creating Demo Interview Slots across all jobs...');
    const demoSlots = [];

    const slotTimes = [
      { start: '10:00 AM', end: '11:00 AM' },
      { start: '11:30 AM', end: '12:30 PM' },
      { start: '02:00 PM', end: '03:00 PM' },
      { start: '04:00 PM', end: '05:00 PM' },
      { start: '05:30 PM', end: '06:30 PM' }
    ];

    for (let j = 0; j < jobs.length; j++) {
      const job = jobs[j];
      const slotTime = slotTimes[j % slotTimes.length];
      const slotDate = new Date();
      slotDate.setDate(slotDate.getDate() + 2 + (j % 6)); // 2 to 8 days in future

      const slot = await InterviewSlot.create({
        job: job._id,
        company: job.company,
        date: slotDate,
        startTime: slotTime.start,
        endTime: slotTime.end,
        maxCandidates: 4,
        averageTime: 30,
        availableSpots: 3,
        status: 'ACTIVE',
        isTagged: true,
        meetingLink: 'https://meet.google.com/syncro1-demo-interview',
        interviewMode: 'Virtual',
        roundType: j % 3 === 0 ? 'HR' : 'Technical',
        roundNumber: j % 3 === 0 ? 2 : 1,
        isDemo: true,
        notes: 'Please join 5 minutes early with your camera enabled.'
      });

      demoSlots.push(slot);
    }
    log('✅', `Created ${demoSlots.length} Demo Interview Slots`);

    // ─────────────────────────────────────────────────────────
    // STEP 6: CREATE 144 DEMO CANDIDATES (14-15 PER VENDOR)
    // ─────────────────────────────────────────────────────────
    log('👤', 'Creating 144 Demo Candidates across 10 Vendors and 25 Jobs...');

    const firstNames = [
      'Aditya', 'Riya', 'Kunal', 'Priyanka', 'Manish', 'Shweta', 'Deepak', 'Tanvi',
      'Nikhil', 'Pooja', 'Vivek', 'Kavya', 'Harish', 'Smriti', 'Arjun', 'Bhavna',
      'Gautam', 'Isha', 'Karthik', 'Meghna', 'Pranav', 'Rashmi', 'Siddharth', 'Tanya',
      'Varun', 'Aakriti', 'Chetan', 'Divyansh', 'Farhan', 'Garima', 'Hemant', 'Janhavi',
      'Kabir', 'Lavanya', 'Mayank', 'Nandini', 'Omkar', 'Pallavi', 'Qadir', 'Rupal',
      'Sameer', 'Tejaswini', 'Utkarsh', 'Vaishnavi', 'Waseem', 'Yashwardhan', 'Zoya', 'Aniket',
      'Aakash', 'Bhumika', 'Chirag', 'Drishti', 'Eshwar', 'Falguni', 'Girish', 'Himani',
      'Inder', 'Juhi', 'Kamlesh', 'Leena', 'Madhav', 'Nisha', 'Ojas', 'Parul',
      'Raman', 'Sakshi', 'Tarun', 'Urvashi', 'Vinay', 'Yogita'
    ];

    const lastNames = [
      'Verma', 'Sengupta', 'Sharma', 'Das', 'Pandey', 'Kulkarni', 'Nair', 'Agarwal',
      'Saxena', 'Hegde', 'Joshi', 'Raman', 'Babu', 'Mishra', 'Nambiar', 'Chauhan',
      'Menon', 'Singhania', 'Raja', 'Roy', 'Rao', 'Pillai', 'Jain', 'Grover',
      'Bhatia', 'Chadha', 'Murthy', 'Tyagi', 'Ali', 'Sethi', 'Trivedi', 'Somani',
      'Malhotra', 'Swaminathan', 'Mittal', 'Patwardhan', 'Dixit', 'Sheikh', 'Choksi', 'Bhardwaj',
      'Gokhale', 'Bajpai', 'Reddy', 'Akram', 'Shukla', 'Farooqui', 'Deshmukh', 'Gupta'
    ];

    const pipelineStages = [
      'SHORTLISTED', 'SHORTLISTED', 'SHORTLISTED',
      'SUBMITTED', 'SUBMITTED',
      'ASSESSMENT_PENDING', 'ASSESSMENT_PASSED',
      'SLOTS_PUBLISHED', 'SLOT_ASSIGNED', 'SLOT_DETAILS_SHARED',
      'INTERVIEW_SCHEDULED', 'INTERVIEW_CONFIRMED',
      'INTERVIEW_CONDUCTED', 'ROUND_SELECTED_NEXT',
      'HR_ROUND_PENDING', 'HR_SELECTED',
      'OFFER_SENT', 'OFFER_ACCEPTED', 'JOINED'
    ];

    let candidateCount = 0;
    const totalCandidatesToCreate = 144; // ~14-15 per vendor

    for (let cIdx = 0; cIdx < totalCandidatesToCreate; cIdx++) {
      const fName = firstNames[cIdx % firstNames.length];
      const lName = lastNames[(cIdx * 3 + Math.floor(cIdx / firstNames.length)) % lastNames.length];
      const partner = partners[cIdx % partners.length]; // Evenly assigned across all 10 vendors
      const job = jobs[cIdx % jobs.length]; // Evenly assigned across 25 jobs
      const slot = demoSlots[cIdx % demoSlots.length];
      const status = pipelineStages[cIdx % pipelineStages.length];

      const mobileNum = `980000${String(cIdx + 1).padStart(4, '0')}`;
      const email = `demo.cand${cIdx + 1}@syncro1.com`;
      const exp = 3 + (cIdx % 9);

      // Build candidate rounds
      const rounds = [
        {
          roundNumber: 1,
          roundType: 'Technical',
          status: ['INTERVIEW_CONFIRMED', 'INTERVIEW_CONDUCTED', 'ROUND_SELECTED_NEXT', 'HR_ROUND_PENDING', 'HR_SELECTED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'JOINED'].includes(status)
            ? 'CONFIRMED'
            : ['INTERVIEW_SCHEDULED', 'SLOT_DETAILS_SHARED'].includes(status)
            ? 'SCHEDULED'
            : ['SLOT_ASSIGNED', 'SLOTS_PUBLISHED'].includes(status)
            ? 'SLOTS_PUBLISHED'
            : 'NOT_STARTED',
          scheduledAt: slot.date,
          slots: [
            {
              slotId: slot._id,
              date: slot.date,
              startTime: slot.startTime,
              endTime: slot.endTime,
              meetingLink: slot.meetingLink,
              interviewMode: slot.interviewMode,
              status: ['INTERVIEW_CONFIRMED', 'JOINED', 'OFFER_ACCEPTED'].includes(status) ? 'CONFIRMED' : 'BOOKED'
            }
          ]
        },
        {
          roundNumber: 2,
          roundType: 'HR',
          status: ['HR_SELECTED', 'OFFER_SENT', 'OFFER_ACCEPTED', 'JOINED'].includes(status)
            ? 'PASSED'
            : status === 'HR_ROUND_PENDING'
            ? 'SCHEDULED'
            : 'NOT_STARTED'
        }
      ];

      const candidateDoc = {
        firstName: fName,
        lastName: lName,
        email,
        mobile: mobileNum,
        job: job._id,
        company: job.company,
        submittedBy: partner.profile._id,
        status,
        uniqueId: `DEMO-CAND-${cIdx + 1}-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
        isDemo: true,
        consent: {
          given: true,
          givenAt: now,
          consentStatus: 'CONFIRMED',
          consentConfirmedAt: now
        },
        resume: {
          url: 'https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf',
          fileName: `${fName}_${lName}_Resume.pdf`,
          uploadedAt: now
        },
        profile: {
          location: Array.isArray(job.location?.city) ? (job.location.city[0] || 'Bangalore') : (job.location?.city || 'Bangalore'),
          totalExperience: exp,
          relevantExperience: Math.max(1, exp - 1),
          currentDesignation: job.title.split('(')[0].trim(),
          skills: (job.skills?.required && Array.isArray(job.skills.required))
            ? job.skills.required.slice(0, 4)
            : (Array.isArray(job.skills) ? job.skills.slice(0, 4) : ['React', 'Node.js', 'TypeScript', 'SQL']),
          noticePeriod: '15-30 Days',
          currentSalary: exp * 280000,
          expectedSalary: (exp + 2) * 340000,
          currency: 'INR'
        },
        rounds,
        statusHistory: [
          { status: 'SUBMITTED', changedAt: now, changedBy: partner.user._id },
          { status, changedAt: now, changedBy: job.postedBy || partner.user._id }
        ]
      };

      // Tag slot if candidate is scheduled or confirmed
      if (['INTERVIEW_SCHEDULED', 'INTERVIEW_CONFIRMED', 'SLOT_DETAILS_SHARED'].includes(status)) {
        candidateDoc.assignedSlot = slot._id;
      }

      // Add offer details if offer stage
      if (['OFFER_SENT', 'OFFER_ACCEPTED', 'JOINED'].includes(status)) {
        candidateDoc.offer = {
          salary: 3000000,
          inhandCtc: 2600000,
          joiningDate: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
          isOfferSent: true,
          response: status === 'OFFER_SENT' ? 'PENDING' : 'ACCEPTED'
        };
      }

      const cand = await Candidate.create(candidateDoc);

      // Book into slot if applicable
      if (['INTERVIEW_SCHEDULED', 'INTERVIEW_CONFIRMED', 'SLOT_DETAILS_SHARED'].includes(status)) {
        await InterviewSlot.findByIdAndUpdate(slot._id, {
          $push: {
            bookedCandidates: {
              candidate: cand._id,
              partner: partner.profile._id,
              bookingStatus: 'BOOKED',
              bookedAt: now
            }
          }
        });
      }

      candidateCount++;
    }

    log('✅', `Created ${candidateCount} Demo Candidates (~14 per vendor across all pipeline stages)`);

    // ─────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────
    console.log('');
    console.log('═'.repeat(70));
    console.log('  🎉  EXPANDED DEMO ENVIRONMENT SEEDING COMPLETE');
    console.log('═'.repeat(70));
    console.log('');
    console.log('  DEMO COMPANY CREDENTIALS (Password for all: Demo@12345):');
    console.log('  ─────────────────────────────────────────────────────────────────');
    for (let i = 0; i < companyConfigs.length; i++) {
      console.log(`  🏢 ${companyConfigs[i].companyName.padEnd(35)} → ${companyConfigs[i].email}`);
    }
    console.log('');
    console.log('  DEMO TALENT PARTNER (VENDOR) CREDENTIALS (Password: Demo@12345):');
    console.log('  ─────────────────────────────────────────────────────────────────');
    for (let i = 0; i < partnerConfigs.length; i++) {
      console.log(`  🤝 ${partnerConfigs[i].firm.padEnd(32)} (${partnerConfigs[i].plan.padEnd(12)}) → ${partnerConfigs[i].email}`);
    }
    console.log('');
    console.log('  DEMO DATA METRICS:');
    console.log('  ─────────────────────────────────────────────────────────────────');
    console.log(`  🏢 Companies:                 ${companies.length}`);
    console.log(`  🤝 Talent Partners (Vendors): ${partners.length}`);
    console.log(`  💼 Jobs Posted:               ${jobs.length} (5 per company)`);
    console.log(`  📅 Interview Slots:           ${demoSlots.length}`);
    console.log(`  🔗 Job Interests:             ${interestCount} (7 per vendor)`);
    console.log(`  👤 Candidates Submitted:      ${candidateCount} (~14-15 per vendor)`);
    console.log('═'.repeat(70));
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Demo seeding failed:', error);
    process.exit(1);
  }
};

seedDemoEnvironment();
