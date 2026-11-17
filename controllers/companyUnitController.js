// backend/controllers/companyUnitController.js
const mongoose = require('mongoose');
const Company = require('../models/Company');
const CompanyUnit = require('../models/CompanyUnit');
const User = require('../models/User');
const {
  validateReportingLine,
  computeScopedUserIds,
  recordUnitChange,
  recordManagerChange,
  canDeleteUnit,
  buildCompanyTree,
} = require('../services/companyTreeService');

/**
 * Helper to resolve the root company document for the current request
 */
const resolveCompany = async (req) => {
  const rootUserId = req.user?.createdBy || req.user?._id;
  let company = await Company.findOne({ user: rootUserId });
  if (!company && req.user?.company) {
    company = await Company.findById(req.user.company);
  }
  return company;
};

/**
 * Helper to get the actual authenticated user (whether root account or sub-admin)
 */
const getActorUser = (req) => {
  return req.subAdminUser || req.user;
};

/**
 * @desc    Get full organization tree (nested units, heads, members, unassigned users)
 * @route   GET /api/companies/tree
 * @access  Company (Admin & Unit Heads)
 */
exports.getCompanyTree = async (req, res) => {
  try {
    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const rootUserId = company.user;
    const treeData = await buildCompanyTree(company._id, rootUserId);

    res.json({
      success: true,
      data: treeData,
    });
  } catch (error) {
    console.error('[COMPANY-TREE] getCompanyTree error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organization tree',
      error: error.message,
    });
  }
};

/**
 * @desc    Get flat list of company units with member counts
 * @route   GET /api/companies/units
 * @access  Company Users
 */
exports.getCompanyUnits = async (req, res) => {
  try {
    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const units = await CompanyUnit.find({ company: company._id, status: 'ACTIVE' })
      .populate('head', 'firstName lastName email mobile jobTitle status')
      .populate('parentUnit', 'name code')
      .sort({ level: 1, name: 1 })
      .lean();

    // Attach real-time active member count for each unit
    const unitIds = units.map((u) => u._id);
    const memberCounts = await User.aggregate([
      { $match: { unit: { $in: unitIds }, status: { $ne: 'DELETED' } } },
      { $group: { _id: '$unit', count: { $sum: 1 } } },
    ]);

    const countMap = {};
    memberCounts.forEach((mc) => {
      countMap[mc._id.toString()] = mc.count;
    });

    const unitsWithCounts = units.map((unit) => ({
      ...unit,
      memberCount: countMap[unit._id.toString()] || 0,
    }));

    res.json({
      success: true,
      data: unitsWithCounts,
    });
  } catch (error) {
    console.error('[COMPANY-UNITS] getCompanyUnits error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company units',
      error: error.message,
    });
  }
};

/**
 * @desc    Create a new organizational unit or sub-unit
 * @route   POST /api/companies/units
 * @access  Company (Admin & Unit Heads within their branch)
 */
exports.createCompanyUnit = async (req, res) => {
  try {
    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const actor = getActorUser(req);
    const { name, code, description, parentUnit, head } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Unit name is required' });
    }

    // Authorization check: Unit Heads can only create sub-units inside their own branch
    if (actor.isCompanySubAdmin) {
      if (!actor.isUnitHead) {
        return res.status(403).json({
          success: false,
          message: 'Only Company Admins or Unit Heads can create organizational units.',
        });
      }

      if (!parentUnit) {
        return res.status(403).json({
          success: false,
          message: 'Unit Heads can only create sub-units under their existing branch.',
        });
      }

      // Check that parentUnit is within this unit head's branch
      const parentUnitDoc = await CompanyUnit.findById(parentUnit);
      const actorUnitDoc = await CompanyUnit.findById(actor.unit);

      if (!parentUnitDoc || !actorUnitDoc || !parentUnitDoc.path.startsWith(actorUnitDoc.path)) {
        return res.status(403).json({
          success: false,
          message: 'You can only create sub-units within your assigned unit branch.',
        });
      }
    }

    // Check duplicate name under same parent
    const existing = await CompanyUnit.findOne({
      company: company._id,
      name: name.trim(),
      parentUnit: parentUnit || null,
      status: 'ACTIVE',
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A unit with this name already exists under the selected parent unit.',
      });
    }

    // Create unit
    const unit = new CompanyUnit({
      company: company._id,
      name: name.trim(),
      code: code ? code.trim().toUpperCase() : '',
      description: description ? description.trim() : '',
      parentUnit: parentUnit || null,
      head: head || null,
      createdBy: actor._id,
    });

    await unit.save();

    // If a head user was specified, update the user to reflect head status
    if (head) {
      const headUser = await User.findById(head);
      if (headUser) {
        headUser.isUnitHead = true;
        headUser.unit = unit._id;
        recordUnitChange(headUser, unit._id, unit.name, actor._id);
        await headUser.save();
      }
    }

    const populatedUnit = await CompanyUnit.findById(unit._id)
      .populate('head', 'firstName lastName email mobile jobTitle')
      .populate('parentUnit', 'name code');

    res.status(201).json({
      success: true,
      message: 'Unit created successfully',
      data: populatedUnit,
    });
  } catch (error) {
    console.error('[COMPANY-UNITS] createCompanyUnit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create unit',
      error: error.message,
    });
  }
};

