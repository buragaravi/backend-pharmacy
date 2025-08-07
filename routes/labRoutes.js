const express = require('express');
const {
  getLabs,
  getLab,
  createLab,
  updateLab,
  deleteLab,
  bulkSync,
  consistencyCheck,
  getLabStats,
  getAssignableLabs
} = require('../controllers/labController');

const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');
const { body, param } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validators');

const router = express.Router();

// Validation rules
const labIdValidation = [
  body('labId')
    .trim()
    .isLength({ min: 3, max: 20 })
    .matches(/^[A-Za-z0-9_-]+$/)
    .withMessage('Lab ID must be 3-20 alphanumeric characters')
    .custom((value) => {
      if (value === 'central-store') {
        throw new Error('central-store is reserved and cannot be used');
      }
      return true;
    })
];

const labNameValidation = [
  body('labName')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Lab name must be 2-100 characters')
];

const labDescriptionValidation = [
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters')
];

// @desc    Get all labs
// @route   GET /api/labs
// @access  Private
router.get('/', authenticate, getLabs);

// @desc    Get assignable labs (excludes central-store)
// @route   GET /api/labs/assignable
// @access  Private (Admin only)
router.get('/assignable', 
  authenticate, 
  authorizeRole(['admin']), 
  getAssignableLabs
);

// @desc    Get lab statistics
// @route   GET /api/labs/stats
// @access  Private (Admin only)
router.get('/stats', 
  authenticate, 
  authorizeRole(['admin']), 
  getLabStats
);

// @desc    Bulk sync all labs
// @route   POST /api/labs/bulk-sync
// @access  Private (Admin only)
router.post('/bulk-sync', 
  authenticate, 
  authorizeRole(['admin']), 
  bulkSync
);

// @desc    Check lab consistency
// @route   GET /api/labs/consistency-check
// @access  Private (Admin only)
router.get('/consistency-check', 
  authenticate, 
  authorizeRole(['admin']), 
  consistencyCheck
);

// @desc    Get single lab
// @route   GET /api/labs/:labId
// @access  Private
router.get('/:labId', 
  authenticate,
  param('labId').trim().notEmpty().withMessage('Lab ID is required'),
  handleValidationErrors,
  getLab
);

// @desc    Create new lab
// @route   POST /api/labs
// @access  Private (Admin only)
router.post('/',
  authenticate,
  authorizeRole(['admin']),
  [
    ...labIdValidation,
    ...labNameValidation,
    ...labDescriptionValidation
  ],
  handleValidationErrors,
  createLab
);

// @desc    Update lab
// @route   PUT /api/labs/:labId
// @access  Private (Admin only)
router.put('/:labId',
  authenticate,
  authorizeRole(['admin']),
  [
    param('labId').trim().notEmpty().withMessage('Lab ID is required'),
    body('labName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Lab name must be 2-100 characters'),
    ...labDescriptionValidation,
    body('isActive')
      .optional()
      .isBoolean()
      .withMessage('isActive must be boolean')
  ],
  handleValidationErrors,
  updateLab
);

// @desc    Delete lab
// @route   DELETE /api/labs/:labId
// @access  Private (Admin only)
router.delete('/:labId',
  authenticate,
  authorizeRole(['admin']),
  param('labId').trim().notEmpty().withMessage('Lab ID is required'),
  handleValidationErrors,
  deleteLab
);

module.exports = router;
