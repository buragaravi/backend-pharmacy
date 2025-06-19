const express = require('express');
const router = express.Router();
const equipmentController = require('../controllers/equipmentController');
const {  getStockCheckReports, getStockCheckReport, saveStockCheckReport, getLiveEquipmentByLab, getCurrentMonthStockCheckReports } = require('../controllers/equipmentController');
const authMiddleware = require('../middleware/authMiddleware');

// Add equipment to central after invoice
router.post('/central/add', equipmentController.addEquipmentToCentral);
// Allocate equipment from central to lab
router.post('/allocate/lab', equipmentController.allocateEquipmentToLab);
// Allocate equipment from lab to faculty
router.post('/allocate/faculty', equipmentController.allocateEquipmentToFaculty);
// Get equipment stock (central or by lab)
router.get('/stock', equipmentController.getEquipmentStock);
// Get available equipment in central lab (for allocation forms)
router.get('/central/available', equipmentController.getCentralAvailableEquipment);
// Scan QR code for equipment
router.post('/scan', equipmentController.scanEquipmentQRCode);
// Return equipment to central by QR scan (itemId)
router.post('/return/central', equipmentController.returnEquipmentToCentral);
// Alias for frontend compatibility// /api/equipment/central/available
router.post('/allocate/scan', equipmentController.allocateEquipmentToLabByScan);
// Get full equipment trace (item, transactions, audit logs) by itemId
router.get('/item/:itemId/full-trace', equipmentController.getEquipmentItemFullTraceHandler);
// Stock check route
router.get('/stock-check/reports', authMiddleware, getStockCheckReports);
router.get('/stock-check/report/:id', authMiddleware, getStockCheckReport);
router.post('/stock-check/report', authMiddleware, saveStockCheckReport);
router.get('/live', authMiddleware, getLiveEquipmentByLab);
router.get('/stock-check/reports/month', authMiddleware, getCurrentMonthStockCheckReports);

module.exports = router;
