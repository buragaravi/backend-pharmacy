// Route for chemical-product sync operations
const express = require('express');
const router = express.Router();
const { bulkSyncProducts } = require('../middleware/productSyncMiddleware');
const { migrateExistingChemicals } = require('../utils/chemicalProductIntegration');
const authenticate = require('../middleware/authMiddleware');
const authorizeRole = require('../middleware/roleMiddleware');
const asyncHandler = require('express-async-handler');

// @desc    Migrate existing chemicals to use Product references
// @route   POST /api/sync/migrate-chemicals
// @access  Private (Admin only)
router.post('/migrate-chemicals', 
  authenticate, 
  authorizeRole(['admin']), 
  asyncHandler(async (req, res) => {
    try {
      console.log(`🔄 Manual migration triggered by user: ${req.user.email}`);
      
      const result = await migrateExistingChemicals();
      
      res.status(200).json({
        success: true,
        message: 'Chemical migration completed',
        data: {
          total: result.total,
          migrated: result.migrated,
          errors: result.errors
        }
      });
      
    } catch (error) {
      console.error('❌ Migration API error:', error);
      res.status(500).json({
        success: false,
        message: 'Migration failed',
        error: error.message
      });
    }
  })
);

// @desc    Sync all products with their respective live inventory models
// @route   POST /api/sync/sync-products
// @access  Private (Admin only)
router.post('/sync-products', 
  authenticate, 
  authorizeRole(['admin']), 
  asyncHandler(async (req, res) => {
    try {
      const { productIds, categories } = req.body; // Optional: specific product IDs and categories to sync
      
      console.log(`🔄 Product sync triggered by user: ${req.user.email}`);
      
      const result = await bulkSyncProducts(
        productIds || [], 
        categories || ['chemical', 'equipment', 'glassware', 'others']
      );
      
      res.status(200).json({
        success: true,
        message: productIds ? 
          `Synced ${productIds.length} specific products` : 
          `Synced all products in categories: ${(categories || ['chemical', 'equipment', 'glassware', 'others']).join(', ')}`,
        data: {
          productIds: productIds || 'all',
          categories: categories || ['chemical', 'equipment', 'glassware', 'others'],
          syncedCount: result.syncedCount,
          errorCount: result.errorCount,
          total: result.total
        }
      });
      
    } catch (error) {
      console.error('❌ Product sync API error:', error);
      res.status(500).json({
        success: false,
        message: 'Product sync failed',
        error: error.message
      });
    }
  })
);

// @desc    Fix ChemicalLive chemicalName field to match ChemicalMaster
// @route   POST /api/sync/fix-chemical-names
// @access  Private (Admin only)
router.post('/fix-chemical-names', 
  authenticate, 
  authorizeRole(['admin']), 
  asyncHandler(async (req, res) => {
    try {
      const ChemicalMaster = require('../models/ChemicalMaster');
      const ChemicalLive = require('../models/ChemicalLive');
      
      console.log(`🔄 Fixing ChemicalLive chemicalName fields to match ChemicalMaster...`);
      
      // Get all ChemicalMaster documents
      const chemicalMasters = await ChemicalMaster.find().populate('productId');
      
      let fixed = 0;
      let errors = 0;
      const results = [];

      for (const master of chemicalMasters) {
        try {
          // Find all ChemicalLive documents for this master
          const liveDocuments = await ChemicalLive.find({ chemicalMasterId: master._id });
          
          for (const live of liveDocuments) {
            const oldChemicalName = live.chemicalName;
            const oldDisplayName = live.displayName;
            
            // Update to match ChemicalMaster
            const updates = {
              chemicalName: master.chemicalName, // Should match master exactly
            };
            
            // If we have Product reference, update displayName too
            if (master.productId) {
              updates.displayName = master.productId.name; // Clean product name
            }
            
            await ChemicalLive.findByIdAndUpdate(live._id, updates);
            
            results.push({
              liveId: live._id,
              masterId: master._id,
              changes: {
                chemicalName: {
                  from: oldChemicalName,
                  to: master.chemicalName
                },
                displayName: {
                  from: oldDisplayName,
                  to: updates.displayName || oldDisplayName
                }
              }
            });
            
            fixed++;
          }
          
        } catch (error) {
          console.error(`❌ Failed to fix ChemicalLive for master ${master._id}:`, error);
          errors++;
        }
      }
      
      console.log(`🎉 ChemicalName fix completed: ${fixed} fixed, ${errors} errors`);
      
      res.status(200).json({
        success: true,
        message: `ChemicalLive chemicalName fix completed: ${fixed} documents fixed, ${errors} errors`,
        data: {
          fixed,
          errors,
          total: fixed + errors,
          details: results.slice(0, 10) // Show first 10 results as sample
        }
      });
      
    } catch (error) {
      console.error('❌ Fix chemical names API error:', error);
      res.status(500).json({
        success: false,
        message: 'Fix chemical names failed',
        error: error.message
      });
    }
  })
);

