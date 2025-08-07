const express = require('express');
const router = express.Router();
const {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject,
  getSubjectsByCourse,
  getSubjectAnalytics
} = require('../controllers/subjectController');

const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// @route   GET /api/subjects/analytics
// @desc    Get subject analytics
// @access  Private (Admin only)
router.get('/analytics', authenticate, authorizeRole(['admin']), getSubjectAnalytics);

// @route   GET /api/subjects/course/:courseId
// @desc    Get subjects by course
// @access  Private
router.get('/course/:courseId', authenticate, getSubjectsByCourse);

// @route   GET /api/subjects
// @desc    Get all subjects with filtering
// @access  Private
router.get('/', authenticate, getSubjects);

// @route   GET /api/subjects/:id
// @desc    Get subject by ID
// @access  Private
router.get('/:id', authenticate, getSubjectById);

// @route   POST /api/subjects
// @desc    Create new subject
// @access  Private (Admin only)
router.post('/', authenticate, authorizeRole(['admin']), createSubject);

// @route   PUT /api/subjects/:id
// @desc    Update subject
// @access  Private (Admin only)
router.put('/:id', authenticate, authorizeRole(['admin']), updateSubject);

// @route   DELETE /api/subjects/:id
// @desc    Delete subject (soft delete)
// @access  Private (Admin only)
router.delete('/:id', authenticate, authorizeRole(['admin']), deleteSubject);

module.exports = router;
