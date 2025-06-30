const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');
const ChemicalLive = require('../models/ChemicalLive');
const EquipmentLive = require('../models/EquipmentLive');
const GlasswareLive = require('../models/GlasswareLive');
const OtherProductLive = require('../models/OtherProductLive');

// @desc    Get all products
// @route   GET /api/products
// @access  Public
const getAllProducts = asyncHandler(async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.status(200).json({
    success: true,
    count: products.length,
    data: products
  });
});

// @desc    Get products by category
// @route   GET /api/products/category/:category
// @access  Public
const getProductsByCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;
  
  // Validate category
  const validCategories = ['chemical', 'glassware', 'equipment','others'];
  if (!validCategories.includes(category.toLowerCase())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid category. Must be chemical, glassware, or others'
    });
  }

  const products = await Product.find({ category: category.toLowerCase() }).sort({ name: 1 });
  
  if (products.length === 0) {
    return res.status(404).json({
      success: false,
      message: `No products found in the ${category} category`
    });
  }

  res.status(200).json({
    success: true,
    count: products.length,
    data: products
  });
});

// @desc    Create a new product
// @route   POST /api/products
// @access  Private (add your auth middleware as needed)
const createProduct = asyncHandler(async (req, res) => {
  const { name, unit, thresholdValue, category, subCategory, variant } = req.body;

  // Check if product already exists with same name, category, and category-specific identifier
  let duplicateCheckQuery = { 
    name,
    category: category.toLowerCase()
  };
  
  if (category === 'chemical') {
    duplicateCheckQuery.unit = unit || '';
  } else {
    duplicateCheckQuery.variant = variant || '';
  }
  
  const existingProduct = await Product.findOne(duplicateCheckQuery);
  if (existingProduct) {
    return res.status(400).json({
      success: false,
      message: `Product with this name, category, and ${category === 'chemical' ? 'unit' : 'variant'} already exists`
    });
  }

  // Validation: unit required for chemical, variant required for others
  if (category === 'chemical' && (!unit || unit.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'Unit is required for chemical products'
    });
  }
  if (category !== 'chemical' && (!variant || variant.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'Variant is required for non-chemical products'
    });
  }

  const product = await Product.create({
    name,
    unit: category === 'chemical' ? unit : '',
    thresholdValue,
    category: category.toLowerCase(),
    subCategory: subCategory || '',
    variant: category !== 'chemical' ? variant : ''
  });

  res.status(201).json({
    success: true,
    data: product
  });
});

