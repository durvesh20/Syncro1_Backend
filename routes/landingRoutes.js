const express = require('express');
const router = express.Router();
const Testimonial = require('../models/Testimonial');
const Award = require('../models/Award');
const CompanyLogo = require('../models/CompanyLogo');
const { protect, authorizeAdminAccess } = require('../middleware/auth');

// Default Testimonials
const defaultTestimonials = [
  {
    quote: "Syncro1 has revolutionized how we approach hiring. The outcome-based model eliminated our risk and the AI tools saved us countless hours.",
    author: "Sarah Johnson",
    role: "Head of Talent",
    company: "TechCorp Global",
    type: "company"
  },
  {
    quote: "As a Talent partner, this platform has transformed our business. The collaboration tools and transparent process have increased our placement success rate by 70%.",
    author: "Michael Rodriguez",
    role: "CEO",
    company: "TalentBridge Solutions",
    type: "vendor"
  },
  {
    quote: "Finally, a platform that aligns incentives. We only pay for results, and the quality of candidates has been exceptional. Our hiring costs dropped by 40%.",
    author: "Priya Sharma",
    role: "VP Operations",
    company: "InnovateLabs",
    type: "company"
  },
  {
    quote: "The multi-vendor collaboration feature is genius. We can now work together with other agencies seamlessly, which benefits everyone - especially the clients.",
    author: "David Chen",
    role: "Director",
    company: "Elite Staffing Group",
    type: "vendor"
  },
  {
    quote: "Hiring senior developers has always been a bottleneck for us. Syncro1 connected us with niche recruiters who understood our tech stack instantly. We filled 3 critical roles in 2 weeks.",
    author: "James Wilson",
    role: "VP of Engineering",
    company: "CloudScale Inc",
    type: "company"
  },
  {
    quote: "Syncro1 opened up enterprise clients we could never reach on our own. The automated job briefs and matching algorithm help us submit candidates faster.",
    author: "Amina Diallo",
    role: "Managing Director",
    company: "GlobalRecruit",
    type: "vendor"
  },
  {
    quote: "The transparency is refreshing. Being able to track all candidate submissions in one place, with clear feedback loops, has improved our candidate experience tremendously.",
    author: "Elena Rostova",
    role: "HR Director",
    company: "FinTech Solutions",
    type: "company"
  },
  {
    quote: "With Syncro1, we don't have to spend hours on business development. The platform brings quality, vetted job listings directly to our portal. Highly recommended!",
    author: "Thomas Bernstein",
    role: "Founder",
    company: "TechTalent Partners",
    type: "vendor"
  },
  {
    quote: "We were skeptical about outcome-based hiring, but Syncro1 delivered. We saved on upfront recruitment fees and only paid when our engineer successfully completed their first month.",
    author: "Marcus Thompson",
    role: "Co-Founder",
    company: "PeakVentures",
    type: "company"
  },
  {
    quote: "The invoice processing and payout system is seamless. Once a candidate is placed and verified, payment is transferred without any delay or administrative overhead.",
    author: "Yuki Tanaka",
    role: "Head of Operations",
    company: "Tokyo Staffing",
    type: "vendor"
  }
];

// Default Awards
const defaultAwards = [
  { year: "2025", title: "Best HR Tech Innovation", org: "TechAwards" },
  { year: "2025", title: "Top AI Talent Platform", org: "Industry Leaders" },
  { year: "2023", title: "Fastest Growing SaaS", org: "Growth 500" }
];

// Default Logos
const defaultLogos = [
  { name: "", logoUrl: "/syncrosquad.png", iconName: "Building2" },
  { name: "TechCorp Global", logoUrl: "", iconName: "Globe" },
  { name: "InnovateLabs", logoUrl: "", iconName: "Cpu" },
  { name: "FutureScale", logoUrl: "", iconName: "Layers" },
  { name: "DataDrive Inc", logoUrl: "", iconName: "Database" },
  { name: "CloudVision", logoUrl: "", iconName: "Cloud" },
  { name: "NexGen Solutions", logoUrl: "", iconName: "Sparkles" }
];

// PUBLIC READ ENDPOINTS

