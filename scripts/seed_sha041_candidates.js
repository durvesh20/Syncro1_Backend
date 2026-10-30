// backend/scripts/seed_sha041_candidates.js
const mongoose = require('mongoose');

const uri = 'mongodb+srv://Syncro1:Syncro1%40Devteam@cluster0.tbabey6.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0';

async function seedCandidates() {
  console.log('Connecting to dev DB (test database)...');
  await mongoose.connect(uri);
  console.log('Connected to MongoDB successfully!');

  const Candidate = require('../models/Candidate');
  const Job = require('../models/Job');
  const JobInterest = require('../models/JobInterest');

  // Verify Job sha041
  const job = await Job.findOne({ uniqueId: 'sha041' });
  if (!job) {
    console.error('Job sha041 not found in test database!');
    process.exit(1);
  }
  console.log(`Found job: "${job.title}" (_id: ${job._id}) for company (_id: ${job.company})`);

  // Default active partner: Virat Kholi (Firm: '18') or RK Talent Solutions
  const partnerId = new mongoose.Types.ObjectId('6a38d655062b6e2ef36a2b5f');

  const candidatesData = [
    {
      firstName: "Arjun",
      lastName: "Mehta",
      email: "arjun.mehta.fsd@gmail.com",
      mobile: "9820145678",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 24 * 2),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 180000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Arjun_Mehta_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2)
      },
      profile: {
        location: "Bangalore",
        currentLocation: "Bangalore",
        totalExperience: 5.5,
        relevantExperience: 5,
        noticePeriod: "30 days",
        currentSalary: 22,
        expectedSalary: 26,
        currentCompany: "Razorpay Technologies",
        currentDesignation: "Senior Full Stack Developer",
        skills: ["React", "Node.js", "MongoDB", "TypeScript", "Express.js", "Docker", "AWS", "Redux Toolkit", "REST APIs", "Tailwind CSS"],
        preferredLocations: ["Bangalore", "Remote"],
        willingToRelocate: false,
        education: [
          {
            degree: "B.Tech in Computer Science & Engineering",
            institution: "VIT Vellore",
            year: 2021
          }
        ],
        experience: [
          {
            company: "Razorpay Technologies",
            title: "Senior Full Stack Developer",
            startDate: "2023-04",
            endDate: null,
            isCurrent: true,
            durationMonths: 24
          },
          {
            company: "Accenture",
            title: "Full Stack Engineer",
            startDate: "2021-06",
            endDate: "2023-03",
            isCurrent: false,
            durationMonths: 22
          }
        ],
        linkedinProfile: "https://linkedin.com/in/arjun-mehta-fsd",
        writeup: "Seasoned Full Stack developer with strong architectural expertise in React, Node.js microservices, and MongoDB. Proven record in handling high-concurrency fintech platforms."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 92,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 180000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 190000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2),
        profileScore: 92,
        matchLevel: "STRONG",
        recommendation: "Exceptional profile matching React, Node.js, and MongoDB requirements with strong TypeScript and AWS cloud background. Recommended for S1 Screen Select.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 92,
            matchLevel: "Strong Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: ["TypeScript", "Docker", "AWS"],
            missingPreferred: []
          }
        }
      }
    },
    {
      firstName: "Pooja",
      lastName: "Nair",
      email: "pooja.nair.dev@outlook.com",
      mobile: "9845012389",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 24 * 2),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 240000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Pooja_Nair_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2)
      },
      profile: {
        location: "Bangalore",
        currentLocation: "Bangalore",
        totalExperience: 4,
        relevantExperience: 4,
        noticePeriod: "15-30 Days",
        currentSalary: 19,
        expectedSalary: 24,
        currentCompany: "Swiggy India",
        currentDesignation: "Full Stack Engineer",
        skills: ["React", "Node.js", "MongoDB", "Docker", "JavaScript", "Next.js", "Git", "Jest", "Microservices"],
        preferredLocations: ["Bangalore", "Hyderabad", "Remote"],
        willingToRelocate: false,
        education: [
          {
            degree: "B.Tech in Information Technology",
            institution: "BMS College of Engineering, Bangalore",
            year: 2022
          }
        ],
        experience: [
          {
            company: "Swiggy India",
            title: "Full Stack Engineer",
            startDate: "2022-07",
            endDate: null,
            isCurrent: true,
            durationMonths: 28
          }
        ],
        linkedinProfile: "https://linkedin.com/in/pooja-nair-dev",
        writeup: "Hands-on full stack developer with core focus on React, Next.js, Node.js backend services, and scalable MongoDB aggregations."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 88,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 240000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2 + 250000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 24 * 2),
        profileScore: 88,
        matchLevel: "STRONG",
        recommendation: "Strong experience in high-traffic web applications with Node.js and React. Highly relevant MongoDB schema modeling skills.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 88,
            matchLevel: "Strong Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: ["Docker"],
            missingPreferred: ["AWS"]
          }
        }
      }
    },
    {
      firstName: "Vikramaditya",
      lastName: "Rao",
      email: "vikram.rao.tech@gmail.com",
      mobile: "9711234560",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 24 * 1),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 120000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Vikramaditya_Rao_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1)
      },
      profile: {
        location: "Bangalore",
        currentLocation: "Bangalore",
        totalExperience: 4.5,
        relevantExperience: 4,
        noticePeriod: "Immediate",
        currentSalary: 18,
        expectedSalary: 23,
        currentCompany: "InMobi",
        currentDesignation: "MERN Stack Developer",
        skills: ["React", "Node.js", "MongoDB", "Express", "TypeScript", "AWS S3", "Redis", "GraphQL", "Postman"],
        preferredLocations: ["Bangalore", "Remote"],
        willingToRelocate: false,
        education: [
          {
            degree: "MCA (Master of Computer Applications)",
            institution: "RVCE Bangalore",
            year: 2021
          }
        ],
        experience: [
          {
            company: "InMobi",
            title: "MERN Stack Developer",
            startDate: "2021-09",
            endDate: null,
            isCurrent: true,
            durationMonths: 36
          }
        ],
        linkedinProfile: "https://linkedin.com/in/vikramaditya-rao-tech",
        writeup: "Immediate available MERN stack engineer with strong GraphQL, MongoDB index optimization, and React frontend capabilities."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 85,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 120000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 130000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1),
        profileScore: 85,
        matchLevel: "STRONG",
        recommendation: "Immediate joiner with 4.5 years hands-on MERN stack development experience. Strong candidate for urgent vacancy.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 85,
            matchLevel: "Strong Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: ["TypeScript", "AWS"],
            missingPreferred: ["Docker"]
          }
        }
      }
    },
    {
      firstName: "Sneha",
      lastName: "Kulkarni",
      email: "sneha.kulkarni.eng@gmail.com",
      mobile: "9920876541",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 24 * 1),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 300000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Sneha_Kulkarni_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1)
      },
      profile: {
        location: "Pune",
        currentLocation: "Pune",
        totalExperience: 5,
        relevantExperience: 4.5,
        noticePeriod: "45-60 Days",
        currentSalary: 20,
        expectedSalary: 25,
        currentCompany: "Persistent Systems",
        currentDesignation: "Senior Software Engineer",
        skills: ["Node.js", "React", "MongoDB", "Docker", "Kubernetes", "AWS EC2", "CI/CD", "PostgreSQL", "Socket.io"],
        preferredLocations: ["Bangalore", "Pune", "Remote"],
        willingToRelocate: true,
        education: [
          {
            degree: "B.Tech in Computer Engineering",
            institution: "Pune Institute of Computer Technology (PICT)",
            year: 2021
          }
        ],
        experience: [
          {
            company: "Persistent Systems",
            title: "Senior Software Engineer",
            startDate: "2021-07",
            endDate: null,
            isCurrent: true,
            durationMonths: 38
          }
        ],
        linkedinProfile: "https://linkedin.com/in/sneha-kulkarni-eng",
        writeup: "Full stack engineer skilled in Node.js backend scalability, React single-page apps, and containerization with Docker and Kubernetes."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 82,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 300000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1 + 310000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 24 * 1),
        profileScore: 82,
        matchLevel: "STRONG",
        recommendation: "Solid distributed systems background with backend Node.js and React frontend. Cloud native with Docker and AWS experience.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 82,
            matchLevel: "Strong Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: ["Docker", "AWS"],
            missingPreferred: ["TypeScript"]
          }
        }
      }
    },
    {
      firstName: "Rohan",
      lastName: "Sengupta",
      email: "rohan.sengupta.code@gmail.com",
      mobile: "9830912456",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 18),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 18 + 150000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Rohan_Sengupta_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 18)
      },
      profile: {
        location: "Bangalore",
        currentLocation: "Bangalore",
        totalExperience: 3.5,
        relevantExperience: 3.5,
        noticePeriod: "30 days",
        currentSalary: 16,
        expectedSalary: 21,
        currentCompany: "Cognizant Digital",
        currentDesignation: "Full Stack Developer",
        skills: ["React", "Node.js", "MongoDB", "JavaScript", "Tailwind CSS", "Redux", "Express", "RESTful APIs"],
        preferredLocations: ["Bangalore", "Remote"],
        willingToRelocate: false,
        education: [
          {
            degree: "B.Tech in Computer Science",
            institution: "Jadavpur University",
            year: 2022
          }
        ],
        experience: [
          {
            company: "Cognizant Digital",
            title: "Full Stack Developer",
            startDate: "2022-09",
            endDate: null,
            isCurrent: true,
            durationMonths: 26
          }
        ],
        linkedinProfile: "https://linkedin.com/in/rohan-sengupta-code",
        writeup: "Enthusiastic full-stack engineer with hands-on proficiency in React component architecture and Node/Express backend APIs with MongoDB database."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 78,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 18),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 18 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 18 + 150000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 18 + 160000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 18),
        profileScore: 78,
        matchLevel: "GOOD",
        recommendation: "Clear, clean track record in React and Node.js microservices. Meets all mandatory skill requirements.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 78,
            matchLevel: "Good Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: [],
            missingPreferred: ["TypeScript", "Docker", "AWS"]
          }
        }
      }
    },
    {
      firstName: "Anjali",
      lastName: "Deshmukh",
      email: "anjali.deshmukh.dev@gmail.com",
      mobile: "9765432109",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 12),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 12 + 180000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Anjali_Deshmukh_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 12)
      },
      profile: {
        location: "Bangalore",
        currentLocation: "Bangalore",
        totalExperience: 3,
        relevantExperience: 3,
        noticePeriod: "15-30 Days",
        currentSalary: 14,
        expectedSalary: 19,
        currentCompany: "LTIMindtree",
        currentDesignation: "Software Engineer - Full Stack",
        skills: ["React", "Node.js", "MongoDB", "TypeScript", "HTML5", "CSS3", "Git", "Webpack", "Vite"],
        preferredLocations: ["Bangalore", "Remote"],
        willingToRelocate: false,
        education: [
          {
            degree: "B.E. in Information Science",
            institution: "PES University, Bangalore",
            year: 2023
          }
        ],
        experience: [
          {
            company: "LTIMindtree",
            title: "Software Engineer",
            startDate: "2023-01",
            endDate: null,
            isCurrent: true,
            durationMonths: 22
          }
        ],
        linkedinProfile: "https://linkedin.com/in/anjali-deshmukh-dev",
        writeup: "Proactive developer with solid fundamentals in JavaScript, TypeScript, React frontend architecture, and Express backend APIs."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 74,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 12),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 12 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 12 + 180000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 12 + 190000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 12),
        profileScore: 74,
        matchLevel: "GOOD",
        recommendation: "Energetic full stack engineer with strong modern frontend stack and Node.js backend. Great culture and salary fit.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 74,
            matchLevel: "Good Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: ["TypeScript"],
            missingPreferred: ["Docker", "AWS"]
          }
        }
      }
    },
    {
      firstName: "Karthik",
      lastName: "Subramanian",
      email: "karthik.subramanian.tech@gmail.com",
      mobile: "9884567123",
      consent: {
        given: true,
        givenAt: new Date(Date.now() - 3600 * 1000 * 6),
        ipAddress: "122.170.193.109",
        consentStatus: "CONFIRMED",
        consentConfirmedAt: new Date(Date.now() - 3600 * 1000 * 6 + 100000),
        consentIp: "122.170.193.109"
      },
      resume: {
        url: "https://res.cloudinary.com/dwvmc04oo/raw/upload/sample_resume.pdf",
        fileName: "Karthik_Subramanian_Resume.pdf",
        uploadedAt: new Date(Date.now() - 3600 * 1000 * 6)
      },
      profile: {
        location: "Bangalore",
        currentLocation: "Bangalore",
        totalExperience: 6,
        relevantExperience: 5.5,
        noticePeriod: "30-45 Days",
        currentSalary: 24,
        expectedSalary: 28,
        currentCompany: "Freshworks",
        currentDesignation: "Lead Full Stack Engineer",
        skills: ["Node.js", "React", "MongoDB", "TypeScript", "AWS", "Docker", "System Design", "Microservices", "Redis"],
        preferredLocations: ["Bangalore", "Chennai", "Remote"],
        willingToRelocate: false,
        education: [
          {
            degree: "B.Tech in Computer Science",
            institution: "Anna University",
            year: 2020
          }
        ],
        experience: [
          {
            company: "Freshworks",
            title: "Lead Full Stack Engineer",
            startDate: "2022-03",
            endDate: null,
            isCurrent: true,
            durationMonths: 32
          },
          {
            company: "Zoho Corporation",
            title: "Member Technical Staff",
            startDate: "2020-07",
            endDate: "2022-02",
            isCurrent: false,
            durationMonths: 20
          }
        ],
        linkedinProfile: "https://linkedin.com/in/karthik-subramanian-tech",
        writeup: "Lead Full Stack Developer with 6 years experience in SaaS multi-tenant products using React, Node.js, MongoDB clustering, and AWS cloud infrastructure."
      },
      status: "S1_REVIEW",
      submissionMetadata: {
        submittedFromPlan: "PROFESSIONAL",
        matchScore: 94,
        duplicateWarnings: [],
        forceSubmitted: false
      },
      statusHistory: [
        {
          status: "DRAFT",
          changedAt: new Date(Date.now() - 3600 * 1000 * 6),
          notes: "Submission drafted by partner"
        },
        {
          status: "CONSENT_PENDING",
          changedAt: new Date(Date.now() - 3600 * 1000 * 6 + 1000),
          notes: "Consent link sent via WhatsApp"
        },
        {
          status: "CONSENT_CONFIRMED",
          changedAt: new Date(Date.now() - 3600 * 1000 * 6 + 100000),
          notes: "Candidate confirmed consent"
        },
        {
          status: "S1_REVIEW",
          changedAt: new Date(Date.now() - 3600 * 1000 * 6 + 110000),
          notes: "Candidate queued for S1 internal review"
        }
      ],
      resumeAnalysis: {
        parsed: true,
        parsedAt: new Date(Date.now() - 3600 * 1000 * 6),
        profileScore: 94,
        matchLevel: "STRONG",
        recommendation: "Top-tier senior profile with 6 years experience in SaaS platforms. Exceptional fit for leadership and technical architecture on sha041.",
        scoreBreakdown: {
          summary: {
            finalAdjustedScore: 94,
            matchLevel: "Strong Match"
          },
          skills: {
            matchedRequired: ["React", "Node.js", "MongoDB"],
            missingRequired: [],
            matchedPreferred: ["TypeScript", "AWS", "Docker"],
            missingPreferred: []
          }
        }
      }
    }
  ];

  console.log(`Starting insertion of ${candidatesData.length} candidates...`);

  const createdCandidates = [];
  for (const cData of candidatesData) {
    // Check if candidate already exists by email
    const existing = await Candidate.findOne({ email: cData.email });
    if (existing) {
      console.log(`Candidate with email ${cData.email} already exists (ID: ${existing.uniqueId}). Updating...`);
      Object.assign(existing, {
        job: job._id,
        company: job.company,
        submittedBy: partnerId,
        ...cData
      });
      await existing.save();
      createdCandidates.push(existing);
    } else {
      const candidate = new Candidate({
        job: job._id,
        company: job.company,
        submittedBy: partnerId,
        ...cData
      });
      await candidate.save();
      console.log(`✓ Created candidate: ${candidate.firstName} ${candidate.lastName} (${candidate.uniqueId}) - Score: ${candidate.submissionMetadata.matchScore} - Status: ${candidate.status}`);
      createdCandidates.push(candidate);
    }
  }

  // Update Job metrics
  const totalJobCandidates = await Candidate.countDocuments({ job: job._id });
  job.metrics = job.metrics || {};
  job.metrics.applications = totalJobCandidates;
  await job.save();
  console.log(`✓ Updated Job metrics: applications = ${totalJobCandidates}`);

  // Update JobInterest submission count
  const interest = await JobInterest.findOne({ job: job._id, partner: partnerId });
  if (interest) {
    interest.submissionCount = totalJobCandidates;
    await interest.save();
    console.log(`✓ Updated JobInterest submissionCount = ${totalJobCandidates}`);
  }

  console.log('\n--- SUMMARY ---');
  console.log(`Successfully seeded ${createdCandidates.length} candidates for Job sha041:`);
  createdCandidates.forEach((c, idx) => {
    console.log(`${idx + 1}. ${c.firstName} ${c.lastName} | ID: ${c.uniqueId} | Email: ${c.email} | Mobile: ${c.mobile} | Status: ${c.status} | Score: ${c.resumeAnalysis?.profileScore || c.submissionMetadata?.matchScore}`);
  });

  await mongoose.disconnect();
  console.log('Done!');
}

seedCandidates().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
