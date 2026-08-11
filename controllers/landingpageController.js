const LandingPageLead = require('../models/LandingPageLead');

/**
 * @desc    Submit lead from Landing Page (Company or Talent Partner)
 * @route   POST /api/landingpage/submit
 * @access  Public
 */
exports.submitLead = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      company,
      firmName,
      department,
      designation,
      state,
      city,
      linkedinProfile,
      message,
      formType,
      pageId,
      source,
      sourceUrl,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content
    } = req.body;

    // Basic validation
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Save to database
    let lead = null;
    try {
      lead = await LandingPageLead.create({
        name,
        email,
        phone: phone || '',
        company: company || firmName || '',
        firmName: firmName || company || '',
        department: department || '',
        designation: designation || '',
        state: state || '',
        city: city || '',
        linkedinProfile: linkedinProfile || '',
        message: message || '',
        formType: formType || 'company',
        pageId: pageId || '',
        source: source || req.get('referer') || '',
        sourceUrl: sourceUrl || req.get('referer') || '',
        referrer: referrer || req.get('referer') || '',
        utm_source: utm_source || '',
        utm_medium: utm_medium || '',
        utm_campaign: utm_campaign || '',
        utm_term: utm_term || '',
        utm_content: utm_content || ''
      });
    } catch (dbError) {
      console.warn('⚠️ Database write warning for LandingPageLead:', dbError.message);
      lead = {
        name, email, phone,
        company: company || firmName || '',
        firmName, department, designation,
        state, city, linkedinProfile,
        message, formType,
        pageId,
        source, sourceUrl, referrer,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        createdAt: new Date()
      };
    }

    return res.status(201).json({
      success: true,
      message: 'Lead submitted successfully',
      data: lead
    });
  } catch (error) {
    console.error('Error submitting landing page lead:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting lead',
      error: error.message
    });
  }
};

/**
 * @desc    Get all landing page lead submissions
 * @route   GET /api/landingpage/leads
 * @access  Public / Admin
 */
exports.getLeads = async (req, res) => {
  try {
    const leads = await LandingPageLead.find().sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      count: leads.length,
      data: leads
    });
  } catch (error) {
    console.error('Error fetching landing page leads:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching leads',
      error: error.message
    });
  }
};
