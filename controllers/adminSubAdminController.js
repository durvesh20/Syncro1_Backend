// backend/controllers/adminSubAdminController.js

const User = require('../models/User');
const { ALL_PERMISSIONS, SUB_ADMIN_BUNDLES } = require('../utils/permissions');

// Helper: sanitize pagination
const sanitizePagination = (page, limit) => ({
    page: Math.max(1, Math.min(1000, parseInt(page) || 1)),
    limit: Math.max(1, Math.min(100, parseInt(limit) || 20))
});

// Helper: validate permissions
const validatePermissions = (permissions = []) => {
    if (!Array.isArray(permissions)) return false;
    return permissions.every((permission) => ALL_PERMISSIONS.includes(permission));
};

// @desc    Create sub-admin
// @route   POST /api/admin/sub-admins
// @access  Admin
exports.createSubAdmin = async (req, res) => {
    try {
        const {
            email,
            mobile,
            password,
            permissions = [],
            bundle,
            status = 'ACTIVE'
        } = req.body;

        if (!email || !mobile || !password) {
            return res.status(400).json({
                success: false,
                message: 'Email, mobile and password are required'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters'
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

        if (!validatePermissions(finalPermissions)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid permissions provided'
            });
        }

        const subAdmin = await User.create({
            email: normalizedEmail,
            mobile: normalizedMobile,
            password,
            role: 'sub_admin',
            status,
            permissions: [...new Set(finalPermissions)],
            createdBy: req.user._id,
            emailVerified: true,
            mobileVerified: true,
            isPasswordChanged: true
        });

        const responseUser = await User.findById(subAdmin._id).select('-password');

        res.status(201).json({
            success: true,
            message: 'Sub-admin created successfully',
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
        const { status, search } = req.query;

        const query = { role: 'sub_admin' };

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
        const subAdmin = await User.findOne({
            _id: req.params.id,
            role: 'sub_admin'
        })
            .select('-password')
            .populate('createdBy', 'email role');

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
            mobile,
            permissions,
            bundle,
            status
        } = req.body;

        const subAdmin = await User.findOne({
            _id: req.params.id,
            role: 'sub_admin'
        });

        if (!subAdmin) {
            return res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
        }

        if (mobile) {
            const normalizedMobile = mobile.replace(/\D/g, '').slice(-10);

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

            subAdmin.mobile = normalizedMobile;
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
            if (!validatePermissions(finalPermissions)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid permissions provided'
                });
            }

            subAdmin.permissions = [...new Set(finalPermissions)];
        }

        if (status) {
            subAdmin.status = status;

            if (status === 'SUSPENDED') {
                subAdmin.suspendedBy = req.user._id;
                subAdmin.suspendedAt = new Date();
            } else {
                subAdmin.suspendedBy = null;
                subAdmin.suspendedAt = null;
            }
        }

        await subAdmin.save();

        const updatedSubAdmin = await User.findById(subAdmin._id)
            .select('-password')
            .populate('createdBy', 'email role');

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

        const subAdmin = await User.findOne({
            _id: req.params.id,
            role: 'sub_admin'
        });

        if (!subAdmin) {
            return res.status(404).json({
                success: false,
                message: 'Sub-admin not found'
            });
        }

        subAdmin.status = status;

        if (status === 'SUSPENDED') {
            subAdmin.suspendedBy = req.user._id;
            subAdmin.suspendedAt = new Date();
        } else {
            subAdmin.suspendedBy = null;
            subAdmin.suspendedAt = null;
        }

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