// @desc    Test suffix preservation logic
// @route   POST /api/sync/test-suffix
// @access  Private (Admin only)  
router.post('/test-suffix', 
  authenticate, 
  authorizeRole(['admin']), 
  asyncHandler(async (req, res) => {
    try {
      const { extractSuffix, getBaseName, updateChemicalNameWithSuffix } = require('../utils/chemicalProductIntegration');
      const { testCases } = req.body;
      
      const defaultTestCases = [
        "Sodium Chloride",
        "Sodium Chloride - A", 
        "Hydrochloric Acid - B",
        "Water - Z",
        "Ethanol"
      ];
      
      const cases = testCases || defaultTestCases;
      const results = [];
      
      for (const chemicalName of cases) {
        const baseName = getBaseName(chemicalName);
        const suffix = extractSuffix(chemicalName);
        const newName = updateChemicalNameWithSuffix(chemicalName, "NEW_PRODUCT_NAME");
        
        results.push({
          original: chemicalName,
          baseName: baseName,
          suffix: suffix || "(no suffix)",
          updated: newName,
          test: `${chemicalName} → ${newName}`
        });
      }
      
      res.status(200).json({
        success: true,
        message: 'Suffix preservation test completed',
        data: results
      });
      
    } catch (error) {
      console.error('❌ Suffix test API error:', error);
      res.status(500).json({
        success: false,
        message: 'Suffix test failed',
        error: error.message
      });
    }
  })
);

// @desc    Verify Product-Inventory consistency across all categories
// @route   GET /api/sync/verify-consistency
// @access  Private (Admin only)
router.get('/verify-consistency', 
  authenticate, 
  authorizeRole(['admin']), 
  asyncHandler(async (req, res) => {
    try {
      const { category } = req.query; // Optional: check specific category only
      
      console.log(`🔍 Verifying Product-Inventory consistency...`);
      
      const results = {
        overall: { totalChecked: 0, consistent: 0, inconsistent: 0 },
        categories: {}
      };
      
      const categoriesToCheck = category ? [category] : ['chemical', 'equipment', 'glassware', 'others'];
      
      for (const cat of categoriesToCheck) {
        let categoryResult;
        
        switch (cat) {
          case 'chemical':
            categoryResult = await verifyChemicalConsistency();
            break;
          case 'equipment':
            categoryResult = await verifyEquipmentConsistency();
            break;
          case 'glassware':
            categoryResult = await verifyGlasswareConsistency();
            break;
          case 'others':
            categoryResult = await verifyOthersConsistency();
            break;
          default:
            continue;
        }
        
        results.categories[cat] = categoryResult;
        results.overall.totalChecked += categoryResult.totalChecked;
        results.overall.consistent += categoryResult.consistent;
        results.overall.inconsistent += categoryResult.inconsistent;
      }
      
      const overallConsistencyPercentage = results.overall.totalChecked > 0 ? 
        (results.overall.consistent / results.overall.totalChecked * 100).toFixed(2) : '0.00';
      
      results.overall.consistencyPercentage = `${overallConsistencyPercentage}%`;
      results.overall.needsFix = results.overall.inconsistent > 0;
      
      console.log(`📊 Overall consistency: ${results.overall.consistent}/${results.overall.totalChecked} (${overallConsistencyPercentage}%)`);
      
      res.status(200).json({
        success: true,
        data: results
      });
      
    } catch (error) {
      console.error('❌ Consistency check API error:', error);
      res.status(500).json({
        success: false,
        message: 'Consistency check failed',
        error: error.message
      });
    }
  })
);

