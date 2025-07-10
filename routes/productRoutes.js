const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Public routes - No authentication required
router.get('/', productController.getAllProducts);
router.get('/category/:category', productController.getProductsByCategory);
router.get('/search', productController.searchProducts);

// Protected stats route - Admin and Central Lab Admin only
router.get('/stats', authenticate, authorizeRole(['admin', 'central_lab_admin']), productController.getProductStats);

// Test route for admin access
router.get('/admin-test', authenticate, authorizeRole(['admin', 'central_lab_admin']), (req, res) => {
  res.json({
    success: true,
    message: 'Admin access is working properly',
    user: {
      id: req.user._id,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// Protected routes - Admin and Central Lab Admin only
router.post('/', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  productController.createProduct
);

router.post('/bulk', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  productController.createBulkProducts
);

router.put('/:id', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  productController.updateProduct
);

router.delete('/:id', 
  authenticate, 
  authorizeRole(['admin', 'central_lab_admin']), 
  productController.deleteProduct
);

module.exports = router;