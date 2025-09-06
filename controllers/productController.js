const Product = require('../models/Product');
const asyncHandler = require('express-async-handler');
const ChemicalLive = require('../models/ChemicalLive');
const EquipmentLive = require('../models/EquipmentLive');
const GlasswareLive = require('../models/GlasswareLive');
const OtherProductLive = require('../models/OtherProductLive');

/**
 * Properly capitalize product name (first letter uppercase, rest lowercase)
 */
const capitalizeProductName = (name) => {
  if (!name || typeof name !== 'string') return name;
  return name.trim().toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
};

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

  // Properly capitalize the product name
  const capitalizedName = capitalizeProductName(name);
  const categoryLower = category.toLowerCase();

  // Check if product already exists with same name (case-insensitive), category, and category-specific identifier
  let duplicateCheckQuery = { 
    name: { $regex: new RegExp(`^${capitalizedName}$`, 'i') }, // Case-insensitive exact match
    category: categoryLower
  };
  
  if (categoryLower === 'chemical') {
    duplicateCheckQuery.unit = unit || '';
  } else {
    duplicateCheckQuery.variant = variant || '';
  }
  
  const existingProduct = await Product.findOne(duplicateCheckQuery);
  if (existingProduct) {
    return res.status(400).json({
      success: false,
      message: `Product with this name, category, and ${categoryLower === 'chemical' ? 'unit' : 'variant'} already exists`
    });
  }

  // Validation: unit required for chemical, variant required for others
  if (categoryLower === 'chemical' && (!unit || unit.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'Unit is required for chemical products'
    });
  }
  if (categoryLower !== 'chemical' && (!variant || variant.trim() === '')) {
    return res.status(400).json({
      success: false,
      message: 'Variant is required for non-chemical products'
    });
  }

  const product = await Product.create({
    name: capitalizedName, // Store with proper capitalization
    unit: categoryLower === 'chemical' ? unit : '',
    thresholdValue,
    category: categoryLower,
    subCategory: subCategory || '',
    variant: categoryLower !== 'chemical' ? variant : ''
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

      // Properly capitalize the product name
      const capitalizedName = capitalizeProductName(productData.name);

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

      // Check if product already exists with same name (case-insensitive), category, and category-specific identifier
      let duplicateCheckQuery = { 
        name: { $regex: new RegExp(`^${capitalizedName}$`, 'i') }, // Case-insensitive exact match
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
        name: capitalizedName, // Store with proper capitalization
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
  const newName = name ? capitalizeProductName(name) : product.name;
  
  let duplicateCheckQuery = { 
    name: { $regex: new RegExp(`^${newName}$`, 'i') }, // Case-insensitive exact match
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
  product.name = newName; // Store with proper capitalization
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
    name: { $regex: q, $options: 'i' } // Case-insensitive search
  });
  res.status(200).json({ success: true, data: products });
});

// @desc    Get product inventory details
// @route   GET /api/products/:id/inventory
// @access  Public
const getProductInventoryDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get the product details first
  const product = await Product.findById(id);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: 'Product not found'
    });
  }

  let inventoryData = {};
  let totalStock = 0;
  const labDistribution = {};
  let batchDetails = [];

  try {
    switch (product.category.toLowerCase()) {
      case 'chemical':
        // Get chemical inventory with batch details
        const chemicalInventory = await ChemicalLive.find({ 
          chemicalName: { $regex: product.name, $options: 'i' }
        }).populate('chemicalMasterId');
        
        chemicalInventory.forEach(item => {
          totalStock += item.quantity;
          
          // Lab distribution
          if (labDistribution[item.labId]) {
            labDistribution[item.labId].quantity += item.quantity;
            labDistribution[item.labId].batches += 1;
          } else {
            labDistribution[item.labId] = {
              quantity: item.quantity,
              batches: 1
            };
          }
          
          // Batch details for chemicals
          batchDetails.push({
            batchId: item.chemicalMasterId?.batchId || 'N/A',
            quantity: item.quantity,
            unit: item.unit,
            labId: item.labId,
            expiryDate: item.expiryDate,
            isAllocated: item.isAllocated,
            createdAt: item.createdAt
          });
        });
        break;

      case 'equipment':
        const equipmentInventory = await EquipmentLive.find({ productId: id });
        
        equipmentInventory.forEach(item => {
          totalStock += 1; // Equipment is counted as individual items
          
          // Lab distribution for equipment
          if (labDistribution[item.labId]) {
            labDistribution[item.labId].quantity += 1;
            labDistribution[item.labId].items += 1;
          } else {
            labDistribution[item.labId] = {
              quantity: 1,
              items: 1
            };
          }
          
          // Equipment details (warranty info instead of batch)
          batchDetails.push({
            itemId: item.itemId,
            name: item.name,
            variant: item.variant,
            labId: item.labId,
            status: item.status,
            warranty: item.warranty,
            location: item.location,
            assignedTo: item.assignedTo,
            createdAt: item.createdAt
          });
        });
        break;

      case 'glassware':
        const glasswareInventory = await GlasswareLive.find({ productId: id });
        
        glasswareInventory.forEach(item => {
          totalStock += item.quantity;
          
          // Lab distribution
          if (labDistribution[item.labId]) {
            labDistribution[item.labId].quantity += item.quantity;
          } else {
            labDistribution[item.labId] = {
              quantity: item.quantity
            };
          }
          
          // Glassware details
          batchDetails.push({
            batchId: item.batchId || 'N/A',
            quantity: item.quantity,
            unit: item.unit,
            labId: item.labId,
            condition: item.condition,
            warranty: item.warranty,
            createdAt: item.createdAt
          });
        });
        break;

      case 'others':
        const otherInventory = await OtherProductLive.find({ productId: id });
        
        otherInventory.forEach(item => {
          totalStock += item.quantity;
          
          // Lab distribution  
          if (labDistribution[item.labId]) {
            labDistribution[item.labId].quantity += item.quantity;
          } else {
            labDistribution[item.labId] = {
              quantity: item.quantity
            };
          }
          
          // Other product details
          batchDetails.push({
            batchId: item.batchId || 'N/A',
            quantity: item.quantity,
            unit: item.unit,
            labId: item.labId,
            vendor: item.vendor,
            expiryDate: item.expiryDate,
            createdAt: item.createdAt
          });
        });
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid product category'
        });
    }

    // Calculate unique batches for chemicals, total items for others
    let activeBatches;
    if (product.category.toLowerCase() === 'chemical') {
      // For chemicals, count unique batch IDs
      const uniqueBatches = new Set(batchDetails.map(item => item.batchId).filter(id => id !== 'N/A'));
      activeBatches = uniqueBatches.size;
    } else {
      // For equipment/glassware/others, count total items/entries
      activeBatches = batchDetails.length;
    }

    inventoryData = {
      product: {
        id: product._id,
        name: product.name,
        category: product.category,
        variant: product.variant,
        unit: product.unit,
        thresholdValue: product.thresholdValue
      },
      summary: {
        totalStock,
        activeBatches,
        labsCount: Object.keys(labDistribution).length,
        belowThreshold: totalStock < product.thresholdValue
      },
      labDistribution,
      batchDetails: batchDetails.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    };

    res.status(200).json({
      success: true,
      data: inventoryData
    });

  } catch (error) {
    console.error('Error fetching inventory details:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching inventory details',
      error: error.message
    });
  }
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
  getProductStats,
  getProductInventoryDetails
};