const express = require('express');
const router = express.Router();
const {
  createRequirement,
  getRequirements,
  getRequirementById,
  updateRequirementStatus,
  addComment,
  getRequirementStats,
  convertToQuotation
} = require('../controllers/requirementControllerNew');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// Apply authentication to all routes
router.use(authMiddleware);

// @route   POST /api/requirements
// @desc    Create a new requirement
// @access  Private (Faculty, Lab Assistant)
router.post('/', 
  roleMiddleware(['faculty', 'lab_assistant']),
  createRequirement
);

// @route   GET /api/requirements
// @desc    Get requirements (role-based filtering)
// @access  Private
router.get('/', getRequirements);

// @route   GET /api/requirements/stats
// @desc    Get requirement statistics
// @access  Private
router.get('/stats', getRequirementStats);

// @route   GET /api/requirements/:id
// @desc    Get specific requirement by ID
// @access  Private
router.get('/:id', getRequirementById);

// @route   PUT /api/requirements/:id/status
// @desc    Update requirement status (approve/reject)
// @access  Private (Admin, Central Store Admin only)
router.put('/:id/status',
  roleMiddleware(['admin', 'central_store_admin']),
  updateRequirementStatus
);

// @route   POST /api/requirements/:id/comment
// @desc    Add comment to requirement
// @access  Private
router.post('/:id/comment', addComment);

// @route   POST /api/requirements/:id/convert-to-quotation
// @desc    Manually convert requirement to quotation
// @access  Private (Admin, Central Store Admin only)
router.post('/:id/convert-to-quotation',
  roleMiddleware(['admin', 'central_store_admin']),
  convertToQuotation
);

module.exports = router;