// Testimonials
router.get('/testimonials', async (req, res) => {
  try {
    let testimonials = await Testimonial.find().sort({ createdAt: -1 });
    if (testimonials.length === 0) {
      testimonials = await Testimonial.insertMany(defaultTestimonials);
    }
    res.status(200).json({ success: true, data: testimonials });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Awards
router.get('/awards', async (req, res) => {
  try {
    let awards = await Award.find().sort({ year: -1, createdAt: -1 });
    if (awards.length === 0) {
      awards = await Award.insertMany(defaultAwards);
    }
    res.status(200).json({ success: true, data: awards });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Logos
router.get('/logos', async (req, res) => {
  try {
    let logos = await CompanyLogo.find().sort({ createdAt: 1 });
    if (logos.length === 0) {
      logos = await CompanyLogo.insertMany(defaultLogos);
    }
    res.status(200).json({ success: true, data: logos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


const auditService = require('../services/auditService');
const AdminActionLog = require('../models/AdminActionLog');

// PROTECTED ADMIN CRUD ENDPOINTS
router.use(protect);
router.use(authorizeAdminAccess);

// Audit Logs Endpoint for Website Modifications
router.get('/audit-logs', async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', entityType = '', action = '' } = req.query;
    const query = {
      action: {
        $in: [
          'LANDING_LOGO_CREATED', 'LANDING_LOGO_UPDATED', 'LANDING_LOGO_DELETED',
          'LANDING_TESTIMONIAL_CREATED', 'LANDING_TESTIMONIAL_UPDATED', 'LANDING_TESTIMONIAL_DELETED',
          'LANDING_AWARD_CREATED', 'LANDING_AWARD_UPDATED', 'LANDING_AWARD_DELETED',
          'WEBSITE_CONTENT_MODIFIED'
        ]
      }
    };
    if (entityType) query.entityType = entityType;
    if (action) query.action = action;
    if (search) {
      query.$or = [
        { actorEmail: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      AdminActionLog.find(query)
        .populate('actor', 'firstName lastName email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AdminActionLog.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          total
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Testimonials CRUD
router.post('/testimonials', async (req, res) => {
  try {
    const testimonial = await Testimonial.create({
      ...req.body,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_TESTIMONIAL_CREATED',
      entityType: 'Testimonial',
      entityId: testimonial._id,
      description: `Created testimonial by "${testimonial.author}" (${testimonial.company || testimonial.role})`,
      after: testimonial.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(201).json({ success: true, data: testimonial });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/testimonials/:id', async (req, res) => {
  try {
    const oldTestimonial = await Testimonial.findById(req.params.id);
    if (!oldTestimonial) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    const testimonial = await Testimonial.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_TESTIMONIAL_UPDATED',
      entityType: 'Testimonial',
      entityId: testimonial._id,
      description: `Modified testimonial by "${testimonial.author}" (${testimonial.company || testimonial.role})`,
      before: oldTestimonial.toObject(),
      after: testimonial.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(200).json({ success: true, data: testimonial });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/testimonials/:id', async (req, res) => {
  try {
    const testimonial = await Testimonial.findByIdAndDelete(req.params.id);
    if (!testimonial) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_TESTIMONIAL_DELETED',
      entityType: 'Testimonial',
      entityId: testimonial._id,
      description: `Deleted testimonial by "${testimonial.author}" (${testimonial.company || testimonial.role})`,
      before: testimonial.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Awards CRUD
router.post('/awards', async (req, res) => {
  try {
    const award = await Award.create({
      ...req.body,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_AWARD_CREATED',
      entityType: 'Award',
      entityId: award._id,
      description: `Created award "${award.title}" (${award.year}, ${award.org})`,
      after: award.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(201).json({ success: true, data: award });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/awards/:id', async (req, res) => {
  try {
    const oldAward = await Award.findById(req.params.id);
    if (!oldAward) {
      return res.status(404).json({ success: false, message: 'Award not found' });
    }

    const award = await Award.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_AWARD_UPDATED',
      entityType: 'Award',
      entityId: award._id,
      description: `Modified award "${award.title}" (${award.year}, ${award.org})`,
      before: oldAward.toObject(),
      after: award.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(200).json({ success: true, data: award });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/awards/:id', async (req, res) => {
  try {
    const award = await Award.findByIdAndDelete(req.params.id);
    if (!award) {
      return res.status(404).json({ success: false, message: 'Award not found' });
    }

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_AWARD_DELETED',
      entityType: 'Award',
      entityId: award._id,
      description: `Deleted award "${award.title}" (${award.year}, ${award.org})`,
      before: award.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Logos CRUD
router.post('/logos', async (req, res) => {
  try {
    const logo = await CompanyLogo.create({
      ...req.body,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_LOGO_CREATED',
      entityType: 'CompanyLogo',
      entityId: logo._id,
      description: `Added partner/client logo "${logo.name || logo.iconName || 'Logo'}"`,
      after: logo.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(201).json({ success: true, data: logo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/logos/:id', async (req, res) => {
  try {
    const oldLogo = await CompanyLogo.findById(req.params.id);
    if (!oldLogo) {
      return res.status(404).json({ success: false, message: 'Logo not found' });
    }

    const logo = await CompanyLogo.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedBy: req.user._id },
      { new: true, runValidators: true }
    );

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_LOGO_UPDATED',
      entityType: 'CompanyLogo',
      entityId: logo._id,
      description: `Modified logo "${logo.name || logo.iconName || 'Logo'}"`,
      before: oldLogo.toObject(),
      after: logo.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(200).json({ success: true, data: logo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.delete('/logos/:id', async (req, res) => {
  try {
    const logo = await CompanyLogo.findByIdAndDelete(req.params.id);
    if (!logo) {
      return res.status(404).json({ success: false, message: 'Logo not found' });
    }

    await auditService.log({
      actor: req.user._id,
      actorRole: req.user.role,
      actorEmail: req.user.email,
      action: 'LANDING_LOGO_DELETED',
      entityType: 'CompanyLogo',
      entityId: logo._id,
      description: `Deleted logo "${logo.name || logo.iconName || 'Logo'}"`,
      before: logo.toObject(),
      ipAddress: auditService.getIp(req),
      userAgent: auditService.getUserAgent(req)
    });

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
