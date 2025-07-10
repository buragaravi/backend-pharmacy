// pharmacy-backend/routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();
const { createInvoice, getInvoices, createGlasswareInvoice, createOthersInvoice, createEquipmentInvoice } = require('../controllers/invoiceController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Create Invoice (admin, central_lab_admin only)
router.post('/', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  createInvoice
);

// Get all invoices (admin, central_lab_admin, lab_assistant)
router.get('/', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  getInvoices
);

// Glassware invoice
router.post('/glassware', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  createGlasswareInvoice
);

// Others invoice
router.post('/others', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  createOthersInvoice
); 

// Equipment invoice
router.post('/equipment', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  createEquipmentInvoice
);

module.exports = router;
