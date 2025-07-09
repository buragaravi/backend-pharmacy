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
      if (!chemical || !chemical.isAllocated) {
        console.log(`[CHEMICAL] Not allocated or not found: ${chemicalName}`);
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
        console.log(`[CHEMICAL] No ChemicalLive found for displayName ${chemicalName} in lab ${labId}, checking central-lab`);
        
        // Try to find in central-lab stock
        const centralCandidates = await ChemicalLive.find({ displayName: chemicalName, labId: 'central-lab' });
        
        if (!centralCandidates || centralCandidates.length === 0) {
          console.log(`[CHEMICAL] No ChemicalLive found for displayName ${chemicalName} in central-lab either`);
          errors.push({ type: 'chemicals', error: `Chemical stock not found for ${chemicalName} in lab or central` });
          continue;
        }
        
        // Return to central-lab stock (pick the one with the latest expiryDate)
        labStock = centralCandidates.reduce((latest, curr) => {
          return (!latest || curr.expiryDate > latest.expiryDate) ? curr : latest;
        }, null);
        
        if (!labStock) {
          console.log(`[CHEMICAL] No valid ChemicalLive found for displayName ${chemicalName} in central-lab`);
          errors.push({ type: 'chemicals', error: `Central stock not found for ${chemicalName}` });
          continue;
        }
        
        labStock.quantity += quantity;
        await labStock.save();
        console.log(`[CHEMICAL] Updated central-lab stock for ${chemicalName}: +${quantity}`);
        
        await Transaction.create({
          transactionType: 'return',
          chemicalName: chemicalName,
          fromLabId: 'faculty',
          toLabId: 'central-lab',
          chemicalLiveId: labStock._id,
          quantity,
          unit: chemical.unit,
          createdBy: adminId,
          timestamp: new Date(),
        });
        console.log(`[CHEMICAL] Transaction logged for ${chemicalName} (returned to central-lab)`);
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
        allocatedQuantity: g.allocatedQuantity 
      })));
      const glass = (experiment.glassware || []).find(gl => gl.glasswareId.equals(glasswareId));
      if (!glass || !glass.isAllocated) {
        console.log(`[GLASSWARE] Not allocated or not found: ${glasswareId}`);
        console.log(`[GLASSWARE] Glass object:`, JSON.stringify(glass, null, 2));
        errors.push({ type: 'glassware', error: `Glassware ${glasswareId} not allocated or not found in experiment` });
        continue;
      }
      
      console.log(`[GLASSWARE] Found glass:`, JSON.stringify(glass, null, 2));
      console.log(`[GLASSWARE] Allocated quantity: ${glass.allocatedQuantity}, Requested return: ${quantity}`);
      if (quantity > (glass.allocatedQuantity || 0)) {
        console.log(`[GLASSWARE] Return quantity exceeds allocated for glassware ${glasswareId}. Allocated: ${glass.allocatedQuantity || 0}, Requested: ${quantity}`);
        errors.push({ type: 'glassware', error: `Return quantity exceeds allocated for glassware ${glasswareId}. Allocated: ${glass.allocatedQuantity || 0}, Requested: ${quantity}` });
        continue;
      }
      
      // Update GlasswareLive stock - return to the lab or central-lab as fallback
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
          console.log(`[GLASSWARE] Glassware ${glasswareId} doesn't belong to lab ${labId}, returning to central-lab`);
          
          // Try to find the same glassware in central-lab
          const centralGlassware = await GlasswareLive.findOne({
            productId: glasswareStock.productId,
            variant: glasswareStock.variant,
            labId: 'central-lab'
          });
          
          if (centralGlassware) {
            glasswareStock = centralGlassware;
            returnLabId = 'central-lab';
            console.log(`[GLASSWARE] Found matching glassware in central-lab, returning there`);
          } else {
            console.log(`[GLASSWARE] No matching glassware in central-lab, creating new entry`);
            // Create new entry in central-lab
            glasswareStock = await GlasswareLive.create({
              productId: glasswareStock.productId,
              name: glasswareStock.name,
              variant: glasswareStock.variant,
              labId: 'central-lab',
              quantity: 0,
              unit: glasswareStock.unit,
              batchId: glasswareStock.batchId
            });
            returnLabId = 'central-lab';
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
      glass.allocatedQuantity -= quantity;
      glass.returnHistory = glass.returnHistory || [];
      glass.returnHistory.push({
        date: new Date(),
        quantity,
        returnedBy: adminId
      });
      if (glass.allocatedQuantity === 0) {
        glass.isAllocated = false;
        console.log(`[GLASSWARE] All quantity returned for glassware ${glasswareId}, marked as not allocated.`);
      }
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
      if (!equip || !equip.isAllocated) {
        console.log(`[EQUIPMENT] Not allocated or not found: ${name} (${variant})`);
        errors.push({ type: 'equipment', error: `Equipment ${name} (${variant}) not allocated or not found in experiment` });
        continue;
      }
      let allocatedItemIds = [];
      let latestAllocation = null;
      console.log(`[EQUIPMENT] Checking allocation history for ${name} (${variant})`);
      if (Array.isArray(equip.allocationHistory) && equip.allocationHistory.length > 0) {
        // Only consider the latest allocationHistory entry
        latestAllocation = equip.allocationHistory[equip.allocationHistory.length - 1];
        allocatedItemIds = Array.isArray(latestAllocation.itemIds) ? latestAllocation.itemIds : [];
        console.log(`[EQUIPMENT] Latest allocation found for ${name} (${variant}):`, latestAllocation);
      } else {
        console.log(`[EQUIPMENT] No allocation history found for ${name} (${variant}), using itemIds directly.`);
        allocatedItemIds = Array.isArray(equip.itemIds) ? equip.itemIds : [];
        console.log(`[EQUIPMENT] Using itemIds directly: ${allocatedItemIds}`);
      }
      console.log(`[EQUIPMENT] Allocated ItemIds: ${allocatedItemIds}`);
      let returned_item_ids = [], invalid_item_ids = [];
      for (const itemId of itemIds) {
        if (typeof itemId !== 'string') {
          console.log(`[EQUIPMENT] Invalid itemId: ${itemId}`);
          invalid_item_ids.push(itemId);
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
      if (Array.isArray(equip.allocationHistory) && equip.allocationHistory.length > 0 && latestAllocation) {
        // Remove returned itemIds only from the latest allocationHistory entry
        if (Array.isArray(latestAllocation.itemIds)) {
          latestAllocation.itemIds = latestAllocation.itemIds.filter(id => !returned_item_ids.includes(id));
        }
        // If all itemIds are returned from the latest allocation, mark as not allocated
        if (!latestAllocation.itemIds || latestAllocation.itemIds.length === 0) {
          equip.isAllocated = false;
          console.log(`[EQUIPMENT] All items returned for ${name} (${variant}) in latest allocation, marked as not allocated.`);
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
