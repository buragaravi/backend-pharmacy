// Middleware for synchronizing lab changes across all inventory and user documents
const ChemicalLive = require('../models/ChemicalLive');
const EquipmentLive = require('../models/EquipmentLive');
const GlasswareLive = require('../models/GlasswareLive');
const OtherProductLive = require('../models/OtherProductLive');
const User = require('../models/User');
const EquipmentTransaction = require('../models/EquipmentTransaction');
const GlasswareTransaction = require('../models/GlasswareTransaction');
const Transaction = require('../models/Transaction');

/**
 * Sync lab changes across all related documents
 * @param {Object} labData - Updated lab data
 * @param {String} labData.labId - Lab ID
 * @param {String} labData.labName - Lab name
 * @param {String} labData.description - Lab description
 * @param {Boolean} labData.isActive - Lab active status
 */
async function syncLabChanges(labData) {
  const { labId, labName, isActive } = labData;
  
  console.log(`🔄 Syncing lab changes for ${labId}: ${labName}`);
  
  const syncResults = {
    inventory: { updated: 0, errors: [] },
    users: { updated: 0, errors: [] },
    transactions: { updated: 0, errors: [] }
  };

  try {
    // 1. Update all inventory models with lab references
    const inventoryModels = [
      { model: ChemicalLive, name: 'ChemicalLive' },
      { model: EquipmentLive, name: 'EquipmentLive' },
      { model: GlasswareLive, name: 'GlasswareLive' },
      { model: OtherProductLive, name: 'OtherProductLive' }
    ];

    for (const inventoryType of inventoryModels) {
      try {
        const updateData = { labName };
        
        // If lab is deactivated, we might want to handle this specially
        if (!isActive) {
          console.log(`⚠️ Lab ${labId} is being deactivated`);
          // Add any special handling for deactivated labs
        }

        const result = await inventoryType.model.updateMany(
          { labId },
          { $set: updateData }
        );

        syncResults.inventory.updated += result.modifiedCount;
        console.log(`✅ Updated ${result.modifiedCount} ${inventoryType.name} documents`);
        
      } catch (error) {
        console.error(`❌ Error updating ${inventoryType.name}:`, error.message);
        syncResults.inventory.errors.push(`${inventoryType.name}: ${error.message}`);
      }
    }

    // 2. Update users with this labId (lab_assistants)
    try {
      const userResult = await User.updateMany(
        { labId },
        { $set: { labName } } // Add labName field to User model
      );
      
      syncResults.users.updated += userResult.modifiedCount;
      console.log(`✅ Updated ${userResult.modifiedCount} User documents`);
      
    } catch (error) {
      console.error(`❌ Error updating Users:`, error.message);
      syncResults.users.errors.push(`Users: ${error.message}`);
    }

    // 3. Update transaction models
    const transactionModels = [
      { model: Transaction, name: 'Transaction' },
      { model: EquipmentTransaction, name: 'EquipmentTransaction' },
      { model: GlasswareTransaction, name: 'GlasswareTransaction' }
    ];

    for (const transactionType of transactionModels) {
      try {
        // Update both fromLabId and toLabId references
        const fromLabResult = await transactionType.model.updateMany(
          { fromLabId: labId },
          { $set: { fromLabName: labName } }
        );

        const toLabResult = await transactionType.model.updateMany(
          { toLabId: labId },
          { $set: { toLabName: labName } }
        );

        const totalUpdated = fromLabResult.modifiedCount + toLabResult.modifiedCount;
        syncResults.transactions.updated += totalUpdated;
        console.log(`✅ Updated ${totalUpdated} ${transactionType.name} documents`);
        
      } catch (error) {
        console.error(`❌ Error updating ${transactionType.name}:`, error.message);
        syncResults.transactions.errors.push(`${transactionType.name}: ${error.message}`);
      }
    }

    console.log(`🎉 Lab sync completed for ${labId}`);
    return syncResults;

  } catch (error) {
    console.error(`❌ Lab sync failed for ${labId}:`, error);
    throw error;
  }
}

/**
 * Bulk sync all labs to ensure consistency
 */
async function bulkSyncLabs() {
  const Lab = require('../models/Lab');
  
  console.log('🔄 Starting bulk lab sync...');
  
  try {
    const labs = await Lab.find({ isActive: true });
    let totalSynced = 0;
    let totalErrors = 0;

    for (const lab of labs) {
      try {
        const result = await syncLabChanges({
          labId: lab.labId,
          labName: lab.labName,
          description: lab.description,
          isActive: lab.isActive
        });
        
        totalSynced += result.inventory.updated + result.users.updated + result.transactions.updated;
        totalErrors += result.inventory.errors.length + result.users.errors.length + result.transactions.errors.length;
        
      } catch (error) {
        console.error(`❌ Failed to sync lab ${lab.labId}:`, error.message);
        totalErrors++;
      }
    }

    console.log(`🎉 Bulk lab sync completed: ${totalSynced} documents updated, ${totalErrors} errors`);
    return { totalSynced, totalErrors };

  } catch (error) {
    console.error('❌ Bulk lab sync failed:', error);
    throw error;
  }
}

/**
 * Check for labs referenced in documents but not in Lab collection
 */
async function findOrphanedLabReferences() {
  console.log('🔍 Checking for orphaned lab references...');
  
  const Lab = require('../models/Lab');
  const orphanedRefs = [];

  try {
    // Get all active lab IDs
    const activeLabs = await Lab.find({ isActive: true }).distinct('labId');
    
    // Check inventory models
    const inventoryModels = [ChemicalLive, EquipmentLive, GlasswareLive, OtherProductLive];
    
    for (const model of inventoryModels) {
      const distinctLabIds = await model.distinct('labId');
      const orphaned = distinctLabIds.filter(labId => !activeLabs.includes(labId));
      
      if (orphaned.length > 0) {
        orphanedRefs.push({
          model: model.modelName,
          orphanedLabIds: orphaned
        });
      }
    }

    // Check users
    const userLabIds = await User.distinct('labId');
    const orphanedUserLabs = userLabIds.filter(labId => labId && !activeLabs.includes(labId));
    
    if (orphanedUserLabs.length > 0) {
      orphanedRefs.push({
        model: 'User',
        orphanedLabIds: orphanedUserLabs
      });
    }

    return orphanedRefs;

  } catch (error) {
    console.error('❌ Error checking orphaned references:', error);
    throw error;
  }
}

module.exports = {
  syncLabChanges,
  bulkSyncLabs,
  findOrphanedLabReferences
};
