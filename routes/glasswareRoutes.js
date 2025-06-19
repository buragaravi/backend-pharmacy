const express = require('express');
const router = express.Router();
const glasswareController = require('../controllers/glasswareController');

// Add glassware to central after invoice
router.post('/central/add', glasswareController.addGlasswareToCentral);
// Allocate glassware from central to lab
router.post('/allocate/lab', glasswareController.allocateGlasswareToLab);
// Allocate glassware from lab to faculty
router.post('/allocate/faculty', glasswareController.allocateGlasswareToFaculty);
// Get glassware stock (central or by lab)
router.get('/stock', glasswareController.getGlasswareStock);
// Alias for frontend compatibility
router.get('/central/available', glasswareController.getCentralAvailableGlassware); // /api/glassware/central/available
// Scan QR code for glassware
router.post('/scan', glasswareController.scanGlasswareQRCode);

module.exports = router;
