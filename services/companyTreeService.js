// backend/services/companyTreeService.js
const mongoose = require('mongoose');
const User = require('../models/User');
const CompanyUnit = require('../models/CompanyUnit');

/**
 * Validates that setting `proposedManagerId` as the reporting manager for `userId`
 * does not create a self-reporting scenario or a circular reporting loop.
 *
 * @param {string|mongoose.Types.ObjectId} userId - User being assigned a manager
 * @param {string|mongoose.Types.ObjectId|null} proposedManagerId - Proposed reporting manager
 * @returns {Promise<boolean>}
 * @throws {Error} If circular loop or self-reporting is detected
 */
const validateReportingLine = async (userId, proposedManagerId) => {
  if (!proposedManagerId) return true;

  const targetIdStr = userId ? userId.toString() : null;
  const proposedIdStr = proposedManagerId.toString();

  if (targetIdStr && targetIdStr === proposedIdStr) {
    throw new Error('A user cannot be their own reporting manager.');
  }

  // Walk up the management line from proposedManagerId to ensure targetIdStr is not encountered
  let currentId = proposedManagerId;
  const visited = new Set();

  while (currentId) {
    const currentIdStr = currentId.toString();
    if (targetIdStr && currentIdStr === targetIdStr) {
      throw new Error(
        'Circular reporting loop detected: The proposed manager already reports up to this user.'
      );
    }

    if (visited.has(currentIdStr)) {
      throw new Error('An existing reporting cycle was detected in the management chain.');
    }
    visited.add(currentIdStr);

    const managerDoc = await User.findById(currentId).select('reportingManager');
    if (!managerDoc || !managerDoc.reportingManager) {
      break;
    }
    currentId = managerDoc.reportingManager;
  }

  return true;
};

/**
 * Computes the list of user IDs accessible to the given user based on their dataScope and hierarchy.
 * Returns null if the user has unrestricted access to the entire company (e.g. primary account or COMPANY scope).
 *
 * @param {Object} user - The requesting User document or object
 * @param {string|mongoose.Types.ObjectId} companyId - The Company ObjectId
 * @returns {Promise<Array<mongoose.Types.ObjectId>|null>}
 */
const computeScopedUserIds = async (user, companyId) => {
  if (!user) return [];

  // Primary company account has full access across all units and users
  if (!user.isCompanySubAdmin || user.dataScope === 'COMPANY') {
    return null;
  }

  // UNIT scope or Unit Head: Access to own unit and all descendant sub-units
  if (user.dataScope === 'UNIT' || user.isUnitHead) {
    if (!user.unit) {
      return [user._id];
    }

    const unitDoc = await CompanyUnit.findById(user.unit);
    if (!unitDoc) {
      return [user._id];
    }

    // Materialized path regex to find all descendant sub-units
    const unitRegex = new RegExp(`^${unitDoc.path}`);
    const descendantUnits = await CompanyUnit.find({
      company: companyId,
      path: unitRegex,
      status: 'ACTIVE',
    }).select('_id');

    const unitIds = descendantUnits.map((u) => u._id);
    const members = await User.find({
      unit: { $in: unitIds },
      status: { $ne: 'DELETED' },
    }).select('_id');

    const memberIds = members.map((m) => m._id);
    if (!memberIds.some((id) => id.toString() === user._id.toString())) {
      memberIds.push(user._id);
    }
    return memberIds;
  }

  // TEAM scope: Access to self and all direct/indirect reportees down the reporting chain
  if (user.dataScope === 'TEAM') {
    const reporteeIds = [user._id];
    let queue = [user._id];

    while (queue.length > 0) {
      const reports = await User.find({
        reportingManager: { $in: queue },
        status: { $ne: 'DELETED' },
      }).select('_id');

      if (reports.length === 0) break;
      const nextQueue = reports.map((r) => r._id);
      reporteeIds.push(...nextQueue);
      queue = nextQueue;
    }
    return reporteeIds;
  }

  // Default: 'OWN' - strictly only the user's own data
  return [user._id];
};

/**
 * Records a unit change in a user's unitHistory
 *
 * @param {Object} userDoc - Mongoose User document
 * @param {mongoose.Types.ObjectId|null} newUnitId
 * @param {string} newUnitName
 * @param {mongoose.Types.ObjectId} changedByUserId
 */
const recordUnitChange = (userDoc, newUnitId, newUnitName = '', changedByUserId) => {
  if (!userDoc.unitHistory) userDoc.unitHistory = [];

  // Close previous active history entry
  const lastActive = userDoc.unitHistory.find((h) => !h.removedAt);
  if (lastActive) {
    lastActive.removedAt = new Date();
  }

  if (newUnitId) {
    userDoc.unitHistory.push({
      unit: newUnitId,
      unitName: newUnitName,
      assignedAt: new Date(),
      removedAt: null,
      changedBy: changedByUserId,
    });
  }
};