// @desc    Create multiple products (bulk upload)
// @route   POST /api/products/bulk
// @access  Private
const createBulkProducts = asyncHandler(async (req, res) => {
  const { products } = req.body;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Products array is required and must not be empty'
    });
  }

  const validCategories = ['chemical', 'glassware', 'equipment', 'others'];
  const results = {
    created: [],
    errors: [],
    skipped: []
  };

  for (let i = 0; i < products.length; i++) {
    const productData = products[i];
    
    try {
      // Validate required fields
      if (!productData.name || productData.name.trim() === '') {
        results.errors.push({
          index: i,
          error: 'Product name is required'
        });
        continue;
      }

      // Validate and set category first
      let category = 'chemical'; // default
      if (productData.category) {
        const categoryLower = productData.category.toLowerCase();
        if (validCategories.includes(categoryLower)) {
          category = categoryLower;
        }
      }

      // Validate unit for chemical products
      if (category === 'chemical' && (!productData.unit || productData.unit.trim() === '')) {
        results.errors.push({
          index: i,
          product: productData,
          error: 'Unit is required for chemical products'
        });
        continue;
      }

      // Validate variant for non-chemical products
      if (category !== 'chemical' && (!productData.variant || productData.variant.trim() === '')) {
        results.errors.push({
          index: i,
          product: productData,
          error: 'Variant is required for non-chemical products'
        });
        continue;
      }

      // Check if product already exists with same name, category, and category-specific identifier
      let duplicateCheckQuery = { 
        name: productData.name.trim(),
        category: category
      };
      
      // Add category-specific fields to duplicate check
      if (category === 'chemical') {
        duplicateCheckQuery.unit = productData.unit ? productData.unit.trim() : '';
      } else {
        duplicateCheckQuery.variant = productData.variant ? productData.variant.trim() : '';
      }
      
      const existingProduct = await Product.findOne(duplicateCheckQuery);
      if (existingProduct) {
        results.skipped.push({
          index: i,
          product: productData,
          reason: `Product already exists with same name, category, and ${category === 'chemical' ? 'unit' : 'variant'}`
        });
        continue;
      }

      // Set threshold value (default to 0 if not provided)
      const thresholdValue = productData.thresholdValue !== undefined ? Number(productData.thresholdValue) : 0;

      // Create the product
      const product = await Product.create({
        name: productData.name.trim(),
        unit: category === 'chemical' ? productData.unit.trim() : '',
        thresholdValue,
        category,
        subCategory: productData.subCategory || '',
        variant: category !== 'chemical' ? productData.variant.trim() : ''
      });

      results.created.push({
        index: i,
        product: product
      });

    } catch (error) {
      results.errors.push({
        index: i,
        product: productData,
        error: error.message
      });
    }
  }

  res.status(200).json({
    success: true,
    message: `Bulk upload completed. Created: ${results.created.length}, Errors: ${results.errors.length}, Skipped: ${results.skipped.length}`,
    results
  });
});

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private (add your auth middleware as needed)
const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, unit, thresholdValue, category, subCategory, variant } = req.body;

  // Check if product exists
  let product = await Product.findById(id);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  // Check if name/category/unit/variant combination is being changed to one that already exists
  const productCategory = category ? category.toLowerCase() : product.category;
  let duplicateCheckQuery = { 
    name: name || product.name,
    category: productCategory,
    _id: { $ne: id } // Exclude current product from check
  };
  
  if (productCategory === 'chemical') {
    duplicateCheckQuery.unit = (unit !== undefined ? unit : product.unit) || '';
  } else {
    duplicateCheckQuery.variant = (variant !== undefined ? variant : product.variant) || '';
  }
  
  const existingProduct = await Product.findOne(duplicateCheckQuery);
  if (existingProduct) {
    return res.status(400).json({
      success: false,
      message: `Another product with this name, category, and ${productCategory === 'chemical' ? 'unit' : 'variant'} already exists`
    });
  }

  // Validation: unit required for chemical, variant required for others
  if ((category || product.category) === 'chemical' && (!unit || unit.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'Unit is required for chemical products'
    });
  }
  if ((category || product.category) !== 'chemical' && (!variant || variant.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'Variant is required for non-chemical products'
    });
  }

  // Update product
  product.name = name || product.name;
  product.unit = (category || product.category) === 'chemical' ? unit : '';
  product.thresholdValue = thresholdValue || product.thresholdValue;
  product.category = category ? category.toLowerCase() : product.category;
  product.subCategory = typeof subCategory !== 'undefined' ? subCategory : product.subCategory;
  product.variant = (category || product.category) !== 'chemical' ? variant : '';

  await product.save();

  res.status(200).json({
    success: true,
    data: product
  });
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private (add your auth middleware as needed)
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const product = await Product.findByIdAndDelete(id);
  
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  res.status(200).json({
    success: true,
    message: 'Product deleted successfully'
  });
});

// In controller
const searchProducts = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const products = await Product.find({ 
    name: { $regex: q, $options: 'i' } 
  });
  res.status(200).json({ success: true, data: products });
});

// @desc    Get product stats (counts by category)
// @route   GET /api/products/stats
// @access  Public
const getProductStats = asyncHandler(async (req, res) => {
  const [chemical, equipment, glassware, others] = await Promise.all([
    ChemicalLive.countDocuments(),
    EquipmentLive.countDocuments(),
    GlasswareLive.countDocuments(),
    OtherProductLive.countDocuments()
  ]);
  const total = chemical + equipment + glassware + others;
  res.status(200).json({ total, chemical, equipment, glassware, others });
});

module.exports = {
  getAllProducts,
  getProductsByCategory,
  createProduct,
  createBulkProducts,
  updateProduct,
  deleteProduct,
  searchProducts,
  getProductStats
};