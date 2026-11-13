// backend/controllers/adminSubAdminController.js

const crypto = require('crypto');
const User = require('../models/User');
const { ALL_PERMISSIONS, SUB_ADMIN_BUNDLES } = require('../utils/permissions');
const emailService = require('../services/emailService');

// Generate a secure random password
const generatePassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '@#$!';
    const all = upper + lower + digits + special;
    const rand = (str) => str[crypto.randomInt(str.length)];
    const base = rand(upper) + rand(lower) + rand(digits) + rand(special);
    const rest = Array.from({ length: 8 }, () => rand(all)).join('');
    // Shuffle the 12-char password
    return (base + rest).split('').sort(() => crypto.randomInt(3) - 1).join('');
};

// Helper: sanitize pagination
const sanitizePagination = (page, limit) => ({
    page: Math.max(1, Math.min(1000, parseInt(page) || 1)),
    limit: Math.max(1, Math.min(100, parseInt(limit) || 20))
});

// Helper: sanitize permissions — strips any unknown/removed keys instead of rejecting
const sanitizePermissions = (permissions = []) => {
    if (!Array.isArray(permissions)) return [];
    return permissions.filter((permission) => ALL_PERMISSIONS.includes(permission));
};

// @desc    Create sub-admin
// @route   POST /api/admin/sub-admins
// @access  Admin
exports.createSubAdmin = async (req, res) => {
    try {
        const {
            firstName = '',
            lastName = '',
            email,
            mobile,
            permissions = [],
            bundle,
            status = 'ACTIVE',
            role = 'sub_admin'
        } = req.body;

        if (role === 'admin') {
            if (req.user.role !== 'super_admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Only Super Admin can create Admin accounts'
                });
            }
        } else if (role !== 'sub_admin') {
            return res.status(400).json({
                success: false,
                message: 'Invalid role. Must be sub_admin or admin'
            });
        }

        if (!email || !mobile) {
            return res.status(400).json({
                success: false,
                message: 'Email and mobile are required'
            });
        }

        if (!firstName.trim() || !lastName.trim()) {
            return res.status(400).json({
                success: false,
                message: 'First name and last name are required'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

        const existingUser = await User.findOne({
            $or: [
                { email: normalizedEmail },
                { mobile: normalizedMobile }
            ]
        });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User with this email or mobile already exists'
            });
        }

        let finalPermissions = permissions;

        // If bundle provided and permissions not provided, use bundle
        if ((!permissions || permissions.length === 0) && bundle) {
            if (!SUB_ADMIN_BUNDLES[bundle]) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid permission bundle'
                });
            }
            finalPermissions = SUB_ADMIN_BUNDLES[bundle];
        }

        finalPermissions = sanitizePermissions(finalPermissions);

        // Auto-generate a secure password
        const autoPassword = generatePassword();

        const finalRole = role;
        const assignedPermissions = finalRole === 'admin' ? ALL_PERMISSIONS : [...new Set(finalPermissions)];

        const subAdmin = await User.create({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: normalizedEmail,
            mobile: normalizedMobile,
            password: autoPassword,
            role: finalRole,
            status,
            permissions: assignedPermissions,
            createdBy: req.user._id,
            emailVerified: true,
            mobileVerified: true,
            isPasswordChanged: false,  // Must change on first login
            subAdminActivityLogs: [{
                action: 'CREATED',
                actor: req.user._id,
                timestamp: new Date(),
                details: {
                    role: finalRole,
                    newPermissions: assignedPermissions,
                    newStatus: status
                }
            }]
        });

        // Send onboarding welcome email (fire-and-forget)
        emailService.sendSubAdminWelcome(
            normalizedEmail,
            firstName.trim(),
            lastName.trim(),
            autoPassword,
            assignedPermissions,
            finalRole === 'admin' ? 'Admin' : 'Sub-Admin'
        ).catch(e => console.error('[ADMIN-MGMT] Welcome email failed:', e.message));

        const responseUser = await User.findById(subAdmin._id).select('-password');

        res.status(201).json({
            success: true,
            message: `${finalRole === 'admin' ? 'Admin' : 'Sub-admin'} created! Welcome email sent to ${normalizedEmail}`,
            data: responseUser
        });
    } catch (error) {
        console.error('[SUB-ADMIN] Create error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create sub-admin',
            error: error.message
        });
    }
};

