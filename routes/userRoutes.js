const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authenticate = require("../middleware/authMiddleware");
const authorizeRole = require('../middleware/roleMiddleware');

// All routes are protected and require admin role
router.use(authenticate);

// Get all users
router.get('/', userController.getAllUsers);

// Get all lab assistants with their assignments
router.get('/lab-assistants/all', userController.getAllLabAssistants);

// Get user by ID
router.get('/:id', userController.getUserById);

// Update user
router.put('/:id', userController.updateUser);

// Reset user password
router.post('/:id/reset-password', userController.resetPassword);

// Delete user
router.delete('/:id', userController.deleteUser);

// Lab Assignment Routes
// Get user's lab assignments
router.get('/:userId/lab-assignments', userController.getUserLabAssignments);

// Add lab assignment to user
router.post('/:userId/lab-assignments', userController.addLabAssignment);

// Update lab assignment
router.put('/:userId/lab-assignments/:labId', userController.updateLabAssignment);

// Remove lab assignment
router.delete('/:userId/lab-assignments/:labId', userController.removeLabAssignment);

module.exports = router; 