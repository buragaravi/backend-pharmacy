// Middleware to handle Product changes and sync with related models
const ChemicalMaster = require('../models/ChemicalMaster');
const ChemicalLive = require('../models/ChemicalLive');

/**
 * Extract suffix from chemical name (e.g., "Sodium Chloride - A" → " - A")
 * @param {string} chemicalName - The chemical name with potential suffix
 * @returns {string} - The suffix part (including " - ") or empty string
 */
const extractSuffix = (chemicalName) => {
  const suffixMatch = chemicalName.match(/ - [A-Z]$/);
  return suffixMatch ? suffixMatch[0] : '';
};

/**
 * Get base name without suffix (e.g., "Sodium Chloride - A" → "Sodium Chloride")
 * @param {string} chemicalName - The chemical name with potential suffix
 * @returns {string} - The base name without suffix
 */
const getBaseName = (chemicalName) => {
  return chemicalName.replace(/ - [A-Z]$/, '');
};

/**
 * Sync Product changes with Chemical system
 * This middleware runs after Product updates to maintain consistency
 */
const syncProductChanges = async (productId, changes) => {
  try {
    console.log(`🔄 Syncing Product changes for ID: ${productId}`);
    
    // Get the product to determine category
    const Product = require('../models/Product');
    const product = await Product.findById(productId);
    
    if (!product) {
      console.log(`❌ Product not found: ${productId}`);
      return;
    }
    
    console.log(`📦 Product category: ${product.category}`);
    
    // Sync based on product category
    switch (product.category.toLowerCase()) {
      case 'chemical':
        await syncChemicalChanges(productId, changes);
        break;
      case 'equipment':
        await syncEquipmentChanges(productId, changes);
        break;
      case 'glassware':
        await syncGlasswareChanges(productId, changes);
        break;
      case 'others':
        await syncOthersChanges(productId, changes);
        break;
      default:
        console.log(`⚠️  Unknown product category: ${product.category}`);
    }
    
    console.log(`🎉 Product sync completed for ID: ${productId}`);
  } catch (error) {
    console.error('❌ Error syncing Product changes:', error);
    throw error;
  }
};

/**
 * Sync Chemical product changes (existing functionality)
 */
const syncChemicalChanges = async (productId, changes) => {
  try {
    console.log(`🧪 Syncing Chemical changes for Product ID: ${productId}`);
    
    // Find all ChemicalMaster documents that reference this product
    const chemicalMasters = await ChemicalMaster.find({ productId }).populate('productId');
    
    if (chemicalMasters.length === 0) {
      console.log(`ℹ️  No chemical masters found for Product ID: ${productId}`);
      return;
    }

    for (const chemicalMaster of chemicalMasters) {
      let masterUpdates = {};
      let liveUpdates = {};
      
      // Sync name changes with suffix preservation
      if (changes.name) {
        const currentBaseName = getBaseName(chemicalMaster.chemicalName);
        const currentSuffix = extractSuffix(chemicalMaster.chemicalName);
        
        // Only update if the base name actually changed
        if (changes.name !== currentBaseName) {
          // For ChemicalMaster: Update base name but preserve suffix
          const newChemicalName = changes.name + currentSuffix;
          masterUpdates.chemicalName = newChemicalName;
          
          // For ChemicalLive: Update both chemicalName (with suffix) and displayName (clean)
          liveUpdates.chemicalName = newChemicalName; // Match ChemicalMaster exactly
          liveUpdates.displayName = changes.name;     // Clean name for display
          
          console.log(`📝 Master name change: "${chemicalMaster.chemicalName}" → "${newChemicalName}"`);
          console.log(`📝 Live chemical name: "${chemicalMaster.chemicalName}" → "${newChemicalName}"`);
          console.log(`📝 Live display name: "${currentBaseName}" → "${changes.name}"`);
        }
      }
      
      // Sync unit changes
      if (changes.unit && changes.unit !== chemicalMaster.unit) {
        masterUpdates.unit = changes.unit;
        liveUpdates.unit = changes.unit;
        console.log(`📝 Unit change: "${chemicalMaster.unit}" → "${changes.unit}"`);
      }
      
      // Update ChemicalMaster if needed
      if (Object.keys(masterUpdates).length > 0) {
        await ChemicalMaster.findByIdAndUpdate(chemicalMaster._id, masterUpdates);
        console.log(`✅ Updated ChemicalMaster: ${chemicalMaster._id}`);
      }
      
      // Update all related ChemicalLive documents
      if (Object.keys(liveUpdates).length > 0) {
        const ChemicalLive = require('../models/ChemicalLive');
        const liveUpdateResult = await ChemicalLive.updateMany(
          { chemicalMasterId: chemicalMaster._id },
          liveUpdates
        );
        console.log(`✅ Updated ${liveUpdateResult.modifiedCount} ChemicalLive documents`);
      }
    }
  } catch (error) {
    console.error('❌ Error syncing Chemical changes:', error);
    throw error;
  }
};

/**
 * Sync Equipment product changes
 */
