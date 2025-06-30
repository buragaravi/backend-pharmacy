const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');

// Public routes
router.get('/', productController.getAllProducts);
router.get('/category/:category', productController.getProductsByCategory);

// Protected routes (add authentication middleware as needed)
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

// In routes
router.get('/search', productController.searchProducts);

router.get('/stats', productController.getProductStats);

module.exports = router;