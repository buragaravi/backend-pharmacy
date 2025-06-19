const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');


// Public routes
router.get('/', vendorController.getVendors);
router.get('/search', vendorController.searchVendors);
router.get('/:id', vendorController.getVendorById);

// Protected admin routes
router.post('/',  vendorController.createVendor);
router.put('/:id',  vendorController.updateVendor);
router.delete('/:id',  vendorController.deleteVendor);

module.exports = router;