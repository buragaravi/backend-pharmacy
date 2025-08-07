const express = require('express');
const router = express.Router();
const quotationController = require('../controllers/quotationController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');
const { check } = require('express-validator');

// LAB ASSISTANT ROUTES
router.post(
  '/lab',
  authenticate,
  authorizeRole('lab_assistant'),
  [
    check('labId', 'Lab ID is required').not().isEmpty(),
    check('quotationType', 'Quotation type is required').isIn(['chemicals', 'equipment', 'glassware', 'mixed']),
    check('chemicals').optional().isArray(),
    check('equipment').optional().isArray(),
    check('glassware').optional().isArray(),
    check('chemicals.*.chemicalName').optional().not().isEmpty(),
    check('chemicals.*.quantity').optional().isNumeric().toFloat(),
    check('chemicals.*.unit').optional().not().isEmpty(),
    check('equipment.*.equipmentName').optional().not().isEmpty(),
    check('equipment.*.quantity').optional().isNumeric().toFloat(),
    check('equipment.*.unit').optional().not().isEmpty(),
    check('glassware.*.glasswareName').optional().not().isEmpty(),
    check('glassware.*.quantity').optional().isNumeric().toFloat(),
    check('glassware.*.unit').optional().not().isEmpty()
  ],
  quotationController.createLabQuotation
);

router.get(
  '/lab',
  authenticate,
  authorizeRole('lab_assistant'),
  quotationController.getLabAssistantQuotations
);

// Central Store ADMIN ROUTES
router.post(
  '/central/draft',
  authenticate,
  authorizeRole('central_store_admin'),
  [
    check('quotationType', 'Quotation type is required').isIn(['chemicals', 'equipment', 'glassware', 'mixed']),
    check('chemicals').optional().isArray(),
    check('equipment').optional().isArray(),
    check('glassware').optional().isArray(),
    check('totalPrice', 'Total price is required').isNumeric().toFloat()
  ],
  quotationController.createDraftQuotation
);

router.post(
  '/central/draft/add-chemical',
  authenticate,
  authorizeRole('central_store_admin'),
  [
    check('quotationId', 'Quotation ID is required').not().isEmpty(),
    check('chemicalName', 'Chemical name is required').not().isEmpty(),
    check('quantity', 'Valid quantity is required').isNumeric().toFloat(),
    check('unit', 'Unit is required').not().isEmpty(),
    check('pricePerUnit', 'Price per unit is required').isNumeric().toFloat()
  ],
  quotationController.addChemicalToDraft
);

router.patch(
  '/central/draft/submit',
  authenticate,
  authorizeRole('central_store_admin'),
  [
    check('quotationId', 'Quotation ID is required').not().isEmpty()
  ],
  quotationController.submitDraftToPending
);

// Add proper validation for allocateLabQuotation route
router.patch(
  '/central/allocate',
  authenticate,
  authorizeRole('central_store_admin'),
  [
    check('quotationId', 'Quotation ID is required').not().isEmpty(),
    check('status', 'Valid status is required').isIn(['allocated', 'partially_fulfilled', 'rejected']),
  ],
  quotationController.allocateLabQuotation
);

router.get(
  '/central',
  authenticate,
  authorizeRole('central_store_admin'),
  quotationController.getCentralAdminQuotations
);

// ADMIN ROUTES
router.patch(
  '/admin/process',
  authenticate,
  authorizeRole('admin'),
  [
    check('status', 'Valid status is required').isIn(['approved', 'rejected', 'purchasing', 'purchased']),
    check('comments', 'Comments are required').optional().isString()
  ],
  quotationController.processCentralQuotation
);

router.get(
  '/admin',
  authenticate,
  authorizeRole('admin'),
  quotationController.getAdminQuotations
);

// COMMON ROUTES
router.get(
  '/:id',
  authenticate,
  authorizeRole(['lab_assistant', 'central_store_admin', 'admin']),
  quotationController.getQuotationDetails
);

router.post('/:quotationId/comments', authenticate, quotationController.addQuotationComment);

// Chemical remarks and updates routes
router.patch('/:quotationId/chemicals/remarks', authenticate, quotationController.addChemicalRemarks);
router.patch('/:quotationId/chemicals', authenticate, quotationController.updateQuotationChemicals);
router.patch('/:quotationId/chemicals/batch-remarks', authenticate, quotationController.updateAllChemicalRemarks);

// Comprehensive quotation update route - full editing capabilities
router.put('/:quotationId/complete', authenticate, authorizeRole(['admin', 'central_store_admin']), quotationController.updateCompleteQuotation);

// Admin-only status update route
router.patch('/:quotationId/status', authenticate, authorizeRole(['admin']), quotationController.updateQuotationStatus);

module.exports = router;