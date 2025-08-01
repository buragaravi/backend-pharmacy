/**
 * Middleware for date validation and allocation control
 */

const Request = require('../models/Request');
const { isAllocationAllowed, getExperimentAllocationStatus } = require('../utils/dateValidation');

/**
 * Validate experiment dates before allocation
 */
const validateExperimentDate = async (req, res, next) => {
  try {
    const requestId = req.params.id || req.params.requestId; // Fix: support both :id and :requestId
    const { experimentId } = req.params;
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin';
    
    console.log('validateExperimentDate middleware - requestId:', requestId);
    
    const request = await Request.findById(requestId);
    if (!request) {
      console.log('validateExperimentDate middleware - Request not found:', requestId);
      return res.status(404).json({
        message: 'Request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }
    
    // If experimentId is provided, validate specific experiment
    if (experimentId) {
      const experiment = request.experiments.id(experimentId);
      if (!experiment) {
        return res.status(404).json({
          message: 'Experiment not found in request',
          code: 'EXPERIMENT_NOT_FOUND'
        });
      }
      
      const dateValidation = isAllocationAllowed(experiment.date, isAdmin);
      
      // Check admin override
      if (experiment.allocationStatus?.adminOverride && isAdmin) {
        req.dateOverride = true;
        return next();
      }
      
      if (!dateValidation.allowed) {
        return res.status(403).json({
          message: 'Allocation not allowed due to date restrictions',
          reason: dateValidation.reason,
          experimentDate: experiment.date,
          daysOverdue: dateValidation.daysOverdue,
          code: dateValidation.reason === 'date_expired_completely' ? 
            'DATE_EXPIRED_COMPLETELY' : 'DATE_EXPIRED_ADMIN_ONLY'
        });
      }
    } else {
      // Validate all experiments in request
      const invalidExperiments = [];
      
      for (const experiment of request.experiments) {
        const dateValidation = isAllocationAllowed(experiment.date, isAdmin);
        
        // Skip if admin override is active
        if (experiment.allocationStatus?.adminOverride && isAdmin) {
          continue;
        }
        
        if (!dateValidation.allowed) {
          invalidExperiments.push({
            experimentId: experiment._id,
            experimentName: experiment.experimentName,
            date: experiment.date,
            reason: dateValidation.reason,
            daysOverdue: dateValidation.daysOverdue
          });
        }
      }
      
      if (invalidExperiments.length > 0) {
        return res.status(403).json({
          message: 'Some experiments have date restrictions',
          invalidExperiments,
          code: 'MULTIPLE_DATE_VIOLATIONS'
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Date validation middleware error:', error);
    res.status(500).json({
      message: 'Internal server error during date validation',
      code: 'VALIDATION_ERROR'
    });
  }
};

/**
 * Validate edit permissions for items
 */
const validateEditPermissions = async (req, res, next) => {
  console.log('\n=== VALIDATE EDIT PERMISSIONS MIDDLEWARE DEBUG ===');
  console.log('Request Method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request Params:', JSON.stringify(req.params, null, 2));
  console.log('Request Body:', JSON.stringify(req.body, null, 2));
  console.log('User Role:', req.user?.role);
  console.log('User ID:', req.user?.id || req.userId);
  
  try {
    // Extract request ID - try multiple possible parameter names
    const requestId = req.params.requestId || req.params.id || req.body.requestId;
    console.log('Available param keys:', Object.keys(req.params));
    console.log('req.params.id:', req.params.id);
    console.log('req.params.requestId:', req.params.requestId);
    console.log('Extracted Request ID:', requestId);
    
    // Support both old format (experiments) and new format (edits)
    const { experiments: experimentUpdates, edits } = req.body;
    console.log('Extracted experiments:', experimentUpdates);
    console.log('Extracted edits:', edits);
    console.log('Edits is array?:', Array.isArray(edits));
    console.log('Edits length:', edits?.length);
    
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin';
    console.log('User is admin?:', isAdmin);
    
    // Validate we have a request ID
    if (!requestId) {
      console.log('❌ NO REQUEST ID FOUND');
      console.log('Available params:', req.params);
      console.log('Available body:', req.body);
      return res.status(400).json({
        message: 'Request ID is required',
        code: 'MISSING_REQUEST_ID'
      });
    }
    
    console.log('Looking for request with ID:', requestId);
    const request = await Request.findById(requestId);
    
    if (!request) {
      console.log('❌ REQUEST NOT FOUND in database for ID:', requestId);
      console.log('Request result:', request);
      return res.status(404).json({
        message: 'Request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }
    
    console.log('✅ REQUEST FOUND:', {
      id: request._id,
      labId: request.labId,
      status: request.status,
      experimentsCount: request.experiments?.length
    });
    
    const violations = [];
    
    // Handle new edits format
    if (edits && Array.isArray(edits)) {
      console.log('\n--- Processing NEW EDITS FORMAT ---');
      console.log('Number of edits to process:', edits.length);
      
      // Group edits by experiment for validation
      const experimentGroups = {};
      edits.forEach((edit, index) => {
        console.log(`Edit ${index + 1}:`, JSON.stringify(edit, null, 2));
        if (!experimentGroups[edit.experimentId]) {
          experimentGroups[edit.experimentId] = [];
        }
        experimentGroups[edit.experimentId].push(edit);
      });
      
      console.log('Experiment groups:', Object.keys(experimentGroups));
      
      for (const [experimentId, experimentEdits] of Object.entries(experimentGroups)) {
        console.log(`\n--- Processing Experiment: ${experimentId} ---`);
        console.log('Number of edits for this experiment:', experimentEdits.length);
        
        const experiment = request.experiments.id(experimentId);
        if (!experiment) {
          console.log('❌ Experiment not found in request:', experimentId);
          continue;
        }
        
        console.log('✅ Experiment found:', {
          id: experiment._id,
          name: experiment.experimentName,
          date: experiment.date
        });
        
        const dateValidation = isAllocationAllowed(experiment.date, isAdmin);
        console.log('Date validation result:', dateValidation);
        
        // Check admin override
        const hasOverride = experiment.allocationStatus?.adminOverride && isAdmin;
        console.log('Has admin override?:', hasOverride);
        console.log('Admin override data:', experiment.allocationStatus?.adminOverride);
        
        if (!dateValidation.allowed && !hasOverride && dateValidation.reason === 'date_expired_completely') {
          console.log('❌ Date expired completely, blocking edit');
          violations.push({
            experimentId: experiment._id,
            experimentName: experiment.experimentName,
            violation: 'DATE_EXPIRED_COMPLETELY',
            message: `Cannot edit experiment "${experiment.experimentName}" - date expired completely`
          });
          continue;
        }
        
        console.log('✅ Date validation passed for experiment');
        
        // Validate each edit in this experiment
        for (const edit of experimentEdits) {
          console.log(`\n--- Validating edit for item: ${edit.itemId} ---`);
          console.log('Edit details:', JSON.stringify(edit, null, 2));
          
          const itemArray = experiment[edit.itemType];
          if (!itemArray) {
            console.log('❌ Item type not found:', edit.itemType);
            continue;
          }
          
          console.log(`Item array (${edit.itemType}) length:`, itemArray.length);
          
          const item = itemArray.id(edit.itemId);
          if (!item) {
            console.log('❌ Item not found in experiment:', edit.itemId);
            continue;
          }
          
          console.log('✅ Item found:', {
            id: item._id,
            name: item.name || item.chemicalName,
            quantity: item.quantity,
            isAllocated: item.isAllocated,
            isDisabled: item.isDisabled
          });
          
          // For date-expired experiments (not completely), only allow certain edits
          if (!dateValidation.allowed && !hasOverride) {
            console.log('Date expired but not completely, checking edit type...');
            
            // Only allow disable/enable operations for admin in grace period
            if (isAdmin && edit.disableItem !== undefined) {
              console.log('✅ Admin disable/enable operation allowed');
              continue; // Allow this edit
            }
            
            console.log('❌ Limited edit permissions due to date');
            violations.push({
              experimentId: experiment._id,
              experimentName: experiment.experimentName,
              itemId: edit.itemId,
              violation: 'DATE_EXPIRED_LIMITED_EDIT',
              message: `Limited edit permissions for experiment "${experiment.experimentName}" - date expired`
            });
          } else {
            console.log('✅ Full edit permissions available');
          }
        }
      }
    } else {
      console.log('\n--- NO EDITS ARRAY FOUND, checking old format ---');
    }
    
    // Handle old experiments format for backward compatibility
    if (experimentUpdates && experimentUpdates.length > 0) {
      console.log('\n--- Processing OLD EXPERIMENTS FORMAT ---');
      console.log('Number of experiment updates:', experimentUpdates.length);
    } else {
      console.log('No experiment updates in old format');
    }
    
    for (const expUpdate of experimentUpdates || []) {
      console.log('\n--- Processing old format experiment update ---');
      console.log('Experiment update:', JSON.stringify(expUpdate, null, 2));
      
      const experiment = request.experiments.id(expUpdate.experimentId);
      if (!experiment) continue;
      
      const dateValidation = isAllocationAllowed(experiment.date, isAdmin);
      
      // Check admin override
      const hasOverride = experiment.allocationStatus?.adminOverride && isAdmin;
      
      if (!dateValidation.allowed && !hasOverride && dateValidation.reason === 'date_expired_completely') {
        violations.push({
          experimentId: experiment._id,
          experimentName: experiment.experimentName,
          violation: 'DATE_EXPIRED_COMPLETELY',
          message: `Cannot edit experiment "${experiment.experimentName}" - date expired completely`
        });
        continue;
      }
      
      // Validate item-level edits
      for (const itemUpdate of expUpdate.itemUpdates || []) {
        const itemArray = experiment[itemUpdate.type];
        if (!itemArray) continue;
        
        const item = itemArray.id(itemUpdate.itemId);
        if (!item) continue;
        
        // Check if trying to decrease allocated quantity
        if (item.isAllocated && itemUpdate.quantity < item.quantity) {
          violations.push({
            experimentId: experiment._id,
            itemId: item._id,
            itemName: item.name || item.chemicalName,
            violation: 'DECREASE_ALLOCATED_QUANTITY',
            message: `Cannot decrease quantity of allocated item "${item.name || item.chemicalName}" from ${item.quantity} to ${itemUpdate.quantity}`
          });
        }
        
        // Check if trying to edit allocated non-disabled item
        if (item.isAllocated && !item.isDisabled && itemUpdate.quantity !== item.quantity) {
          // Only allow increases
          if (itemUpdate.quantity <= item.quantity) {
            violations.push({
              experimentId: experiment._id,
              itemId: item._id,
              itemName: item.name || item.chemicalName,
              violation: 'EDIT_ALLOCATED_ITEM',
              message: `Cannot modify allocated item "${item.name || item.chemicalName}" - only increases are allowed`
            });
          }
        }
      }
    }
    
    console.log('\n--- VALIDATION SUMMARY ---');
    console.log('Total violations found:', violations.length);
    if (violations.length > 0) {
      console.log('Violations details:', JSON.stringify(violations, null, 2));
    }
    
    if (violations.length > 0) {
      console.log('❌ VALIDATION FAILED - Returning 400 with violations');
      return res.status(400).json({
        message: 'Edit validation failed',
        violations,
        code: 'EDIT_PERMISSION_VIOLATIONS'
      });
    }
    
    console.log('✅ VALIDATION PASSED - Calling next()');
    console.log('=== END VALIDATE EDIT PERMISSIONS MIDDLEWARE ===\n');
    next();
  } catch (error) {
    console.error('❌ MIDDLEWARE ERROR:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      message: 'Internal server error during edit validation',
      code: 'EDIT_VALIDATION_ERROR'
    });
  }
};

/**
 * Update allocation status for experiments
 */
const updateAllocationStatus = async (req, res, next) => {
  try {
    const requestId = req.params.id || req.params.requestId; // Fix: support both :id and :requestId
    const userRole = req.user?.role;
    const isAdmin = userRole === 'admin';
    
    console.log('updateAllocationStatus middleware - requestId:', requestId);
    
    const request = await Request.findById(requestId);
    if (!request) {
      console.log('updateAllocationStatus middleware - Request not found:', requestId);
      return res.status(404).json({
        message: 'Request not found',
        code: 'REQUEST_NOT_FOUND'
      });
    }
    
    // Update allocation status for all experiments
    let hasChanges = false;
    
    for (const experiment of request.experiments) {
      const currentStatus = experiment.allocationStatus;
      const newStatus = getExperimentAllocationStatus(experiment, isAdmin);
      
      // Update if status changed
      if (!currentStatus || 
          currentStatus.canAllocate !== newStatus.canAllocate ||
          currentStatus.reasonType !== newStatus.reasonType) {
        
        experiment.allocationStatus = {
          ...currentStatus,
          canAllocate: newStatus.canAllocate,
          reason: newStatus.reason,
          reasonType: newStatus.reasonType,
          lastChecked: new Date()
        };
        
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      await request.save();
    }
    
    req.updatedRequest = request;
    next();
  } catch (error) {
    console.error('Allocation status update middleware error:', error);
    res.status(500).json({
      message: 'Internal server error during status update',
      code: 'STATUS_UPDATE_ERROR'
    });
  }
};

module.exports = {
  validateExperimentDate,
  validateEditPermissions,
  updateAllocationStatus
};