// Helper function to verify chemical consistency
const verifyChemicalConsistency = async () => {
  const ChemicalMaster = require('../models/ChemicalMaster');
  const ChemicalLive = require('../models/ChemicalLive');
  
  const chemicalMasters = await ChemicalMaster.find().populate('productId');
  const inconsistencies = [];
  let totalChecked = 0;
  let consistent = 0;

  for (const master of chemicalMasters) {
    const liveDocuments = await ChemicalLive.find({ chemicalMasterId: master._id });
    
    for (const live of liveDocuments) {
      totalChecked++;
      
      const isChemicalNameConsistent = live.chemicalName === master.chemicalName;
      const expectedDisplayName = master.productId ? master.productId.name : master.chemicalName;
      const isDisplayNameConsistent = live.displayName === expectedDisplayName;
      
      if (!isChemicalNameConsistent || !isDisplayNameConsistent) {
        inconsistencies.push({
          liveId: live._id,
          masterId: master._id,
          issues: {
            chemicalName: !isChemicalNameConsistent ? {
              expected: master.chemicalName,
              actual: live.chemicalName
            } : null,
            displayName: !isDisplayNameConsistent ? {
              expected: expectedDisplayName,
              actual: live.displayName
            } : null
          }
        });
      } else {
        consistent++;
      }
    }
  }

  return {
    totalChecked,
    consistent,
    inconsistent: totalChecked - consistent,
    consistencyPercentage: totalChecked > 0 ? (consistent / totalChecked * 100).toFixed(2) : '0.00',
    inconsistencies: inconsistencies.slice(0, 10)
  };
};

// Helper function to verify equipment consistency
const verifyEquipmentConsistency = async () => {
  const EquipmentLive = require('../models/EquipmentLive');
  const Product = require('../models/Product');
  
  const equipmentItems = await EquipmentLive.find().populate('productId');
  const inconsistencies = [];
  let totalChecked = 0;
  let consistent = 0;

  for (const item of equipmentItems) {
    totalChecked++;
    
    if (!item.productId) {
      inconsistencies.push({
        itemId: item._id,
        issue: 'Missing productId reference'
      });
      continue;
    }
    
    const isNameConsistent = item.name === item.productId.name;
    const isVariantConsistent = item.variant === item.productId.variant;
    
    if (!isNameConsistent || !isVariantConsistent) {
      inconsistencies.push({
        itemId: item._id,
        productId: item.productId._id,
        issues: {
          name: !isNameConsistent ? {
            expected: item.productId.name,
            actual: item.name
          } : null,
          variant: !isVariantConsistent ? {
            expected: item.productId.variant,
            actual: item.variant
          } : null
        }
      });
    } else {
      consistent++;
    }
  }

  return {
    totalChecked,
    consistent,
    inconsistent: totalChecked - consistent,
    consistencyPercentage: totalChecked > 0 ? (consistent / totalChecked * 100).toFixed(2) : '0.00',
    inconsistencies: inconsistencies.slice(0, 10)
  };
};

// Helper function to verify glassware consistency
const verifyGlasswareConsistency = async () => {
  const GlasswareLive = require('../models/GlasswareLive');
  
  const glasswareItems = await GlasswareLive.find().populate('productId');
  const inconsistencies = [];
  let totalChecked = 0;
  let consistent = 0;

  for (const item of glasswareItems) {
    totalChecked++;
    
    if (!item.productId) {
      inconsistencies.push({
        itemId: item._id,
        issue: 'Missing productId reference'
      });
      continue;
    }
    
    const isNameConsistent = item.name === item.productId.name;
    const isVariantConsistent = item.variant === item.productId.variant;
    
    if (!isNameConsistent || !isVariantConsistent) {
      inconsistencies.push({
        itemId: item._id,
        productId: item.productId._id,
        issues: {
          name: !isNameConsistent ? {
            expected: item.productId.name,
            actual: item.name
          } : null,
          variant: !isVariantConsistent ? {
            expected: item.productId.variant,
            actual: item.variant
          } : null
        }
      });
    } else {
      consistent++;
    }
  }

  return {
    totalChecked,
    consistent,
    inconsistent: totalChecked - consistent,
    consistencyPercentage: totalChecked > 0 ? (consistent / totalChecked * 100).toFixed(2) : '0.00',
    inconsistencies: inconsistencies.slice(0, 10)
  };
};

