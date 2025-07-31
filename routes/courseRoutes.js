const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const {
  getCourses,
  getActiveCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
  addBatch,
  updateBatch,
  deleteBatch,
  getCourseBatches,
  getCourseStats
} = require('../controllers/courseController');
const authenticate  = require('../middleware/authMiddleware');
const authorizerole = require('../middleware/roleMiddleware');

router.use(authenticate); // Apply authentication middleware to all routes

// Course validation rules
const courseValidation = [
  body('courseName')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Course name must be between 3 and 100 characters'),
  body('courseCode')
    .trim()
    .isLength({ min: 2, max: 20 })
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Course code must contain only uppercase letters and numbers'),
  body('batches')
    .isArray({ min: 1 })
    .withMessage('At least one batch is required'),
  body('batches.*.batchName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Batch name is required and must be less than 50 characters'),
  body('batches.*.batchCode')
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('Batch code is required and must be less than 20 characters'),
  body('batches.*.academicYear')
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('Academic year must be in format YYYY-YY (e.g., 2024-25)'),
  body('batches.*.numberOfStudents')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Number of students must be a positive integer')
];

// Course update validation rules (more flexible)
const courseUpdateValidation = [
  body('courseName')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Course name must be between 3 and 100 characters'),
  body('courseCode')
    .optional()
    .trim()
    .isLength({ min: 2, max: 20 })
    .matches(/^[A-Z0-9]+$/)
    .withMessage('Course code must contain only uppercase letters and numbers'),
  body('batches')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one batch is required'),
  body('batches.*.batchName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Batch name is required and must be less than 50 characters'),
  body('batches.*.batchCode')
    .optional()
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('Batch code is required and must be less than 20 characters'),
  body('batches.*.academicYear')
    .optional()
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('Academic year must be in format YYYY-YY (e.g., 2024-25)'),
  body('batches.*.numberOfStudents')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Number of students must be a positive integer')
];

// Batch validation rules
const batchValidation = [
  body('batchName')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Batch name is required and must be less than 50 characters'),
  body('batchCode')
    .trim()
    .isLength({ min: 1, max: 20 })
    .withMessage('Batch code is required and must be less than 20 characters'),
  body('academicYear')
    .matches(/^\d{4}-\d{2}$/)
    .withMessage('Academic year must be in format YYYY-YY (e.g., 2024-25)'),
  body('numberOfStudents')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Number of students must be a positive integer')
];



// Course routes
router.route('/')
  .get(getCourses)
  .post(authorizerole('admin', 'central_lab_admin'), courseValidation, createCourse);

router.route('/active')
  .get(getActiveCourses);

router.route('/stats')
  .get(authorizerole('admin', 'central_lab_admin'), getCourseStats);

router.route('/:id')
  .get(getCourseById)
  .put(authorizerole('admin', 'central_lab_admin'), courseUpdateValidation, updateCourse)
  .delete(authorizerole('admin', 'central_lab_admin'), deleteCourse);

// Batch routes within courses
router.route('/:courseId/batches')
  .get(getCourseBatches)
  .post(authorizerole('admin', 'central_lab_admin'), batchValidation, addBatch);

router.route('/:courseId/batches/:batchId')
  .put(authorizerole('admin', 'central_lab_admin'), updateBatch)
  .delete(authorizerole('admin', 'central_lab_admin'), deleteBatch);

module.exports = router;
