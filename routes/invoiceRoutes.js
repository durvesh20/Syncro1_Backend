// backend/routes/invoiceRoutes.js — DISABLED (Payout/Invoice system inactive)

const express = require('express');
const router = express.Router();
const {
  getInvoices,
  getInvoice,
  sendInvoice,
  recordPayment
} = require('../controllers/invoiceController');
const { protect, authorize } = require('../middleware/auth');

router.use(protect);

// ========== INVOICE ROUTES - ALL DISABLED ==========
// These routes are kept for backward compatibility but return
// "Invoice system is currently disabled" messages from controller stubs

// All roles can view their invoices (returns empty array)
router.get('/', getInvoices);
router.get('/:id', getInvoice);

// Admin only (returns disabled message)
router.put('/:id/send', authorize('admin'), sendInvoice);

// Admin or Company can record payment (returns disabled message)
router.put('/:id/payment', authorize('admin', 'company'), recordPayment);

// ========== END INVOICE ROUTES ==========

module.exports = router;