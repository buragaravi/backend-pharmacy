const express = require('express');
const router = express.Router();
const otherProductController = require('../controllers/otherProductController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Add other products to central after invoice
router.post('/central/add', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  otherProductController.addOtherProductToCentral
);

// Allocate other products from central to lab
router.post('/allocate/lab', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  otherProductController.allocateOtherProductToLab
);

// Allocate other products from lab to faculty
router.post('/allocate/faculty', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  otherProductController.allocateOtherProductToFaculty
);

// Get other products stock (central or by lab)
router.get('/stock', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  otherProductController.getOtherProductStock
);

// Get available other products in central lab (for allocation forms)
router.get('/central/available', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant']), 
  otherProductController.getCentralAvailableOtherProducts
);

// Scan QR code for other products
router.post('/scan', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin', 'lab_assistant', 'faculty']), 
  otherProductController.scanOtherProductQRCode
);

module.exports = router;
