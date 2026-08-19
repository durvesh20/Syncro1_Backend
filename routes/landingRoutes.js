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


// PROTECTED ADMIN CRUD ENDPOINTS
router.use(protect);
router.use(authorizeAdminAccess);

// Testimonials CRUD
router.post('/testimonials', async (req, res) => {
  try {
    const testimonial = await Testimonial.create(req.body);
    res.status(201).json({ success: true, data: testimonial });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/testimonials/:id', async (req, res) => {
  try {
    const testimonial = await Testimonial.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!testimonial) {
      return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }
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
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Awards CRUD
router.post('/awards', async (req, res) => {
  try {
    const award = await Award.create(req.body);
    res.status(201).json({ success: true, data: award });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/awards/:id', async (req, res) => {
  try {
    const award = await Award.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!award) {
      return res.status(404).json({ success: false, message: 'Award not found' });
    }
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
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Logos CRUD
router.post('/logos', async (req, res) => {
  try {
    const logo = await CompanyLogo.create(req.body);
    res.status(201).json({ success: true, data: logo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.put('/logos/:id', async (req, res) => {
  try {
    const logo = await CompanyLogo.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!logo) {
      return res.status(404).json({ success: false, message: 'Logo not found' });
    }
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
    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