// @desc    Get all sub-admins
// @route   GET /api/admin/sub-admins
// @access  Admin
exports.getSubAdmins = async (req, res) => {
    try {
        const { page, limit } = sanitizePagination(req.query.page, req.query.limit);
        const { status, search, role: filterRole } = req.query;

        let query = {};
        if (req.user.role === 'super_admin') {
            if (filterRole === 'admin') {
                query.role = 'admin';
            } else if (filterRole === 'sub_admin') {
                query.role = 'sub_admin';
            } else {
                query.role = { $in: ['sub_admin', 'admin'] };
            }
        } else {
            query.role = 'sub_admin';
        }

        if (status) {
            query.status = status;
        }

        if (search) {
            query.$or = [
                { email: new RegExp(search, 'i') },
                { mobile: new RegExp(search, 'i') }
            ];
        }

        const skip = (page - 1) * limit;

        const [subAdmins, total] = await Promise.all([
            User.find(query)
                .select('-password')
                .populate('createdBy', 'email role')
                .populate('subAdminActivityLogs.actor', 'email role')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            User.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: {
                subAdmins,
                pagination: {
                    current: page,
                    pages: Math.ceil(total / limit),
                    total,
                    limit
                }
            }
        });
    } catch (error) {
        console.error('[SUB-ADMIN] List error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sub-admins',
            error: error.message
        });
    }
};

// @desc    Get single sub-admin
// @route   GET /api/admin/sub-admins/:id
// @access  Admin
exports.getSubAdminById = async (req, res) => {
    try {
        const allowedRoles = req.user.role === 'super_admin' ? ['sub_admin', 'admin'] : ['sub_admin'];
        const subAdmin = await User.findOne({
            _id: req.params.id,
            role: { $in: allowedRoles }
        })
            .select('-password')
            .populate('createdBy', 'email role')
            .populate('subAdminActivityLogs.actor', 'email role');

        if (!subAdmin) {
            return res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
        }

        res.json({
            success: true,
            data: subAdmin
        });
    } catch (error) {
        console.error('[SUB-ADMIN] Get by id error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch sub-admin',
            error: error.message
        });
    }
};

// @desc    Update sub-admin
// @route   PUT /api/admin/sub-admins/:id
// @access  Admin
exports.updateSubAdmin = async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            mobile,
            permissions,
            bundle,
            status
        } = req.body;

        const allowedRoles = req.user.role === 'super_admin' ? ['sub_admin', 'admin'] : ['sub_admin'];
        const subAdmin = await User.findOne({
            _id: req.params.id,
            role: { $in: allowedRoles }
        });

        if (!subAdmin) {
            return res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
        }

        const previousPermissions = [...subAdmin.permissions];
        const previousStatus = subAdmin.status;
        const changedFields = {};

        if (firstName !== undefined && firstName.trim() !== subAdmin.firstName) {
            changedFields.firstName = { from: subAdmin.firstName, to: firstName.trim() };
            subAdmin.firstName = firstName.trim();
        }
        if (lastName !== undefined && lastName.trim() !== subAdmin.lastName) {
            changedFields.lastName = { from: subAdmin.lastName, to: lastName.trim() };
            subAdmin.lastName = lastName.trim();
        }

        if (mobile) {
            const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);
            if (normalizedMobile !== subAdmin.mobile) {
                const existingMobileUser = await User.findOne({
                    mobile: normalizedMobile,
                    _id: { $ne: subAdmin._id }
                });

                if (existingMobileUser) {
                    return res.status(400).json({
                        success: false,
                        message: 'Mobile number already in use'
                    });
                }

                changedFields.mobile = { from: subAdmin.mobile, to: normalizedMobile };
                subAdmin.mobile = normalizedMobile;
            }
        }

        let finalPermissions = permissions;

        if ((!permissions || permissions.length === 0) && bundle) {
            if (!SUB_ADMIN_BUNDLES[bundle]) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid permission bundle'
                });
            }
            finalPermissions = SUB_ADMIN_BUNDLES[bundle];
        }

        if (finalPermissions !== undefined) {
            const sanitized = [...new Set(sanitizePermissions(finalPermissions))];
            const permissionsChanged = JSON.stringify([...sanitized].sort()) !== JSON.stringify([...previousPermissions].sort());
            if (permissionsChanged) {
                changedFields.permissions = { from: previousPermissions, to: sanitized };
                subAdmin.permissions = sanitized;
            }
        }

        if (status && status !== subAdmin.status) {
            changedFields.status = { from: subAdmin.status, to: status };
            subAdmin.status = status;

            if (status === 'SUSPENDED') {
                subAdmin.suspendedBy = req.user._id;
                subAdmin.suspendedAt = new Date();
            } else {
                subAdmin.suspendedBy = null;
                subAdmin.suspendedAt = null;
            }
        }

        if (Object.keys(changedFields).length > 0) {
            subAdmin.subAdminActivityLogs.push({
                action: 'UPDATED',
                actor: req.user._id,
                timestamp: new Date(),
                details: {
                    previousPermissions,
                    newPermissions: subAdmin.permissions,
                    previousStatus,
                    newStatus: subAdmin.status,
                    changedFields
                }
            });
        }

        await subAdmin.save();

        const updatedSubAdmin = await User.findById(subAdmin._id)
            .select('-password')
            .populate('createdBy', 'email role')
            .populate('subAdminActivityLogs.actor', 'email role');

        res.json({
            success: true,
            message: 'Sub-admin updated successfully',
            data: updatedSubAdmin
        });
    } catch (error) {
        console.error('[SUB-ADMIN] Update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update sub-admin',
            error: error.message
        });
    }
};

