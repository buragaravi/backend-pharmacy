const Request = require('../models/Request');
const ChemicalLive = require('../models/ChemicalLive');
const GlasswareLive = require('../models/GlasswareLive');
const GlasswareTransaction = require('../models/GlasswareTransaction');
const EquipmentLive = require('../models/EquipmentLive');
const EquipmentTransaction = require('../models/EquipmentTransaction');
const EquipmentAuditLog = require('../models/EquipmentAuditLog');
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const asyncHandler = require('express-async-handler');

// Helper function to validate ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// @desc    Return chemicals, glassware, and equipment to the lab
// @route   POST /api/requests/return
// @access  Private (Admin/Lab Assistant)
exports.returnChemEquipGlass = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { chemicals, glassware, equipment } = req.body;
  const adminId = req.userId;
  console.log('---[START RETURN FLOW]---');
  console.log('Request ID:', id);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  if (!isValidObjectId(id)) {
    console.log('Invalid request ID format');
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);
  if (!request) {
    console.log('Request not found');
    return res.status(404).json({ message: 'Request not found' });
  }
  const labId = request.labId;
  let errors = [];

  // --- 1. Return Chemicals ---
  if (Array.isArray(chemicals)) {
    console.log('Processing chemicals:', chemicals.length);
    for (const retChem of chemicals) {
      const { experimentId, chemicalName, quantity, chemicalMasterId } = retChem;
      console.log(`[CHEMICAL] ExperimentId: ${experimentId}, Name: ${chemicalName}, Qty: ${quantity}, MasterId: ${chemicalMasterId}`);
      const experiment = request.experiments.find(exp =>
        (exp.experimentId && exp.experimentId.equals(experimentId)) || (exp._id && exp._id.equals(experimentId))
      );
      if (!experiment) {
        console.log(`[CHEMICAL] Experiment not found for ${chemicalName}`);
        errors.push({ type: 'chemicals', error: `Experiment not found for chemical ${chemicalName}` });
        continue;
      }
      const chemical = (experiment.chemicals || []).find(chem =>
        chem.chemicalName === chemicalName && (!chemicalMasterId || (chem.chemicalMasterId && chem.chemicalMasterId.equals(chemicalMasterId)))
      );
      
      // Check if chemical is allocated by checking both isAllocated flag and allocation history
      const hasAllocations = chemical && (chemical.isAllocated || 
        (chemical.allocationHistory && Array.isArray(chemical.allocationHistory) && 
         chemical.allocationHistory.some(allocation => allocation.quantity > 0)));
      
      if (!chemical || !hasAllocations) {
        console.log(`[CHEMICAL] Not allocated or not found: ${chemicalName}`);
        console.log(`[CHEMICAL] Chemical object:`, JSON.stringify(chemical, null, 2));
        console.log(`[CHEMICAL] hasAllocations:`, hasAllocations);
        errors.push({ type: 'chemicals', error: `Chemical ${chemicalName} not allocated or not found in experiment` });
        continue;
      }
      if (quantity > (chemical.allocatedQuantity || 0)) {
        console.log(`[CHEMICAL] Return quantity exceeds allocated for ${chemicalName}`);
        errors.push({ type: 'chemicals', error: `Return quantity exceeds allocated for ${chemicalName}` });
        continue;
      }
      // --- ENHANCED: Use chemicalName from frontend to match displayName in ChemicalLive ---
      let labStock;
      const candidates = await ChemicalLive.find({ displayName: chemicalName, labId });
      
      if (!candidates || candidates.length === 0) {
        console.log(`[CHEMICAL] No ChemicalLive found for displayName ${chemicalName} in lab ${labId}, checking central-store`);
        
        // Try to find in central-store stock
        const centralCandidates = await ChemicalLive.find({ displayName: chemicalName, labId: 'central-store' });
        
        if (!centralCandidates || centralCandidates.length === 0) {
          console.log(`[CHEMICAL] No ChemicalLive found for displayName ${chemicalName} in central-store either`);
          errors.push({ type: 'chemicals', error: `Chemical stock not found for ${chemicalName} in lab or central` });
          continue;
        }
        
        // Return to central-store stock (pick the one with the latest expiryDate)
        labStock = centralCandidates.reduce((latest, curr) => {
          return (!latest || curr.expiryDate > latest.expiryDate) ? curr : latest;
        }, null);
        
        if (!labStock) {
          console.log(`[CHEMICAL] No valid ChemicalLive found for displayName ${chemicalName} in central-store`);
          errors.push({ type: 'chemicals', error: `Central stock not found for ${chemicalName}` });
          continue;
        }
        
        labStock.quantity += quantity;
        await labStock.save();
        console.log(`[CHEMICAL] Updated central-store stock for ${chemicalName}: +${quantity}`);
        
        await Transaction.create({
          transactionType: 'return',
          chemicalName: chemicalName,
          fromLabId: 'faculty',
          toLabId: 'central-store',
          chemicalLiveId: labStock._id,
          quantity,
          unit: chemical.unit,
          createdBy: adminId,
          timestamp: new Date(),
        });
        console.log(`[CHEMICAL] Transaction logged for ${chemicalName} (returned to central-store)`);
      } else {
        // Return to lab stock (pick the one with the latest expiryDate)
        labStock = candidates.reduce((latest, curr) => {
          return (!latest || curr.expiryDate > latest.expiryDate) ? curr : latest;
        }, null);
        
        if (!labStock) {
          console.log(`[CHEMICAL] No valid ChemicalLive found for displayName ${chemicalName} in lab ${labId}`);
          errors.push({ type: 'chemicals', error: `Lab stock not found for ${chemicalName}` });
          continue;
        }
        
        labStock.quantity += quantity;
        await labStock.save();
        console.log(`[CHEMICAL] Updated lab stock for ${chemicalName}: +${quantity}`);
        
        await Transaction.create({
          transactionType: 'return',
          chemicalName: chemicalName,
          fromLabId: 'faculty',
          toLabId: labId,
          chemicalLiveId: labStock._id,
          quantity,
          unit: chemical.unit,
          createdBy: adminId,
          timestamp: new Date(),
        });
        console.log(`[CHEMICAL] Transaction logged for ${chemicalName}`);
      }
      chemical.allocatedQuantity -= quantity;
      chemical.returnHistory = chemical.returnHistory || [];
      chemical.returnHistory.push({
        date: new Date(),
        quantity,
        returnedBy: adminId
      });
      if (chemical.allocatedQuantity === 0) {
        chemical.isAllocated = false;
        console.log(`[CHEMICAL] All quantity returned for ${chemicalName}, marked as not allocated.`);
      }
    }
  }

  // --- 2. Return Glassware ---
  if (Array.isArray(glassware)) {
    console.log('Processing glassware:', glassware.length);
    console.log('Request experiments:', request.experiments.map(exp => ({ 
      _id: exp._id, 
      experimentId: exp.experimentId, 
      glasswareCount: (exp.glassware || []).length 
    })));
    
    for (const retGlass of glassware) {
      const { experimentId, glasswareId, quantity } = retGlass;
      console.log(`[GLASSWARE] ExperimentId: ${experimentId}, GlasswareId: ${glasswareId}, Qty: ${quantity}`);
      const experiment = request.experiments.find(exp =>
        (exp.experimentId && exp.experimentId.equals(experimentId)) || (exp._id && exp._id.equals(experimentId))
      );
      if (!experiment) {
        console.log(`[GLASSWARE] Experiment not found for glassware ${glasswareId}`);
        console.log(`[GLASSWARE] Available experiments:`, request.experiments.map(exp => ({ _id: exp._id, experimentId: exp.experimentId })));
        errors.push({ type: 'glassware', error: `Experiment not found for glassware ${glasswareId}` });
        continue;
      }
      
      console.log(`[GLASSWARE] Found experiment:`, { _id: experiment._id, experimentId: experiment.experimentId });
      console.log(`[GLASSWARE] Experiment glassware:`, (experiment.glassware || []).map(g => ({ 
        glasswareId: g.glasswareId, 
        isAllocated: g.isAllocated, 
        allocatedQuantity: g.allocatedQuantity,
        quantity: g.quantity,
        allocationHistoryCount: (g.allocationHistory || []).length
      })));
      const glass = (experiment.glassware || []).find(gl => gl.glasswareId.equals(glasswareId));
      
      // Check if glassware is allocated by checking both isAllocated flag and allocation history
      const hasAllocations = glass && (glass.isAllocated || 
        (glass.allocationHistory && Array.isArray(glass.allocationHistory) && 
         glass.allocationHistory.some(allocation => allocation.quantity > 0)));
      
      if (!glass || !hasAllocations) {
        console.log(`[GLASSWARE] Not allocated or not found: ${glasswareId}`);
        console.log(`[GLASSWARE] Glass object:`, JSON.stringify(glass, null, 2));
        console.log(`[GLASSWARE] hasAllocations:`, hasAllocations);
        errors.push({ type: 'glassware', error: `Glassware ${glasswareId} not allocated or not found in experiment` });
        continue;
      }
      
      console.log(`[GLASSWARE] Found glass:`, JSON.stringify(glass, null, 2));
      
      // Calculate total allocated quantity from allocation history
      let totalAllocatedQuantity = 0;
      if (glass.allocationHistory && Array.isArray(glass.allocationHistory)) {
        totalAllocatedQuantity = glass.allocationHistory.reduce((total, allocation) => {
          return total + (allocation.quantity || 0);
        }, 0);
        console.log(`[GLASSWARE] Total allocated from history: ${totalAllocatedQuantity}`);
      } else if (glass.allocatedQuantity) {
        // Fallback to direct allocatedQuantity field if it exists
        totalAllocatedQuantity = glass.allocatedQuantity;
        console.log(`[GLASSWARE] Using direct allocatedQuantity: ${totalAllocatedQuantity}`);
      } else if (glass.quantity) {
        // If no allocation history, use the quantity field as allocated amount
        totalAllocatedQuantity = glass.quantity;
        console.log(`[GLASSWARE] Using quantity field as allocated: ${totalAllocatedQuantity}`);
      }
      
      console.log(`[GLASSWARE] Total allocated quantity: ${totalAllocatedQuantity}, Requested return: ${quantity}`);
      
      if (quantity > totalAllocatedQuantity) {
        console.log(`[GLASSWARE] Return quantity exceeds allocated for glassware ${glasswareId}. Allocated: ${totalAllocatedQuantity}, Requested: ${quantity}`);
        errors.push({ type: 'glassware', error: `Return quantity exceeds allocated for glassware ${glasswareId}. Allocated: ${totalAllocatedQuantity}, Requested: ${quantity}` });
        continue;
      }
      
      // Update GlasswareLive stock - return to the lab or central-store as fallback
      try {
        let glasswareStock = await GlasswareLive.findById(glasswareId);
        let returnLabId = labId;
        
        if (!glasswareStock) {
          console.log(`[GLASSWARE] GlasswareLive stock not found for ${glasswareId}`);
          errors.push({ type: 'glassware', error: `Glassware stock not found for ${glasswareId}` });
          continue;
        }
        
        // Check if the glassware belongs to the requesting lab
        if (glasswareStock.labId !== labId) {
          console.log(`[GLASSWARE] Glassware ${glasswareId} doesn't belong to lab ${labId}, returning to central-store`);
          
          // Try to find the same glassware in central-store
          const centralGlassware = await GlasswareLive.findOne({
            productId: glasswareStock.productId,
            variant: glasswareStock.variant,
            labId: 'central-store'
          });
          
          if (centralGlassware) {
            glasswareStock = centralGlassware;
            returnLabId = 'central-store';
            console.log(`[GLASSWARE] Found matching glassware in central-store, returning there`);
          } else {
            console.log(`[GLASSWARE] No matching glassware in central-store, creating new entry`);
            // Create new entry in central-store
            glasswareStock = await GlasswareLive.create({
              productId: glasswareStock.productId,
              name: glasswareStock.name,
              variant: glasswareStock.variant,
              labId: 'central-store',
              quantity: 0,
              unit: glasswareStock.unit,
              batchId: glasswareStock.batchId
            });
            returnLabId = 'central-store';
          }
        }
        
        // Update quantity in GlasswareLive
        glasswareStock.quantity += quantity;
        await glasswareStock.save();
        console.log(`[GLASSWARE] Updated glassware stock for ${glasswareId} in ${returnLabId}: +${quantity}`);
        
        // Create GlasswareTransaction record
        await GlasswareTransaction.create({
          glasswareLiveId: glasswareStock._id,
          glasswareName: glass.glasswareName || glasswareStock.name,
          transactionType: 'return',
          quantity,
          variant: glasswareStock.variant || glass.variant || 'standard',
          fromLabId: 'faculty',
          toLabId: returnLabId,
          condition: 'good',
          notes: `Returned from faculty to ${returnLabId}`,
          createdBy: adminId,
        });
        console.log(`[GLASSWARE] GlasswareTransaction logged for glassware ${glasswareId} to ${returnLabId}`);
      } catch (error) {
        console.log(`[GLASSWARE] Error updating glassware stock: ${error.message}`);
        errors.push({ type: 'glassware', error: `Failed to update glassware stock: ${error.message}` });
        continue;
      }
      
      // Update allocation tracking - handle both allocatedQuantity field and allocationHistory
      if (glass.allocatedQuantity !== undefined) {
        // If there's a direct allocatedQuantity field, update it
        glass.allocatedQuantity -= quantity;
        if (glass.allocatedQuantity <= 0) {
          glass.isAllocated = false;
          glass.allocatedQuantity = 0;
          console.log(`[GLASSWARE] All quantity returned for glassware ${glasswareId}, marked as not allocated.`);
        }
      } else if (glass.allocationHistory && Array.isArray(glass.allocationHistory)) {
        // If using allocation history, reduce from the most recent allocation
        let remainingToReturn = quantity;
        for (let i = glass.allocationHistory.length - 1; i >= 0 && remainingToReturn > 0; i--) {
          const allocation = glass.allocationHistory[i];
          const returnFromThisAllocation = Math.min(allocation.quantity, remainingToReturn);
          allocation.quantity -= returnFromThisAllocation;
          remainingToReturn -= returnFromThisAllocation;
          
          // Remove allocation entry if quantity becomes 0
          if (allocation.quantity <= 0) {
            glass.allocationHistory.splice(i, 1);
          }
        }
        
        // Check if all allocations are returned
        const remainingAllocated = glass.allocationHistory.reduce((total, alloc) => total + alloc.quantity, 0);
        if (remainingAllocated <= 0) {
          glass.isAllocated = false;
          console.log(`[GLASSWARE] All quantity returned for glassware ${glasswareId}, marked as not allocated.`);
        }
      }
      
      // Add to return history
      glass.returnHistory = glass.returnHistory || [];
      glass.returnHistory.push({
        date: new Date(),
        quantity,
        returnedBy: adminId
      });
    }
  }

  // --- 3. Return Equipment ---
  if (Array.isArray(equipment)) {
    console.log('Processing equipment:', equipment.length);
    for (const retEquip of equipment) {
      const { experimentId, name, variant, itemIds } = retEquip;
      console.log(`[EQUIPMENT] ExperimentId: ${experimentId}, Name: ${name}, Variant: ${variant}, ItemIds: ${JSON.stringify(itemIds)}`);
      const experiment = request.experiments.find(exp =>
        (exp.experimentId && exp.experimentId.equals(experimentId)) || (exp._id && exp._id.equals(experimentId))
      );
      if (!experiment) {
        console.log(`[EQUIPMENT] Experiment not found for equipment ${name}`);
        errors.push({ type: 'equipment', error: `Experiment not found for equipment ${name}` });
        continue;
      }
      const equip = (experiment.equipment || []).find(eq => eq.name === name && eq.variant === variant);
      if (!equip) {
        console.log(`[EQUIPMENT] Equipment not found: ${name} (${variant})`);
        errors.push({ type: 'equipment', error: `Equipment ${name} (${variant}) not found in experiment` });
        continue;
      }
      
      // Check if equipment is allocated by checking both isAllocated flag and allocationHistory
      let hasAllocations = equip.isAllocated;
      if (!hasAllocations && Array.isArray(equip.allocationHistory) && equip.allocationHistory.length > 0) {
        // Check if there are any allocations with quantity > 0
        hasAllocations = equip.allocationHistory.some(allocation => (allocation.quantity || 0) > 0);
      }
      
      if (!hasAllocations) {
        console.log(`[EQUIPMENT] Not allocated: ${name} (${variant})`);
        console.log(`[EQUIPMENT] isAllocated: ${equip.isAllocated}, allocationHistory length: ${(equip.allocationHistory || []).length}`);
        errors.push({ type: 'equipment', error: `Equipment ${name} (${variant}) not allocated or not found in experiment` });
        continue;
      }
      let allocatedItemIds = [];
      let latestAllocation = null;
      console.log(`[EQUIPMENT] Checking allocation history for ${name} (${variant})`);
      if (Array.isArray(equip.allocationHistory) && equip.allocationHistory.length > 0) {
        // Collect itemIds from ALL allocations, not just the latest
        allocatedItemIds = [];
        for (const allocation of equip.allocationHistory) {
          if (Array.isArray(allocation.itemIds)) {
            allocatedItemIds.push(...allocation.itemIds);
          }
        }
        // Remove duplicates and empty strings
        allocatedItemIds = [...new Set(allocatedItemIds)].filter(id => id && typeof id === 'string');
        latestAllocation = equip.allocationHistory[equip.allocationHistory.length - 1];
        console.log(`[EQUIPMENT] All allocated itemIds from history for ${name} (${variant}):`, allocatedItemIds);
      } else {
        console.log(`[EQUIPMENT] No allocation history found for ${name} (${variant}), using itemIds directly.`);
        allocatedItemIds = Array.isArray(equip.itemIds) ? equip.itemIds : [];
        console.log(`[EQUIPMENT] Using itemIds directly: ${allocatedItemIds}`);
      }
      console.log(`[EQUIPMENT] Allocated ItemIds: ${allocatedItemIds}`);
      let returned_item_ids = [], invalid_item_ids = [];
      for (const itemId of itemIds) {
        // Skip empty, null, undefined, or whitespace-only itemIds
        if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
          console.log(`[EQUIPMENT] Skipping empty or invalid itemId: "${itemId}"`);
          continue;
        }
        
        if (!allocatedItemIds.includes(itemId)) {
          console.log(`[EQUIPMENT] ItemId ${itemId} not allocated for ${name} (${variant})`);
          invalid_item_ids.push(itemId);
          continue;
        }

        await EquipmentLive.updateOne({ itemId }, { $set: { isAllocated: false, status: 'available', labId, location: labId,  } });
        await EquipmentTransaction.create({
          itemId: itemId,
          action: 'return',
          performedBy: adminId,
          performedByRole: 'lab_assistant',
          fromLocation: 'faculty',
          toLocation: labId,
          remarks: 'Returned to lab (request return)',
          interface: 'web',
        });
        await EquipmentAuditLog.create({
          itemId: itemId,
          action: 'return',
          performedBy: adminId,
          performedByRole: 'lab_assistant',
          remarks: 'Returned to lab (request return)',
          interface: 'web',
        });
        returned_item_ids.push(itemId);
        console.log(`[EQUIPMENT] Returned itemId: ${itemId}`);
      }
      equip.returnHistory = equip.returnHistory || [];
      equip.returnHistory.push({
        date: new Date(),
        itemIds: returned_item_ids,
        returnedBy: req.userId,
      });
      if (Array.isArray(equip.allocationHistory) && equip.allocationHistory.length > 0) {
        // Remove returned itemIds from all allocation history entries that contain them
        for (const allocation of equip.allocationHistory) {
          if (Array.isArray(allocation.itemIds)) {
            const originalLength = allocation.itemIds.length;
            allocation.itemIds = allocation.itemIds.filter(id => !returned_item_ids.includes(id));
            
            // Update quantity to match the actual number of remaining itemIds
            allocation.quantity = allocation.itemIds.length;
            
            if (allocation.itemIds.length < originalLength) {
              console.log(`[EQUIPMENT] Removed ${originalLength - allocation.itemIds.length} itemIds from allocation on ${allocation.date || 'unknown date'}`);
              console.log(`[EQUIPMENT] Updated quantity from ${originalLength} to ${allocation.quantity} for allocation on ${allocation.date || 'unknown date'}`);
            }
          }
        }
        
        // Check if all itemIds are returned from all allocations
        const remainingItemIds = equip.allocationHistory
          .filter(allocation => Array.isArray(allocation.itemIds))
          .flatMap(allocation => allocation.itemIds);
        
        if (remainingItemIds.length === 0) {
          equip.isAllocated = false;
          console.log(`[EQUIPMENT] All items returned for ${name} (${variant}), marked as not allocated.`);
        }
      } else {
        equip.itemIds = equip.itemIds.filter(id => !returned_item_ids.includes(id));
        if (equip.itemIds.length === 0) {
          equip.isAllocated = false;
          console.log(`[EQUIPMENT] All items returned for ${name} (${variant}), marked as not allocated.`);
        }
      }
      if (invalid_item_ids.length > 0) {
        console.log(`[EQUIPMENT] Invalid or unallocated itemIds for ${name} (${variant}):`, invalid_item_ids);
        errors.push({ type: 'equipment', error: `Invalid or unallocated itemIds for ${name} (${variant})`, invalid_item_ids });
      }
    }
  }

  await request.save();
  console.log('Request document saved.');
  if (errors.length > 0) {
    console.log('Return process completed with errors:', errors);
  } else {
    console.log('Return process completed successfully.');
  }
  res.status(errors.length > 0 ? 207 : 200).json({
    msg: 'Return process complete',
    errors,
    request: request.toObject()
  });
});
