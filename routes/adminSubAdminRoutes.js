// backend/routes/adminSubAdminRoutes.js

const express = require('express');
const router = express.Router();

const {
    createSubAdmin,
    getSubAdmins,
    getSubAdminById,
    updateSubAdmin,
    updateSubAdminStatus,
    getPermissionsMeta
} = require('../controllers/adminSubAdminController');

const { protect, authorize } = require('../middleware/auth');

// Only admin can manage sub-admins
router.use(protect);
router.use(authorize('admin'));

router.route('/')
    .post(createSubAdmin)
    .get(getSubAdmins);

router.get('/permissions', getPermissionsMeta);

router.route('/:id')
    .get(getSubAdminById)
    .put(updateSubAdmin);

router.put('/:id/status', updateSubAdminStatus);

module.exports = router;