const express = require('express');
const router = express.Router();
const experimentController = require('../controllers/experimentController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Get experiments by course
router.get('/course/:courseId', authenticate, experimentController.getExperimentsByCourse);

// Get experiments by subject
router.get('/subject/:subjectId', authenticate, experimentController.getExperimentsBySubject);

// Get experiments by semester
router.get('/semester/:semester', authenticate, experimentController.getExperimentsBySemester);

// Get all experiments
router.get('/', experimentController.getExperiments);

// Get experiment by ID
router.get('/:id', experimentController.getExperimentById);

// Create new experiment (admin only)
router.post('/', authenticate, authorizeRole(['admin', 'central_store_admin']), experimentController.addExperiment);

// Update experiment (admin only)
router.put('/:id', authenticate, authorizeRole(['admin', 'central_store_admin']), experimentController.updateExperiment);

// Delete experiment (admin only)
router.delete('/:id', authenticate, authorizeRole(['admin', 'central_store_admin']), experimentController.deleteExperiment);

module.exports = router; 