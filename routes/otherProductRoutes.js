const express = require('express');
const router = express.Router();
const otherProductController = require('../controllers/otherProductController');

// Add other products to central after invoice
router.post('/central/add', otherProductController.addOtherProductToCentral);
// Allocate other products from central to lab
router.post('/allocate/lab', otherProductController.allocateOtherProductToLab);
// Allocate other products from lab to faculty
router.post('/allocate/faculty', otherProductController.allocateOtherProductToFaculty);
// Get other products stock (central or by lab)
router.get('/stock', otherProductController.getOtherProductStock);
// Get available other products in central lab (for allocation forms)
router.get('/central/available', otherProductController.getCentralAvailableOtherProducts); // /api/other/central/available
// Scan QR code for other products
router.post('/scan', otherProductController.scanOtherProductQRCode);

module.exports = router;
