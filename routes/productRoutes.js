const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

// Public routes
router.get('/', productController.getAllProducts);
router.get('/category/:category', productController.getProductsByCategory);

// Protected routes (add authentication middleware as needed)
router.post('/', productController.createProduct);
router.put('/:id', productController.updateProduct);
router.delete('/:id', productController.deleteProduct);
// In routes
router.get('/search', productController.searchProducts);

module.exports = router;