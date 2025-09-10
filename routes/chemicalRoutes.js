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

// =====================
// 🔍 All Chemicals with Lab Quantities (for request form suggestions)
// =====================
router.get(
  '/all-with-lab-quantities',
  authorizeRole(['admin', 'central_store_admin', 'lab_assistant', 'faculty']),
  chemicalController.getAllChemicalsWithLabQuantities
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
 * /api/chemicals/all-with-lab-quantities:
 *   get:
 *     summary: Get all chemicals with quantities across labs (for request form suggestions)
 *     description: Accessible by all user roles (admin, central_store_admin, lab_assistant, faculty)
 *     tags:
 *       - Chemicals
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by chemical name (case-insensitive)
 *       - in: query
 *         name: labId
 *         schema:
 *           type: string
 *         description: Filter by specific lab ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of results per page
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *     responses:
 *       200:
 *         description: List of chemicals with lab quantities
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 chemicals:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ChemicalWithLabQuantities'
 *                 pagination:
 *                   $ref: '#/components/schemas/PaginationInfo'
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       403:
 *         description: Forbidden - Insufficient permissions
 *       500:
 *         description: Internal server error
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
 *     
 *     ChemicalWithLabQuantities:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           description: The unique identifier for the chemical master
 *         displayName:
 *           type: string
 *           description: The display name of the chemical
 *         chemicalName:
 *           type: string
 *           description: The full chemical name (may include batch suffix)
 *         unit:
 *           type: string
 *           description: The unit of the chemical
 *         expiryDate:
 *           type: string
 *           format: date-time
 *           description: The expiry date of the chemical
 *         totalQuantity:
 *           type: number
 *           description: Total quantity across all labs
 *         labs:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               labId:
 *                 type: string
 *                 description: The lab ID
 *               quantity:
 *                 type: number
 *                 description: Quantity available in this lab
 *               originalQuantity:
 *                 type: number
 *                 description: Original quantity when first added to this lab
 *               isAllocated:
 *                 type: boolean
 *                 description: Whether this chemical was allocated to this lab
 *         batchId:
 *           type: string
 *           description: The batch ID of the chemical
 *         vendor:
 *           type: string
 *           description: The vendor of the chemical
 *         pricePerUnit:
 *           type: number
 *           description: The price per unit of the chemical
 *         department:
 *           type: string
 *           description: The department associated with the chemical
 *     
 *     PaginationInfo:
 *       type: object
 *       properties:
 *         currentPage:
 *           type: integer
 *           description: Current page number
 *         totalPages:
 *           type: integer
 *           description: Total number of pages
 *         totalCount:
 *           type: integer
 *           description: Total number of items
 *         limit:
 *           type: integer
 *           description: Number of items per page
 *         hasNext:
 *           type: boolean
 *           description: Whether there is a next page
 *         hasPrev:
 *           type: boolean
 *           description: Whether there is a previous page
 */

module.exports = router;
