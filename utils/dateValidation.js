/**
 * Date validation utilities for request allocation system
 */

/**
 * Check if allocation is allowed based on experiment date and user role
 * @param {Date} experimentDate - The experiment date
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {Object} Validation result with allowed status and reason
 */
const isAllocationAllowed = (experimentDate, isAdmin = false) => {
  const today = new Date();
  const expDate = new Date(experimentDate);
  const gracePeriod = new Date(expDate);
  gracePeriod.setDate(gracePeriod.getDate() + 2);
  
  // Remove time component for accurate date comparison
  today.setHours(0, 0, 0, 0);
  expDate.setHours(0, 0, 0, 0);
  gracePeriod.setHours(0, 0, 0, 0);
  
  if (today <= expDate) {
    return { 
      allowed: true, 
      reason: null,
      daysRemaining: Math.ceil((expDate - today) / (1000 * 60 * 60 * 24))
    };
  }
  
  if (isAdmin && today <= gracePeriod) {
    return { 
      allowed: true, 
      reason: 'admin_grace',
      daysOverdue: Math.ceil((today - expDate) / (1000 * 60 * 60 * 24))
    };
  }
  
  return { 
    allowed: false, 
    reason: today > gracePeriod ? 'date_expired_completely' : 'date_expired_admin_only',
    daysOverdue: Math.ceil((today - expDate) / (1000 * 60 * 60 * 24))
  };
};

/**
 * Get allocation status for a single experiment
 * @param {Object} experiment - The experiment object
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {Object} Allocation status with detailed information
 */
const getExperimentAllocationStatus = (experiment, isAdmin = false) => {
  const dateStatus = isAllocationAllowed(experiment.date, isAdmin);
  
  // Check admin override
  if (experiment.allocationStatus?.adminOverride && isAdmin) {
    dateStatus.allowed = true;
    dateStatus.reason = 'admin_override';
  }
  
  if (!dateStatus.allowed) {
    let reason;
    if (dateStatus.reason === 'date_expired_completely') {
      reason = `Experiment date (${new Date(experiment.date).toLocaleDateString()}) expired beyond grace period (${dateStatus.daysOverdue} days overdue)`;
    } else {
      reason = `Experiment date (${new Date(experiment.date).toLocaleDateString()}) expired - Admin access available (${dateStatus.daysOverdue} days overdue)`;
    }
    
    return {
      canAllocate: false,
      reason,
      reasonType: dateStatus.reason,
      dateStatus: dateStatus.reason,
      daysOverdue: dateStatus.daysOverdue
    };
  }
  
  // Count allocatable items
  const unallocatedItems = [
    ...(experiment.chemicals?.filter(item => !item.isAllocated && !item.isDisabled) || []),
    ...(experiment.glassware?.filter(item => !item.isAllocated && !item.isDisabled) || []),
    ...(experiment.equipment?.filter(item => !item.isAllocated && !item.isDisabled) || [])
  ];
  
  // Count re-enabled items (previously disabled but now enabled)
  const reenabledItems = [
    ...(experiment.chemicals?.filter(item => item.wasDisabled && !item.isDisabled && !item.isAllocated) || []),
    ...(experiment.glassware?.filter(item => item.wasDisabled && !item.isDisabled && !item.isAllocated) || []),
    ...(experiment.equipment?.filter(item => item.wasDisabled && !item.isDisabled && !item.isAllocated) || [])
  ];
  
  const totalAllocatableItems = unallocatedItems.length + reenabledItems.length;
  
  if (totalAllocatableItems === 0) {
    return {
      canAllocate: false,
      reason: 'All items are either allocated or disabled',
      reasonType: 'fully_allocated',
      pendingItems: 0,
      reenabledItems: 0
    };
  }
  
  return {
    canAllocate: true,
    reason: null,
    reasonType: 'allocatable',
    pendingItems: unallocatedItems.length,
    reenabledItems: reenabledItems.length,
    daysRemaining: dateStatus.daysRemaining,
    adminOverride: experiment.allocationStatus?.adminOverride || false
  };
};

/**
 * Get edit permissions for a specific item
 * @param {Object} item - The item to check
 * @param {Date} experimentDate - The experiment date
 * @param {boolean} isAdmin - Whether the user is an admin
 * @param {number} availableInventory - Available quantity in inventory
 * @returns {Object} Edit permissions and constraints
 */
const getItemEditPermissions = (item, experimentDate, isAdmin = false, availableInventory = 0) => {
  const dateStatus = isAllocationAllowed(experimentDate, isAdmin);
  
  // No editing allowed if date expired completely (even for admin)
  if (!dateStatus.allowed && dateStatus.reason === 'date_expired_completely') {
    return { 
      canEdit: false, 
      canIncrease: false, 
      canDisable: false, 
      canEnable: false,
      reason: 'Experiment date expired beyond grace period'
    };
  }
  
  const permissions = {
    canEdit: dateStatus.allowed && (!item.isAllocated || item.isDisabled),
    canIncrease: dateStatus.allowed && item.isAllocated && availableInventory > item.quantity,
    canDisable: dateStatus.allowed && !item.isAllocated,
    canEnable: dateStatus.allowed && item.isDisabled,
    maxIncrease: Math.max(0, availableInventory - item.quantity),
    reason: null
  };
  
  if (!dateStatus.allowed) {
    permissions.reason = 'Date expired - admin access only';
  }
  
  return permissions;
};

/**
 * Validate bulk allocation request
 * @param {Array} experiments - Array of experiments to allocate
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {Object} Validation result
 */
const validateBulkAllocation = (experiments, isAdmin = false) => {
  const results = {
    valid: true,
    errors: [],
    warnings: [],
    experimentStatuses: []
  };
  
  experiments.forEach((exp, index) => {
    const status = getExperimentAllocationStatus(exp, isAdmin);
    results.experimentStatuses.push({
      experimentId: exp._id,
      experimentName: exp.experimentName,
      ...status
    });
    
    if (!status.canAllocate) {
      if (status.reasonType === 'date_expired_completely') {
        results.valid = false;
        results.errors.push(`Experiment "${exp.experimentName}": ${status.reason}`);
      } else {
        results.warnings.push(`Experiment "${exp.experimentName}": ${status.reason}`);
      }
    }
  });
  
  return results;
};

/**
 * Update allocation status for an experiment
 * @param {Object} experiment - The experiment to update
 * @param {boolean} isAdmin - Whether the user is an admin
 * @returns {Object} Updated allocation status
 */
const updateExperimentAllocationStatus = (experiment, isAdmin = false) => {
  const status = getExperimentAllocationStatus(experiment, isAdmin);
  
  experiment.allocationStatus = {
    ...experiment.allocationStatus,
    canAllocate: status.canAllocate,
    reason: status.reason,
    reasonType: status.reasonType,
    lastChecked: new Date()
  };
  
  return experiment.allocationStatus;
};

module.exports = {
  isAllocationAllowed,
  getExperimentAllocationStatus,
  getItemEditPermissions,
  validateBulkAllocation,
  updateExperimentAllocationStatus
};
