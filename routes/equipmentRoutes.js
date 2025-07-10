const express = require('express');
const router = express.Router();
const equipmentController = require('../controllers/equipmentController');
const {  getStockCheckReports, getStockCheckReport, saveStockCheckReport, getLiveEquipmentByLab, getCurrentMonthStockCheckReports } = require('../controllers/equipmentController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Add equipment to central after invoice
router.post('/central/add', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  equipmentController.addEquipmentToCentral
);

// Allocate equipment from central to lab
router.post('/allocate/lab', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  equipmentController.allocateEquipmentToLab
);

// Allocate equipment from lab to faculty
router.post('/allocate/faculty', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  equipmentController.allocateEquipmentToFaculty
);

// Get equipment stock (central or by lab)
router.get('/stock', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  equipmentController.getEquipmentStock
);

// Get available equipment in central lab (for allocation forms)
router.get('/central/available', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  equipmentController.getCentralAvailableEquipment
);

// Scan QR code for equipment
router.post('/scan', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant', 'faculty']), 
  equipmentController.scanEquipmentQRCode
);

// Return equipment to central by QR scan (itemId)
router.post('/return/central', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  equipmentController.returnEquipmentToCentral
);

// Allocate equipment by QR scan
router.post('/allocate/scan', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  equipmentController.allocateEquipmentToLabByScan
);

// Get full equipment trace (item, transactions, audit logs) by itemId
router.get('/item/:itemId/full-trace', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  equipmentController.getEquipmentItemFullTraceHandler
);

// Stock check routes
router.get('/stock-check/reports', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  getStockCheckReports
);

router.get('/stock-check/report/:id', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  getStockCheckReport
);

router.post('/stock-check/report', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  saveStockCheckReport
);

router.get('/live', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  getLiveEquipmentByLab
);

router.get('/stock-check/reports/month', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  getCurrentMonthStockCheckReports
);

module.exports = router;
