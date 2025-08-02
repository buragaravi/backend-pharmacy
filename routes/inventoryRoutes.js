// routes/inventoryRoutes.js

const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

// Routes for Inventory Management

// Get all chemicals in the inventory with optional pagination and filtering
router.get('/all', authenticate, authorizeRoles('central_store_admin', 'lab_assistant'), inventoryController.getAllInventory);

// Get inventory by labId with optional pagination
router.get('/lab/:labId', authenticate, authorizeRoles('lab_assistant'), inventoryController.getInventoryByLab);


// Add a new chemical to the inventory (for Central Store admin only)
router.post('/add', authenticate, authorizeRoles('central_store_admin'), inventoryController.addChemical);

// Allocate chemicals to a lab and update live stock (for Central Store admin and lab assistant)
router.post('/allocate', authenticate, authorizeRoles('central_store_admin', 'lab_assistant'), inventoryController.allocateChemical);

// Get all live stock details (for Central Store admin and lab assistant)
router.get('/live-stock', authenticate, authorizeRoles('central_store_admin', 'lab_assistant'), inventoryController.getLiveStock);

module.exports = router;
