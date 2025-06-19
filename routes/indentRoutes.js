const express = require('express');
const router = express.Router();
const indentController = require('../controllers/indentController');
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
    check('chemicals', 'At least one chemical is required').isArray({ min: 1 }),
    check('chemicals.*.chemicalName', 'Chemical name is required').not().isEmpty(),
    check('chemicals.*.quantity', 'Valid quantity is required').isNumeric().toFloat(),
    check('chemicals.*.unit', 'Unit is required').not().isEmpty()
  ],
  indentController.createLabIndent
);

router.get(
  '/lab',
  authenticate,
  authorizeRole('lab_assistant'),
  indentController.getLabAssistantIndents
);

// CENTRAL LAB ADMIN ROUTES
router.post(
  '/central/draft',
  authenticate,
  authorizeRole('central_lab_admin'),
  [
    check('vendorName', 'Vendor name is required').not().isEmpty(),
    check('chemicals', 'At least one chemical is required').isArray({ min: 1 }),
    check('chemicals.*.chemicalName', 'Chemical name is required').not().isEmpty(),
    check('chemicals.*.quantity', 'Valid quantity is required').isNumeric().toFloat(),
    check('chemicals.*.unit', 'Unit is required').not().isEmpty(),
    check('chemicals.*.pricePerUnit', 'Price per unit is required').isNumeric().toFloat(),
    check('totalPrice', 'Total price is required').isNumeric().toFloat()
  ],
  indentController.createDraftIndent
);

router.get(
  '/central',
  authenticate,
  authorizeRole('central_lab_admin'),
  indentController.getCentralAdminIndents
);

// ADMIN ROUTES
router.get(
  '/admin',
  authenticate,
  authorizeRole('admin'),
  indentController.getAdminIndents
);

// INDENT DETAILS ROUTE
router.get(
  '/:id',
  authenticate,
  authorizeRole(['lab_assistant', 'central_lab_admin', 'admin']),
  indentController.getIndentDetails
);

// Add comment to indent
router.post('/:indentId/comments', authenticate, indentController.addIndentComment);
// Add chemical remarks
router.patch('/:indentId/chemicals/remarks', indentController.addChemicalRemarks);
// Update chemicals
router.patch('/:indentId/chemicals', indentController.updateIndentChemicals);
// Batch update remarks
router.patch('/:indentId/chemicals/batch-remarks', indentController.updateAllChemicalRemarks);

// Add chemical to draft
router.post(
  '/central/draft/add-chemical',
  authenticate,
  authorizeRole('central_lab_admin'),
  [
    check('indentId', 'Indent ID is required').not().isEmpty(),
    check('chemicals', 'At least one chemical is required').isArray({ min: 1 }),
    check('chemicals.*.chemicalName', 'Chemical name is required').not().isEmpty(),
    check('chemicals.*.quantity', 'Valid quantity is required').isNumeric().toFloat(),
    check('chemicals.*.unit', 'Unit is required').not().isEmpty(),
    check('chemicals.*.pricePerUnit', 'Price per unit is required').isNumeric().toFloat()
  ],
  indentController.addChemicalToDraft
);

// Submit draft
router.patch(
  '/central/draft/submit',
  authenticate,
  authorizeRole('central_lab_admin'),
  [
    check('indentId', 'Indent ID is required').not().isEmpty()
  ],
  indentController.submitDraftToPending
);

// Allocate lab indent
router.patch(
  '/central/allocate',
  authenticate,
  authorizeRole('central_lab_admin'),
  [
    check('indentId', 'Indent ID is required').not().isEmpty(),
    check('status', 'Valid status is required').isIn(['allocated', 'partially_fulfilled', 'rejected']),
  ],
  indentController.allocateLabIndent
);

// Admin process
router.patch(
  '/admin/process',
  authenticate,
  authorizeRole('admin'),
  [
    check('status', 'Valid status is required').isIn(['approved', 'rejected', 'purchasing', 'purchased']),
    check('comments', 'Comments are required').optional().isString()
  ],
  indentController.processCentralIndent
);

module.exports = router;
