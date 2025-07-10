const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Public routes
router.get('/', vendorController.getVendors);
router.get('/search', vendorController.searchVendors);
router.get('/:id', vendorController.getVendorById);

// Protected admin routes
router.post('/', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  vendorController.createVendor
);
router.put('/:id', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  vendorController.updateVendor
);
router.delete('/:id', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  vendorController.deleteVendor
);

module.exports = router;