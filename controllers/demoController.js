/**
 * @desc    Submit a Walkthrough / Demo request (Client or Talent Partner)
 * @route   POST /api/demo
 * @access  Public
 */
exports.submitDemoRequest = async (req, res) => {
  try {
    const {
      stakeholder = 'client',
      name,
      email,
      phone,
      organization,
      partnerDomain,
      partnerVolume,
      notes
    } = req.body;

    // Validate mandatory fields
    const errors = [];

    if (!name || typeof name !== 'string' || !name.trim()) {
      errors.push('Full name is required');
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      errors.push('Work email is required');
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.push('Please enter a valid work email address');
      }
    }

    // Clean phone number (strip whitespace, +91, hyphens)
    let cleanPhone = '';
    if (phone && typeof phone === 'string') {
      cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length > 10 && cleanPhone.startsWith('91')) {
        cleanPhone = cleanPhone.slice(2);
      }
    }

    if (!cleanPhone || cleanPhone.length < 10) {
      errors.push('Please provide a valid 10-digit mobile number');
    }

    if (!organization || typeof organization !== 'string' || !organization.trim()) {
      errors.push('Organization name is required');
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0],
        errors
      });
    }

    const normalizedStakeholder = stakeholder === 'partner' ? 'partner' : 'client';
    const prefix = normalizedStakeholder === 'partner' ? 'DEMOP' : 'DEMOC';
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const referenceCode = `${prefix}-${randomSuffix}`;

    const demoDoc = await DemoRequest.create({
      stakeholder: normalizedStakeholder,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: cleanPhone,
      organization: organization.trim(),
      partnerDomain: partnerDomain ? String(partnerDomain).trim() : '',
      partnerVolume: partnerVolume ? String(partnerVolume).trim() : '',
      notes: notes ? String(notes).trim() : '',
      referenceCode,
      status: 'pending',
      ipAddress: req.ip || req.connection?.remoteAddress || '',
      userAgent: req.get('user-agent') || ''
    });

    return res.status(201).json({
      success: true,
      message: 'Walkthrough request submitted successfully',
      data: {
        id: demoDoc._id,
        referenceCode: demoDoc.referenceCode,
        stakeholder: demoDoc.stakeholder,
        name: demoDoc.name,
        email: demoDoc.email,
        phone: demoDoc.phone,
        organization: demoDoc.organization,
        createdAt: demoDoc.createdAt
      }
    });
  } catch (error) {
    console.error('Error submitting demo request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while submitting demo request. Please try again.',
      error: error.message
    });
  }
};

/**
 * @desc    Get all Walkthrough / Demo requests
 * @route   GET /api/demo
 * @access  Private (Admin / Sub-Admin)
 */
exports.getDemoRequests = async (req, res) => {
  try {
    const { stakeholder, status, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (stakeholder && stakeholder !== 'all') {
      if (stakeholder === 'company' || stakeholder === 'client') {
        query.stakeholder = 'client';
      } else if (stakeholder === 'partner' || stakeholder === 'talent_partner') {
        query.stakeholder = 'partner';
      } else {
        query.stakeholder = stakeholder;
      }
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: rx },
        { email: rx },
        { phone: rx },
        { organization: rx },
        { referenceCode: rx },
        { notes: rx },
        { partnerDomain: rx }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [
      requests,
      total,
      totalAll,
      companyCount,
      partnerCount,
      pendingCount,
      scheduledCount
    ] = await Promise.all([
      DemoRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      DemoRequest.countDocuments(query),
      DemoRequest.countDocuments(),
      DemoRequest.countDocuments({ stakeholder: 'client' }),
      DemoRequest.countDocuments({ stakeholder: 'partner' }),
      DemoRequest.countDocuments({ status: 'pending' }),
      DemoRequest.countDocuments({ status: 'scheduled' })
    ]);

    return res.status(200).json({
      success: true,
      count: requests.length,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      counts: {
        all: totalAll,
        company: companyCount,
        partner: partnerCount,
        pending: pendingCount,
        scheduled: scheduledCount
      },
      data: requests
    });
  } catch (error) {
    console.error('Error fetching demo requests:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while fetching demo requests',
      error: error.message
    });
  }
};

/**
 * @desc    Update status of demo request
 * @route   PATCH /api/demo/:id/status
 * @access  Private (Admin / Sub-Admin)
 */
exports.updateDemoStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'contacted', 'scheduled', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const demoDoc = await DemoRequest.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!demoDoc) {
      return res.status(404).json({
        success: false,
        message: 'Demo request not found'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Demo request status updated',
      data: demoDoc
    });
  } catch (error) {
    console.error('Error updating demo status:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating demo status',
      error: error.message
    });
  }
};

/**
 * @desc    Delete a demo request
 * @route   DELETE /api/demo/:id
 * @access  Private (Admin / Sub-Admin)
 */
exports.deleteDemoRequest = async (req, res) => {
  try {
    const demoDoc = await DemoRequest.findByIdAndDelete(req.params.id);
    if (!demoDoc) {
      return res.status(404).json({
        success: false,
        message: 'Demo request not found'
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Demo request deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting demo request:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while deleting demo request',
      error: error.message
    });
  }
};
