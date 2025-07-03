const express = require('express');
const router = express.Router();
const glasswareTransactionController = require('../controllers/glasswareTransactionController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');
const { 
  validateGlasswareTransaction,
  validateGlasswareAllocation,
  validateGlasswareTransfer,
  validateId,
  validateQueryParams
} = require('../middleware/validators');

// @desc    Create a new glassware transaction
// @route   POST /api/glassware-transactions/create
// @access  Private (Lab Assistant, Central Lab Admin, Admin)
router.post('/create', 
  authenticate, 
  authorizeRoles(['lab_assistant', 'central_lab_admin', 'admin']),
  validateGlasswareTransaction,
  glasswareTransactionController.createTransaction
);

// @desc    Get all glassware transactions
// @route   GET /api/glassware-transactions/all
// @access  Private (Central Lab Admin, Admin)
router.get('/all', 
  authenticate, 
  authorizeRoles(['central_lab_admin', 'admin']),
  validateQueryParams,
  glasswareTransactionController.getAllTransactions
);

// @desc    Get transactions for a specific lab
// @route   GET /api/glassware-transactions/lab/:labId
// @access  Private (Lab Assistant for own lab, Central Lab Admin, Admin)
router.get('/lab/:labId', 
  authenticate, 
  // Custom middleware to check if user can access lab data
  (req, res, next) => {
    const userRole = req.user.role;
    const userLabId = req.user.labId;
    const requestedLabId = req.params.labId;
    
    // Admin and central lab admin can access all labs
    if (['admin', 'central_lab_admin'].includes(userRole)) {
      return next();
    }
    
    // Lab assistant can only access their own lab
    if (userRole === 'lab_assistant' && userLabId === requestedLabId) {
      return next();
    }
    
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only view transactions for your assigned lab.'
    });
  },
  validateQueryParams,
  glasswareTransactionController.getLabTransactions
);

// @desc    Get transaction history for specific glassware
// @route   GET /api/glassware-transactions/glassware/:glasswareId
// @access  Private
router.get('/glassware/:glasswareId', 
  authenticate, 
  validateId,
  glasswareTransactionController.getGlasswareHistory
);

// @desc    Get transaction statistics
// @route   GET /api/glassware-transactions/stats
// @access  Private (Central Lab Admin, Admin)
router.get('/stats', 
  authenticate, 
  authorizeRoles(['central_lab_admin', 'admin']),
  validateQueryParams,
  glasswareTransactionController.getTransactionStats
);

// @desc    Bulk allocation of glassware to labs
// @route   POST /api/glassware-transactions/allocate
// @access  Private (Central Lab Admin, Admin)
router.post('/allocate', 
  authenticate, 
  authorizeRoles(['central_lab_admin', 'admin']),
  validateGlasswareAllocation,
  async (req, res, next) => {
    // Transform bulk allocation into individual transactions
    const { toLabId, glasswareItems, notes } = req.body;
    const userId = req.userId;
    
    try {
      const results = {
        successful: [],
        failed: []
      };
      
      // Process each glassware item
      for (const item of glasswareItems) {
        try {
          // Create individual transaction request
          req.body = {
            glasswareLiveId: item.glasswareLiveId,
            transactionType: 'allocation',
            quantity: item.quantity,
            toLabId: toLabId,
            notes: notes || `Bulk allocation to ${toLabId}`,
            variant: item.variant || 'standard'
          };
          
          // Call the create transaction controller
          await glasswareTransactionController.createTransaction(req, res, () => {});
          
          results.successful.push({
            glasswareLiveId: item.glasswareLiveId,
            quantity: item.quantity
          });
        } catch (error) {
          results.failed.push({
            glasswareLiveId: item.glasswareLiveId,
            quantity: item.quantity,
            error: error.message
          });
        }
      }
      
      res.status(200).json({
        success: true,
        message: `Bulk allocation completed. Successful: ${results.successful.length}, Failed: ${results.failed.length}`,
        results
      });
    } catch (error) {
      next(error);
    }
  }
);

// @desc    Bulk transfer of glassware between labs
// @route   POST /api/glassware-transactions/transfer
// @access  Private (Central Lab Admin, Admin)
router.post('/transfer', 
  authenticate, 
  authorizeRoles(['central_lab_admin', 'admin']),
  validateGlasswareTransfer,
  async (req, res, next) => {
    // Transform bulk transfer into individual transactions
    const { fromLabId, toLabId, glasswareItems, notes } = req.body;
    const userId = req.userId;
    
    try {
      const results = {
        successful: [],
        failed: []
      };
      
      // Process each glassware item
      for (const item of glasswareItems) {
        try {
          // Create individual transaction request
          req.body = {
            glasswareLiveId: item.glasswareLiveId,
            transactionType: 'transfer',
            quantity: item.quantity,
            fromLabId: fromLabId,
            toLabId: toLabId,
            notes: notes || `Bulk transfer from ${fromLabId} to ${toLabId}`,
            variant: item.variant || 'standard'
          };
          
          // Call the create transaction controller
          await glasswareTransactionController.createTransaction(req, res, () => {});
          
          results.successful.push({
            glasswareLiveId: item.glasswareLiveId,
            quantity: item.quantity
          });
        } catch (error) {
          results.failed.push({
            glasswareLiveId: item.glasswareLiveId,
            quantity: item.quantity,
            error: error.message
          });
        }
      }
      
      res.status(200).json({
        success: true,
        message: `Bulk transfer completed. Successful: ${results.successful.length}, Failed: ${results.failed.length}`,
        results
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