/**
 * @desc    Update an organizational unit
 * @route   PUT /api/companies/units/:id
 * @access  Company (Admin & Unit Heads within their branch)
 */
exports.updateCompanyUnit = async (req, res) => {
  try {
    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const actor = getActorUser(req);
    const unit = await CompanyUnit.findOne({ _id: req.params.id, company: company._id });

    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    // Authorization: Unit Head check
    if (actor.isCompanySubAdmin) {
      if (!actor.isUnitHead) {
        return res.status(403).json({
          success: false,
          message: 'Only Company Admins or Unit Heads can update organizational units.',
        });
      }
      const actorUnitDoc = await CompanyUnit.findById(actor.unit);
      if (!actorUnitDoc || !unit.path.startsWith(actorUnitDoc.path)) {
        return res.status(403).json({
          success: false,
          message: 'You can only update units within your assigned branch.',
        });
      }
    }

    const { name, code, description, parentUnit, head, status } = req.body;

    let parentChanged = false;
    const oldPath = unit.path;

    // Handle parentUnit update / re-parenting
    if (parentUnit !== undefined) {
      const currentParentId = unit.parentUnit ? String(unit.parentUnit) : null;
      const targetParentId = parentUnit && parentUnit !== 'ROOT' ? String(parentUnit) : null;

      if (targetParentId !== currentParentId) {
        // Prevent setting itself as parent
        if (targetParentId && targetParentId === String(unit._id)) {
          return res.status(400).json({
            success: false,
            message: 'A unit cannot be its own parent unit.',
          });
        }

        let newParentUnitDoc = null;
        if (targetParentId) {
          newParentUnitDoc = await CompanyUnit.findOne({
            _id: targetParentId,
            company: company._id,
            status: 'ACTIVE',
          });

          if (!newParentUnitDoc) {
            return res.status(404).json({
              success: false,
              message: 'Selected parent unit not found.',
            });
          }

          // Cycle check: Cannot move unit under any of its own descendants
          if (unit.path && newParentUnitDoc.path && newParentUnitDoc.path.startsWith(unit.path)) {
            return res.status(400).json({
              success: false,
              message: 'Circular hierarchy detected: Cannot move a unit under one of its own sub-units.',
            });
          }
        }

        // Sub-admin (Unit Head) branch restriction
        if (actor.isCompanySubAdmin) {
          if (!targetParentId) {
            return res.status(403).json({
              success: false,
              message: 'Unit Heads cannot move a unit to the root level. Only Primary Company Admin can do this.',
            });
          }
          const actorUnitDoc = await CompanyUnit.findById(actor.unit);
          if (!actorUnitDoc || !newParentUnitDoc.path.startsWith(actorUnitDoc.path)) {
            return res.status(403).json({
              success: false,
              message: 'You can only move units within your assigned branch.',
            });
          }
        }

        unit.parentUnit = targetParentId || null;
        parentChanged = true;
      }
    }

    // Name and duplicate check under current or new parent
    const finalName = name !== undefined ? name.trim() : unit.name;
    if (name !== undefined || parentChanged) {
      const duplicate = await CompanyUnit.findOne({
        company: company._id,
        name: finalName,
        parentUnit: unit.parentUnit || null,
        _id: { $ne: unit._id },
        status: 'ACTIVE',
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'A unit with this name already exists under the selected parent unit.',
        });
      }
      unit.name = finalName;
    }

    if (code !== undefined) unit.code = code.trim().toUpperCase();
    if (description !== undefined) unit.description = description.trim();
    if (status !== undefined) unit.status = status;

    // Handle Head assignment / reassignment
    if (head !== undefined && String(unit.head) !== String(head)) {
      const oldHeadId = unit.head;
      unit.head = head || null;

      // Demote previous head if they are not head of another unit
      if (oldHeadId) {
        const otherUnitsWithHead = await CompanyUnit.countDocuments({
          head: oldHeadId,
          _id: { $ne: unit._id },
          status: 'ACTIVE',
        });
        if (otherUnitsWithHead === 0) {
          await User.findByIdAndUpdate(oldHeadId, { isUnitHead: false });
        }
      }

      // Promote new head
      if (head) {
        const newHeadUser = await User.findById(head);
        if (newHeadUser) {
          newHeadUser.isUnitHead = true;
          newHeadUser.unit = unit._id;
          recordUnitChange(newHeadUser, unit._id, unit.name, actor._id);
          await newHeadUser.save();
        }
      }
    }

    await unit.save();

    // If parent changed and path changed, propagate path & level updates to all descendants
    if (parentChanged && oldPath && oldPath !== unit.path) {
      const descendants = await CompanyUnit.find({
        company: company._id,
        path: new RegExp('^' + oldPath),
        _id: { $ne: unit._id },
      });

      for (const desc of descendants) {
        desc.path = desc.path.replace(oldPath, unit.path);
        desc.level = desc.path.split('/').filter(Boolean).length;
        await desc.save();
      }
    }

    const populatedUnit = await CompanyUnit.findById(unit._id)
      .populate('head', 'firstName lastName email mobile jobTitle')
      .populate('parentUnit', 'name code');

    res.json({
      success: true,
      message: 'Unit updated successfully',
      data: populatedUnit,
    });
  } catch (error) {
    console.error('[COMPANY-UNITS] updateCompanyUnit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update unit',
      error: error.message,
    });
  }
};