const syncEquipmentChanges = async (productId, changes) => {
  try {
    console.log(`🔧 Syncing Equipment changes for Product ID: ${productId}`);
    
    const EquipmentLive = require('../models/EquipmentLive');
    
    // Find all EquipmentLive documents that reference this product
    const equipmentItems = await EquipmentLive.find({ productId });
    
    if (equipmentItems.length === 0) {
      console.log(`ℹ️  No equipment items found for Product ID: ${productId}`);
      return;
    }
    
    let updates = {};
    
    // Sync name changes
    if (changes.name) {
      updates.name = changes.name;
      console.log(`📝 Equipment name change: → "${changes.name}"`);
    }
    
    // Sync variant changes
    if (changes.variant !== undefined) {
      updates.variant = changes.variant;
      console.log(`📝 Equipment variant change: → "${changes.variant}"`);
    }
    
    // Update all EquipmentLive documents
    if (Object.keys(updates).length > 0) {
      const updateResult = await EquipmentLive.updateMany(
        { productId },
        updates
      );
      console.log(`✅ Updated ${updateResult.modifiedCount} EquipmentLive documents`);
    }
    
  } catch (error) {
    console.error('❌ Error syncing Equipment changes:', error);
    throw error;
  }
};

/**
 * Sync Glassware product changes
 */
const syncGlasswareChanges = async (productId, changes) => {
  try {
    console.log(`🧪 Syncing Glassware changes for Product ID: ${productId}`);
    
    const GlasswareLive = require('../models/GlasswareLive');
    
    // Find all GlasswareLive documents that reference this product
    const glasswareItems = await GlasswareLive.find({ productId });
    
    if (glasswareItems.length === 0) {
      console.log(`ℹ️  No glassware items found for Product ID: ${productId}`);
      return;
    }
    
    let updates = {};
    
    // Sync name changes
    if (changes.name) {
      updates.name = changes.name;
      console.log(`📝 Glassware name change: → "${changes.name}"`);
    }
    
    // Sync variant changes
    if (changes.variant !== undefined) {
      updates.variant = changes.variant;
      console.log(`📝 Glassware variant change: → "${changes.variant}"`);
    }
    
    // Update all GlasswareLive documents
    if (Object.keys(updates).length > 0) {
      const updateResult = await GlasswareLive.updateMany(
        { productId },
        updates
      );
      console.log(`✅ Updated ${updateResult.modifiedCount} GlasswareLive documents`);
    }
    
  } catch (error) {
    console.error('❌ Error syncing Glassware changes:', error);
    throw error;
  }
};

/**
 * Sync Others product changes
 */
const syncOthersChanges = async (productId, changes) => {
  try {
    console.log(`📦 Syncing Others changes for Product ID: ${productId}`);
    
    const OtherProductLive = require('../models/OtherProductLive');
    
    // Find all OtherProductLive documents that reference this product
    const otherItems = await OtherProductLive.find({ productId });
    
    if (otherItems.length === 0) {
      console.log(`ℹ️  No other product items found for Product ID: ${productId}`);
      return;
    }
    
    let updates = {};
    
    // Sync name changes
    if (changes.name) {
      updates.name = changes.name;
      console.log(`📝 Others name change: → "${changes.name}"`);
    }
    
    // Sync variant changes
    if (changes.variant !== undefined) {
      updates.variant = changes.variant;
      console.log(`📝 Others variant change: → "${changes.variant}"`);
    }
    
    // Update all OtherProductLive documents
    if (Object.keys(updates).length > 0) {
      const updateResult = await OtherProductLive.updateMany(
        { productId },
        updates
      );
      console.log(`✅ Updated ${updateResult.modifiedCount} OtherProductLive documents`);
    }
    
  } catch (error) {
    console.error('❌ Error syncing Others changes:', error);
    throw error;
  }
};

/**
 * Express middleware wrapper for product updates
 */
const handleProductUpdate = (req, res, next) => {
  // Store original end function
  const originalEnd = res.end;
  
  // Override res.end to trigger sync after successful response
  res.end = async function(chunk, encoding) {
    // Call original end first
    originalEnd.call(this, chunk, encoding);
    
    // Only sync if update was successful (status 200)
    if (res.statusCode === 200 && req.method === 'PUT' && req.params.id) {
      try {
        // Extract changes from request body
        const changes = {
          name: req.body.name,
          unit: req.body.unit
        };
        
        // Only sync if there are actual changes
        if (changes.name || changes.unit) {
          await syncProductChanges(req.params.id, changes);
        }
      } catch (error) {
        console.error('❌ Post-update sync failed:', error);
        // Don't affect the response as it's already sent
      }
    }
  };
  
  next();
};

/**
 * Manual sync function for bulk operations
 */
const bulkSyncProducts = async (productIds = [], categories = ['chemical', 'equipment', 'glassware', 'others']) => {
  try {
    const Product = require('../models/Product');
    
    let query = {};
    
    if (productIds.length === 0) {
      // Sync all products in specified categories if no specific IDs provided
      query = { category: { $in: categories } };
    } else {
      // Sync specific product IDs
      query = { _id: { $in: productIds } };
    }
    
    const products = await Product.find(query);
    console.log(`🔄 Starting bulk sync for ${products.length} products...`);
    
    let syncedCount = 0;
    let errorCount = 0;
    
    for (const product of products) {
      try {
        await syncProductChanges(product._id, {
          name: product.name,
          unit: product.unit,
          variant: product.variant
        });
        syncedCount++;
        console.log(`✅ Synced ${product.category}: ${product.name}`);
      } catch (error) {
        console.error(`❌ Failed to sync product ${product._id}:`, error);
        errorCount++;
      }
    }
    
    console.log(`🎉 Bulk sync completed: ${syncedCount} synced, ${errorCount} errors`);
    return { syncedCount, errorCount, total: products.length };
    
  } catch (error) {
    console.error('❌ Bulk sync failed:', error);
    throw error;
  }
};

module.exports = {
  syncProductChanges,
  handleProductUpdate,
  bulkSyncProducts
};