/**
 * Records a reporting manager change in a user's managerHistory
 *
 * @param {Object} userDoc - Mongoose User document
 * @param {mongoose.Types.ObjectId|null} newManagerId
 * @param {string} newManagerName
 * @param {mongoose.Types.ObjectId} changedByUserId
 */
const recordManagerChange = (userDoc, newManagerId, newManagerName = '', changedByUserId) => {
  if (!userDoc.managerHistory) userDoc.managerHistory = [];

  // Close previous active history entry
  const lastActive = userDoc.managerHistory.find((h) => !h.removedAt);
  if (lastActive) {
    lastActive.removedAt = new Date();
  }

  if (newManagerId) {
    userDoc.managerHistory.push({
      manager: newManagerId,
      managerName: newManagerName,
      assignedAt: new Date(),
      removedAt: null,
      changedBy: changedByUserId,
    });
  }
};

/**
 * Checks whether a unit can be safely deleted or if it still has active members or sub-units
 *
 * @param {string|mongoose.Types.ObjectId} unitId
 * @returns {Promise<{canDelete: boolean, message?: string, memberCount: number, subUnitCount: number}>}
 */
const canDeleteUnit = async (unitId) => {
  const [memberCount, subUnitCount] = await Promise.all([
    User.countDocuments({ unit: unitId, status: { $ne: 'DELETED' } }),
    CompanyUnit.countDocuments({ parentUnit: unitId, status: { $ne: 'INACTIVE' } }),
  ]);

  if (memberCount > 0 || subUnitCount > 0) {
    const reasons = [];
    if (memberCount > 0) reasons.push(`${memberCount} active member(s)`);
    if (subUnitCount > 0) reasons.push(`${subUnitCount} sub-unit(s)`);
    return {
      canDelete: false,
      message: `Unit cannot be deleted because it still contains ${reasons.join(' and ')}. Please reassign them first.`,
      memberCount,
      subUnitCount,
    };
  }

  return { canDelete: true, memberCount: 0, subUnitCount: 0 };
};

/**
 * Builds the complete hierarchical organization tree for a company,
 * including nested units, sub-units, unit heads, members, and unassigned users.
 *
 * @param {string|mongoose.Types.ObjectId} companyId
 * @param {string|mongoose.Types.ObjectId} rootCompanyUserId
 * @returns {Promise<Object>}
 */
const buildCompanyTree = async (companyId, rootCompanyUserId) => {
  const [units, allUsers] = await Promise.all([
    CompanyUnit.find({ company: companyId, status: 'ACTIVE' })
      .populate('head', 'firstName lastName email mobile status jobTitle')
      .sort({ level: 1, createdAt: 1 })
      .lean(),
    User.find({
      role: 'company',
      isCompanySubAdmin: true,
      createdBy: rootCompanyUserId,
      status: { $ne: 'DELETED' },
    })
      .select('firstName lastName email mobile status jobTitle isUnitHead unit reportingManager dataScope permissions createdAt')
      .populate('reportingManager', 'firstName lastName email jobTitle')
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  // Group users by unit
  const usersByUnit = {};
  const unassignedUsers = [];

  for (const user of allUsers) {
    if (user.unit) {
      const uId = user.unit.toString();
      if (!usersByUnit[uId]) usersByUnit[uId] = [];
      usersByUnit[uId].push(user);
    } else {
      unassignedUsers.push(user);
    }
  }

  // Build recursive unit tree
  const unitMap = {};
  units.forEach((unit) => {
    unitMap[unit._id.toString()] = {
      ...unit,
      members: usersByUnit[unit._id.toString()] || [],
      memberCount: (usersByUnit[unit._id.toString()] || []).length,
      subUnits: [],
    };
  });

  const rootUnits = [];
  units.forEach((unit) => {
    const node = unitMap[unit._id.toString()];
    if (unit.parentUnit && unitMap[unit.parentUnit.toString()]) {
      unitMap[unit.parentUnit.toString()].subUnits.push(node);
    } else {
      rootUnits.push(node);
    }
  });

  return {
    totalUnits: units.length,
    totalUsers: allUsers.length,
    unassignedCount: unassignedUsers.length,
    rootUnits,
    unassignedUsers,
  };
};

module.exports = {
  validateReportingLine,
  computeScopedUserIds,
  recordUnitChange,
  recordManagerChange,
  canDeleteUnit,
  buildCompanyTree,
};