/**
 * @desc    Delete/Decommission an organizational unit (Strictly requires member & sub-unit reassignment first)
 * @route   DELETE /api/companies/units/:id
 * @access  Company Primary Admin only
 */
exports.deleteCompanyUnit = async (req, res) => {
  try {
    const actor = getActorUser(req);
    if (actor.isCompanySubAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the Primary Company Admin is authorized to delete or decommission units.',
      });
    }

    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const unit = await CompanyUnit.findOne({ _id: req.params.id, company: company._id });
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    // Safety validation: Ensure no active members or sub-units are attached
    const safetyCheck = await canDeleteUnit(unit._id);
    if (!safetyCheck.canDelete) {
      return res.status(400).json({
        success: false,
        message: safetyCheck.message,
        details: {
          memberCount: safetyCheck.memberCount,
          subUnitCount: safetyCheck.subUnitCount,
        },
      });
    }

    // If unit had a head, demote them if no other unit
    if (unit.head) {
      const otherUnits = await CompanyUnit.countDocuments({
        head: unit.head,
        _id: { $ne: unit._id },
        status: 'ACTIVE',
      });
      if (otherUnits === 0) {
        await User.findByIdAndUpdate(unit.head, { isUnitHead: false });
      }
    }

    await CompanyUnit.deleteOne({ _id: unit._id });

    res.json({
      success: true,
      message: 'Unit deleted successfully.',
    });
  } catch (error) {
    console.error('[COMPANY-UNITS] deleteCompanyUnit error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete unit',
      error: error.message,
    });
  }
};

/**
 * @desc    Transfer all members and/or sub-units from one unit to another (for decommissioning a unit)
 * @route   POST /api/companies/units/:id/transfer-members
 * @access  Company Primary Admin only
 */
