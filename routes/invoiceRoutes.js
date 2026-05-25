// backend/routes/invoiceRoutes.js - COMPLETE REWRITE

const express = require('express');
const router = express.Router();
const {
  getInvoices,
  getInvoice,
  generateCompanyInvoice,
  sendInvoice,
  recordPayment,
  cancelInvoice
} = require('../controllers/invoiceController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// All authenticated users can view their invoices
router.get('/', getInvoices);
router.get('/:id', getInvoice);

// Admin only routes
router.post('/company', authorize('admin'), generateCompanyInvoice);
router.put('/:id/send', authorize('admin'), sendInvoice);
router.put('/:id/payment', authorize('admin', 'company'), recordPayment);
router.put('/:id/cancel', authorize('admin'), cancelInvoice);

module.exports = router;