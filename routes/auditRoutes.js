const express = require('express');
const router = express.Router();
const {
  createAuditAssignment,
  getAuditAssignments,
  getAuditAssignment,
  startAuditExecution,
  startAuditAssignment,
  updateChecklistItem,
  completeAuditExecution,
  getAuditDashboard,
  getAuditAnalytics,
  getFacultyAuditAssignments,
  getFacultyAuditStats,
  getExecutionByAssignment
} = require('../controllers/auditController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Dashboard route
router.get('/dashboard', 
  authenticate, 
  authorizeRole(['admin', 'faculty']), 
  getAuditDashboard
);

// Analytics route
router.get('/analytics', 
  authenticate, 
  authorizeRole(['admin', 'faculty']), 
  getAuditAnalytics
);

// Assignment routes
router.route('/assignments')
  .get(authenticate, authorizeRole(['admin', 'faculty']), getAuditAssignments)
  .post(authenticate, authorizeRole(['admin']), createAuditAssignment);

router.route('/assignments/:id')
  .get(authenticate, authorizeRole(['admin', 'faculty']), getAuditAssignment);

// Execution routes
router.post('/assignments/:id/start', 
  authenticate, 
  authorizeRole(['faculty']), 
  startAuditExecution
);

router.put('/executions/:id/items/:itemId', 
  authenticate, 
  authorizeRole(['faculty']), 
  updateChecklistItem
);

router.post('/executions/:id/complete', 
  authenticate, 
  authorizeRole(['faculty']), 
  completeAuditExecution
);

// Get execution by assignment ID
router.get('/executions/assignment/:assignmentId',
  authenticate,
  authorizeRole(['admin', 'faculty']),
  getExecutionByAssignment
);

// Faculty-specific routes
router.get('/assignments/faculty/:facultyId', 
  authenticate, 
  authorizeRole(['faculty']), 
  getFacultyAuditAssignments
);

router.get('/faculty-stats/:facultyId', 
  authenticate, 
  authorizeRole(['faculty']), 
  getFacultyAuditStats
);

// Start audit assignment (change status from pending to in_progress)
router.patch('/assignments/:id/start', 
  authenticate, 
  authorizeRole(['faculty']), 
  startAuditAssignment
);

module.exports = router;