exports.transferUnitMembers = async (req, res) => {
  try {
    const actor = getActorUser(req);
    if (actor.isCompanySubAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Only the Primary Company Admin can perform bulk member transfers.',
      });
    }

    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const sourceUnit = await CompanyUnit.findOne({ _id: req.params.id, company: company._id });
    if (!sourceUnit) {
      return res.status(404).json({ success: false, message: 'Source unit not found' });
    }

    const { targetUnitId, targetReportingManagerId } = req.body;
    let targetUnit = null;

    if (targetUnitId) {
      targetUnit = await CompanyUnit.findOne({ _id: targetUnitId, company: company._id });
      if (!targetUnit) {
        return res.status(404).json({ success: false, message: 'Target unit not found' });
      }
      if (targetUnit._id.toString() === sourceUnit._id.toString()) {
        return res.status(400).json({ success: false, message: 'Target unit must be different from source unit' });
      }
    }

    let targetManager = null;
    if (targetReportingManagerId) {
      targetManager = await User.findById(targetReportingManagerId);
    }

    // Find all users in source unit
    const members = await User.find({ unit: sourceUnit._id, status: { $ne: 'DELETED' } });

    for (const member of members) {
      if (targetUnit) {
        member.unit = targetUnit._id;
        recordUnitChange(member, targetUnit._id, targetUnit.name, actor._id);
      }
      if (targetManager) {
        try {
          await validateReportingLine(member._id, targetManager._id);
          member.reportingManager = targetManager._id;
          const managerName = [targetManager.firstName, targetManager.lastName].filter(Boolean).join(' ') || targetManager.email;
          recordManagerChange(member, targetManager._id, managerName, actor._id);
        } catch (cycleErr) {
          console.warn(`[TRANSFER] Skipping manager reassignment for ${member.email}: ${cycleErr.message}`);
        }
      }
      await member.save();
    }

    // Also re-parent any sub-units if targetUnit provided
    if (targetUnit) {
      await CompanyUnit.updateMany(
        { parentUnit: sourceUnit._id },
        { parentUnit: targetUnit._id, level: targetUnit.level + 1 }
      );
    }

    res.json({
      success: true,
      message: `Successfully transferred ${members.length} member(s) to ${targetUnit ? targetUnit.name : 'new assignments'}.`,
      transferredCount: members.length,
    });
  } catch (error) {
    console.error('[COMPANY-UNITS] transferUnitMembers error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to transfer unit members',
      error: error.message,
    });
  }
};

/**
 * @desc    Get valid reporting manager options for a user (strictly excludes self and descendants to prevent loops)
 * @route   GET /api/companies/users/managers-options
 * @access  Company Users
 */
exports.getReportingManagerOptions = async (req, res) => {
  try {
    const company = await resolveCompany(req);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const { userId } = req.query;
    const rootCompanyUserId = company.user;

    // Fetch primary company account user info
    const primaryAdmin = await User.findById(rootCompanyUserId)
      .select('firstName lastName email mobile status jobTitle')
      .lean();

    // Fetch all active company sub-admins
    const allUsers = await User.find({
      role: 'company',
      isCompanySubAdmin: true,
      createdBy: rootCompanyUserId,
      status: { $ne: 'DELETED' },
    })
      .select('firstName lastName email mobile status jobTitle isUnitHead unit reportingManager')
      .populate('unit', 'name code')
      .lean();

    // If userId provided, identify and exclude self and all descendants down their reporting tree
    const excludedIds = new Set();
    if (userId) {
      const uIdStr = userId.toString();
      excludedIds.add(uIdStr);

      // Collect all descendants
      let queue = [uIdStr];
      while (queue.length > 0) {
        const nextQueue = [];
        for (const u of allUsers) {
          if (u.reportingManager && queue.includes(u.reportingManager.toString())) {
            const reporteeIdStr = u._id.toString();
            if (!excludedIds.has(reporteeIdStr)) {
              excludedIds.add(reporteeIdStr);
              nextQueue.push(reporteeIdStr);
            }
          }
        }
        queue = nextQueue;
      }
    }

    // Format eligible managers list
    const options = [];

    // Primary company admin is always a valid top-level reporting manager option
    if (primaryAdmin && (!userId || primaryAdmin._id.toString() !== userId.toString())) {
      options.push({
        _id: primaryAdmin._id,
        name: [primaryAdmin.firstName, primaryAdmin.lastName].filter(Boolean).join(' ') || company.decisionMakerName || primaryAdmin.email,
        email: primaryAdmin.email,
        jobTitle: 'Company Primary Administrator',
        isPrimaryAdmin: true,
      });
    }

    allUsers.forEach((u) => {
      if (!excludedIds.has(u._id.toString())) {
        options.push({
          _id: u._id,
          name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email,
          email: u.email,
          jobTitle: u.jobTitle || (u.isUnitHead ? 'Unit Head' : 'Team Member'),
          unitName: u.unit?.name || 'Unassigned',
          isUnitHead: !!u.isUnitHead,
        });
      }
    });

    res.json({
      success: true,
      data: options,
    });
  } catch (error) {
    console.error('[COMPANY-USERS] getReportingManagerOptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch manager options',
      error: error.message,
    });
  }
};
