const { body, param, query, validationResult } = require('express-validator');
const { isValidObjectId } = require('mongoose');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Chemical request validation
const validateChemicalRequest = [
  body('labId').isString().notEmpty(),
  body('experiments').isArray().notEmpty(),
  body('experiments.*.experimentName').isString().notEmpty(),
  body('experiments.*.date').isISO8601(),
  body('experiments.*.session').isString().notEmpty(),
  body('experiments.*.chemicals').isArray().notEmpty(),
  body('experiments.*.chemicals.*.chemicalName').isString().notEmpty(),
  body('experiments.*.chemicals.*.quantity').isFloat({ min: 0 }),
  body('experiments.*.chemicals.*.unit').isString().notEmpty(),
  validate
];

// Unified request validation (chemicals, equipment, glassware)
const validateUnifiedRequest = [
  body('labId').isString().notEmpty(),
  body('experiments').isArray().notEmpty(),
  body('experiments.*.experimentName').isString().notEmpty(),
  body('experiments.*.courseId').isString().notEmpty(),
  body('experiments.*.batchId').isString().notEmpty(),
  body('experiments.*.date').isISO8601(),
  // Chemicals
  body('experiments.*.chemicals').optional().isArray(),
  body('experiments.*.chemicals.*.chemicalName').optional().isString().notEmpty(),
  body('experiments.*.chemicals.*.quantity').optional().isFloat({ min: 0 }),
  body('experiments.*.chemicals.*.unit').optional().isString().notEmpty(),
  // Equipment
  body('experiments.*.equipment').optional().isArray(),
  body('experiments.*.equipment.*.itemId').optional().isString().notEmpty(),
  body('experiments.*.equipment.*.productId').optional().isString().notEmpty(),
  body('experiments.*.equipment.*.name').optional().isString().notEmpty(),
  // Glassware
  body('experiments.*.glassware').optional().isArray(),
  body('experiments.*.glassware.*.glasswareId').optional().isString().notEmpty(),
  body('experiments.*.glassware.*.name').optional().isString().notEmpty(),
  body('experiments.*.glassware.*.quantity').optional().isFloat({ min: 0 }),
  validate
];

// Chemical allocation validation
const validateChemicalAllocation = [
  body('labId').isString().notEmpty(),
  body('allocations').isArray().notEmpty(),
  body('allocations.*.chemicalName').isString().notEmpty(),
  body('allocations.*.quantity').isFloat({ min: 0 }),
  validate
];

// Quotation validation
const validateQuotation = [
  body('chemicals').isArray().notEmpty(),
  body('chemicals.*.chemicalName').isString().notEmpty(),
  body('chemicals.*.quantity').isFloat({ min: 0 }),
  body('chemicals.*.unit').isString().notEmpty(),
  body('chemicals.*.pricePerUnit').isFloat({ min: 0 }),
  validate
];

// ID parameter validation
const validateId = [
  param('id').custom(value => {
    if (!isValidObjectId(value)) {
      throw new Error('Invalid ID format');
    }
    return true;
  }),
  validate
];

// Query parameter validation
const validateQueryParams = [
  query('timeRange').optional().isIn(['last7Days', 'last30Days', 'last90Days', 'thisYear']),
  query('labId').optional().isString(),
  query('chemicalId').optional().custom(value => {
    if (!isValidObjectId(value)) {
      throw new Error('Invalid chemical ID format');
    }
    return true;
  }),
  validate
];

// User management validation
const validateUserUpdate = [
  body('name').optional().isString().trim().notEmpty(),
  body('email').optional().isEmail(),
  body('role').optional().isIn(['faculty', 'lab_assistant', 'central_store_admin', 'admin']),
  body('labId').optional().isString(),
  validate
];

// Password reset validation
const validatePasswordReset = [
  body('currentPassword').isString().notEmpty(),
  body('newPassword')
    .isString()
    .isLength({ min: 8 })
    .matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/)
    .withMessage('Password must be at least 8 characters long and contain letters, numbers, and special characters'),
  validate
];

// Glassware transaction validation
const validateGlasswareTransaction = [
  body('glasswareLiveId').isString().notEmpty().withMessage('Glassware Live ID is required'),
  body('transactionType').isIn(['entry', 'issue', 'allocation', 'transfer', 'return', 'broken', 'maintenance']).withMessage('Invalid transaction type'),
  body('quantity').isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),
  body('variant').isString().notEmpty().withMessage('Variant is required'),
  body('fromLabId').optional().isIn(['LAB01', 'LAB02', 'LAB03', 'LAB04', 'LAB05', 'LAB06', 'LAB07', 'LAB08', 'central-store']).withMessage('Invalid from lab ID'),
  body('toLabId').optional().isIn(['LAB01', 'LAB02', 'LAB03', 'LAB04', 'LAB05', 'LAB06', 'LAB07', 'LAB08', 'central-store']).withMessage('Invalid to lab ID'),
  body('condition').optional().isIn(['good', 'damaged', 'broken', 'under_maintenance']).withMessage('Invalid condition'),
  body('reason').optional().isString(),
  body('notes').optional().isString(),
  validate
];

// Glassware allocation validation
const validateGlasswareAllocation = [
  body('toLabId').isString().notEmpty().withMessage('To Lab ID is required for allocation'),
  body('glasswareItems').isArray().notEmpty().withMessage('Glassware items array is required'),
  body('glasswareItems.*.glasswareLiveId').isString().notEmpty().withMessage('Glassware Live ID is required'),
  body('glasswareItems.*.quantity').isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),
  validate
];

// Glassware transfer validation
const validateGlasswareTransfer = [
  body('fromLabId').isString().notEmpty().withMessage('From Lab ID is required for transfer'),
  body('toLabId').isString().notEmpty().withMessage('To Lab ID is required for transfer'),
  body('glasswareItems').isArray().notEmpty().withMessage('Glassware items array is required'),
  body('glasswareItems.*.glasswareLiveId').isString().notEmpty().withMessage('Glassware Live ID is required'),
  body('glasswareItems.*.quantity').isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),
  validate
];

// Glassware condition update validation
const validateGlasswareCondition = [
  body('condition').isIn(['good', 'damaged', 'broken', 'under_maintenance']).withMessage('Invalid condition'),
  body('reason').isString().notEmpty().withMessage('Reason is required for condition change'),
  body('quantity').optional().isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),
  validate
];

// Admin approval validation
const validateAdminApproval = [
  body('action').isIn(['approve', 'reject']).withMessage('Action must be either "approve" or "reject"'),
  body('reason').optional().isString().withMessage('Reason must be a string if provided'),
  validate
];

module.exports = {
  validateChemicalRequest,
  validateUnifiedRequest,
  validateChemicalAllocation,
  validateQuotation,
  validateId,
  validateQueryParams,
  validateUserUpdate,
  validatePasswordReset,
  validateGlasswareTransaction,
  validateGlasswareAllocation,
  validateGlasswareTransfer,
  validateGlasswareCondition,
  validateAdminApproval
};