const express = require('express');
const router = express.Router();
const chemicalController = require('../controllers/ChemicalController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');
const { body } = require('express-validator');

// ============ VALIDATORS ============

// For adding single or multiple chemicals
const validateChemicalEntry = [
  body('chemicals').isArray({ min: 1 }).withMessage('Chemicals array is required'),
  body('chemicals.*.chemicalName').notEmpty().withMessage('Chemical name is required'),
  body('chemicals.*.quantity').isNumeric().withMessage('Quantity must be numeric'),
  body('chemicals.*.unit').notEmpty().withMessage('Unit is required'),
  body('chemicals.*.expiryDate').isISO8601().withMessage('Valid expiry date is required'),
  body('chemicals.*.vendor').notEmpty().withMessage('Vendor is required'),
  body('chemicals.*.pricePerUnit').isNumeric().withMessage('Price per unit must be numeric'),
  body('chemicals.*.department').notEmpty().withMessage('Department is required'),
];

// For allocating one or more chemicals to labs
const validateAllocationBatch = [
  body('labId').notEmpty().withMessage('Lab ID is required'),
  body('allocations').isArray({ min: 1 }).withMessage('Allocations array is required'),
  body('allocations.*.chemicalMasterId').notEmpty().withMessage('chemicalMasterId is required'),
  body('allocations.*.quantity').isNumeric().withMessage('Quantity must be numeric'),
];

// ============ ROUTES ============

// 🔐 All routes require authentication
router.use(authenticate);

// =====================
// 📦 Add Chemicals to Master
// =====================
router.post(
  '/add',
  authorizeRole(['admin', 'central_store_admin']),
  validateChemicalEntry,
  chemicalController.addChemicalsToCentral
);

// =====================
// 📤 Allocate Chemicals to Labs
// =====================
router.post(
  '/allocate',
  authorizeRole(['admin','central_store_admin']),
  validateAllocationBatch,
  chemicalController.allocateChemicalsToLab
);

// =====================
// 📃 Master Inventory
// =====================
router.get(
  '/master',
  authorizeRole(['admin', 'central_store_admin']),
  chemicalController.getCentralMasterChemicals 
);

router.get(
  '/master/:labId',
  authorizeRole(['admin', 'central_store_admin', 'lab_assistant']),
  chemicalController.getLabMasterChemicals
);

// =====================
// 📊 Live Stock by Lab
// =====================
router.get(
  '/live/:labId',
  authorizeRole(['admin', 'central_store_admin', 'lab_assistant']),
  chemicalController.getLiveStockByLab
);

router.get(
  '/central/available',
  authenticate,
  chemicalController.getCentralLiveSimplified
);

// =====================
// 📊 Distribution
// =====================
router.get(
  '/distribution',
  authorizeRole(['admin', 'central_store_admin', 'lab_assistant']),
  chemicalController.getChemicalDistribution
);

// =====================
// 🧪 Expired Chemicals Management
// =====================
router.get(
  '/expired',
  authorizeRole(['admin','central_store_admin']),
  chemicalController.getExpiredChemicals
);

router.post(
  '/expired/action',
  authorizeRole(['central_store_admin', 'admin']),
  chemicalController.processExpiredChemicalAction
);

// =====================
// 🚨 Out-of-Stock Chemicals
// =====================
router.get(
  '/out-of-stock',
  authorizeRole(['admin', 'central_store_admin', 'lab_assistant']),
  chemicalController.getOutOfStockChemicals
);

/**
 * @swagger
 * /api/chemicals/out-of-stock:
 *   get:
 *     summary: Get all out-of-stock chemicals
 *     tags:
 *       - Chemicals
 *     responses:
 *       200:
 *         description: List of out-of-stock chemicals
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/OutOfStockChemical'
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     OutOfStockChemical:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The unique identifier for the out-of-stock chemical
 *         displayName:
 *           type: string
 *           description: The display name of the chemical
 *         unit:
 *           type: string
 *           description: The unit of the chemical
 *         lastOutOfStock:
 *           type: string
 *           format: date-time
 *           description: The date and time when the chemical went out of stock
 */

module.exports = router;