// Helper function to verify others consistency
const verifyOthersConsistency = async () => {
  const OtherProductLive = require('../models/OtherProductLive');
  
  const otherItems = await OtherProductLive.find().populate('productId');
  const inconsistencies = [];
  let totalChecked = 0;
  let consistent = 0;

  for (const item of otherItems) {
    totalChecked++;
    
    if (!item.productId) {
      inconsistencies.push({
        itemId: item._id,
        issue: 'Missing productId reference'
      });
      continue;
    }
    
    const isNameConsistent = item.name === item.productId.name;
    const isVariantConsistent = item.variant === item.productId.variant;
    
    if (!isNameConsistent || !isVariantConsistent) {
      inconsistencies.push({
        itemId: item._id,
        productId: item.productId._id,
        issues: {
          name: !isNameConsistent ? {
            expected: item.productId.name,
            actual: item.name
          } : null,
          variant: !isVariantConsistent ? {
            expected: item.productId.variant,
            actual: item.variant
          } : null
        }
      });
    } else {
      consistent++;
    }
  }

  return {
    totalChecked,
    consistent,
    inconsistent: totalChecked - consistent,
    consistencyPercentage: totalChecked > 0 ? (consistent / totalChecked * 100).toFixed(2) : '0.00',
    inconsistencies: inconsistencies.slice(0, 10)
  };
};

// @desc    Get sync status and statistics for all categories
// @route   GET /api/sync/status
// @access  Private (Admin only)
router.get('/status', 
  authenticate, 
  authorizeRole(['admin']), 
  asyncHandler(async (req, res) => {
    try {
      const ChemicalMaster = require('../models/ChemicalMaster');
      const EquipmentLive = require('../models/EquipmentLive');
      const GlasswareLive = require('../models/GlasswareLive');
      const OtherProductLive = require('../models/OtherProductLive');
      const Product = require('../models/Product');
      
      // Count products by category
      const productStats = {
        chemical: await Product.countDocuments({ category: 'chemical' }),
        equipment: await Product.countDocuments({ category: 'equipment' }),
        glassware: await Product.countDocuments({ category: 'glassware' }),
        others: await Product.countDocuments({ category: 'others' })
      };
      
      // Count inventory items by category
      const inventoryStats = {
        chemical: {
          totalChemicals: await ChemicalMaster.countDocuments(),
          linkedChemicals: await ChemicalMaster.countDocuments({ productId: { $exists: true } }),
          get unlinkedChemicals() { return this.totalChemicals - this.linkedChemicals; },
          get migrationProgress() { 
            return this.totalChemicals > 0 ? (this.linkedChemicals / this.totalChemicals * 100).toFixed(2) : '0.00';
          }
        },
        equipment: {
          totalItems: await EquipmentLive.countDocuments(),
          linkedItems: await EquipmentLive.countDocuments({ productId: { $exists: true } })
        },
        glassware: {
          totalItems: await GlasswareLive.countDocuments(),
          linkedItems: await GlasswareLive.countDocuments({ productId: { $exists: true } })
        },
        others: {
          totalItems: await OtherProductLive.countDocuments(),
          linkedItems: await OtherProductLive.countDocuments({ productId: { $exists: true } })
        }
      };
      
      // Calculate overall stats
      const totalProducts = Object.values(productStats).reduce((sum, count) => sum + count, 0);
      const totalInventoryItems = inventoryStats.chemical.totalChemicals + 
                                 inventoryStats.equipment.totalItems + 
                                 inventoryStats.glassware.totalItems + 
                                 inventoryStats.others.totalItems;
      
      const totalLinkedItems = inventoryStats.chemical.linkedChemicals + 
                              inventoryStats.equipment.linkedItems + 
                              inventoryStats.glassware.linkedItems + 
                              inventoryStats.others.linkedItems;
      
      const overallSyncPercentage = totalInventoryItems > 0 ? 
        (totalLinkedItems / totalInventoryItems * 100).toFixed(2) : '0.00';
      
      res.status(200).json({
        success: true,
        data: {
          overview: {
            totalProducts,
            totalInventoryItems,
            totalLinkedItems,
            overallSyncPercentage: `${overallSyncPercentage}%`,
            syncComplete: totalLinkedItems === totalInventoryItems
          },
          productStats,
          inventoryStats,
          categoryStatus: {
            chemical: {
              syncComplete: inventoryStats.chemical.unlinkedChemicals === 0,
              migrationProgress: `${inventoryStats.chemical.migrationProgress}%`
            },
            equipment: {
              syncComplete: inventoryStats.equipment.linkedItems === inventoryStats.equipment.totalItems,
              note: 'Equipment already has productId references'
            },
            glassware: {
              syncComplete: inventoryStats.glassware.linkedItems === inventoryStats.glassware.totalItems,
              note: 'Glassware already has productId references'
            },
            others: {
              syncComplete: inventoryStats.others.linkedItems === inventoryStats.others.totalItems,
              note: 'Others already has productId references'
            }
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Sync status API error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get sync status',
        error: error.message
      });
    }
  })
);

module.exports = router;
