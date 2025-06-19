// pharmacy-backend/routes/invoiceRoutes.js
const express = require('express');
const router = express.Router();
const { createInvoice, getInvoices, createGlasswareInvoice, createOthersInvoice, createEquipmentInvoice } = require('../controllers/invoiceController');
const authorizeRole = require('../middleware/roleMiddleware');


// Create Invoice (admin, central_lab_admin only)
router.post('/',  createInvoice);

// Get all invoices (admin, central_lab_admin, lab_assistant)
router.get('/',  getInvoices);

// Glassware invoice
router.post('/glassware', createGlasswareInvoice);

// Others invoice
router.post('/others', createOthersInvoice); 

// Equipment invoice
router.post('/equipment', createEquipmentInvoice);

module.exports = router;