// @desc    Update sub-admin status
// @route   PUT /api/admin/sub-admins/:id/status
// @access  Admin
exports.updateSubAdminStatus = async (req, res) => {
    try {
        const { status } = req.body;

        if (!['ACTIVE', 'SUSPENDED', 'REJECTED'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Allowed: ACTIVE, SUSPENDED, REJECTED'
            });
        }

        const allowedRoles = req.user.role === 'super_admin' ? ['sub_admin', 'admin'] : ['sub_admin'];
        const subAdmin = await User.findOne({
            _id: req.params.id,
            role: { $in: allowedRoles }
        });

        if (!subAdmin) {
            return res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
        }

        const previousStatus = subAdmin.status;
        subAdmin.status = status;

        if (status === 'SUSPENDED') {
            subAdmin.suspendedBy = req.user._id;
            subAdmin.suspendedAt = new Date();
        } else {
            subAdmin.suspendedBy = null;
            subAdmin.suspendedAt = null;
        }

        subAdmin.subAdminActivityLogs.push({
            action: 'STATUS_CHANGED',
            actor: req.user._id,
            timestamp: new Date(),
            details: {
                previousStatus,
                newStatus: status,
                changedFields: {
                    status: { from: previousStatus, to: status }
                }
            }
        });

        await subAdmin.save();

        res.json({
            success: true,
            message: 'Sub-admin status updated successfully',
            data: {
                id: subAdmin._id,
                email: subAdmin.email,
                status: subAdmin.status,
                suspendedAt: subAdmin.suspendedAt
            }
        });
    } catch (error) {
        console.error('[SUB-ADMIN] Status update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update sub-admin status',
            error: error.message
        });
    }
};

// @desc    Get available permissions and bundles
// @route   GET /api/admin/sub-admins/permissions
// @access  Admin
exports.getPermissionsMeta = async (req, res) => {
    try {
        const {
            PERMISSIONS,
            ALL_PERMISSIONS,
            PERMISSION_GROUPS,
            SUB_ADMIN_BUNDLES
        } = require('../utils/permissions');

        res.json({
            success: true,
            data: {
                allPermissions: ALL_PERMISSIONS,
                groups: PERMISSION_GROUPS,
                bundles: SUB_ADMIN_BUNDLES,
                totalPermissions: ALL_PERMISSIONS.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch permissions metadata',
            error: error.message
        });
    }
};