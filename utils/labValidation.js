// Lab validation utilities for dynamic lab management
const Lab = require('../models/Lab');

/**
 * Custom validation function for labId fields in models
 * Replaces static enum validation with dynamic lab lookup
 */
async function validateLabId(labId) {
  if (!labId) {
    return false;
  }
  
  // Always allow central-store (system lab)
  if (labId === 'central-store') {
    return true;
  }
  
  try {
    // Check if lab exists and is active
    const lab = await Lab.findOne({ labId, isActive: true });
    return !!lab;
  } catch (error) {
    console.error('Lab validation error:', error);
    return false;
  }
}

/**
 * Get lab information for a given labId
 */
async function getLabInfo(labId) {
  if (labId === 'central-store') {
    return {
      labId: 'central-store',
      labName: 'Central Store',
      isSystem: true
    };
  }
  
  try {
    const lab = await Lab.findOne({ labId, isActive: true }).select('labId labName description isSystem');
    return lab;
  } catch (error) {
    console.error('Error fetching lab info:', error);
    return null;
  }
}

/**
 * Get all active lab IDs for validation
 */
async function getAllActiveLabIds() {
  try {
    const labs = await Lab.find({ isActive: true }).distinct('labId');
    return labs;
  } catch (error) {
    console.error('Error fetching active lab IDs:', error);
    return ['central-store']; // Fallback to at least central-store
  }
}

/**
 * Middleware to validate labId in request body/params
 */
function validateLabIdMiddleware(fieldName = 'labId') {
  return async (req, res, next) => {
    const labId = req.body[fieldName] || req.params[fieldName];
    
    if (!labId) {
      return res.status(400).json({
        success: false,
        message: `${fieldName} is required`
      });
    }
    
    const isValid = await validateLabId(labId);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: `Invalid ${fieldName}: ${labId}. Lab does not exist or is inactive.`
      });
    }
    
    // Attach lab info to request for potential use in controller
    const labInfo = await getLabInfo(labId);
    req.labInfo = labInfo;
    
    next();
  };
}

/**
 * Bulk validate multiple lab IDs
 */
async function validateMultipleLabIds(labIds) {
  if (!Array.isArray(labIds)) {
    return { valid: false, invalidLabs: [labIds] };
  }
  
  const validationResults = await Promise.all(
    labIds.map(async (labId) => ({
      labId,
      isValid: await validateLabId(labId)
    }))
  );
  
  const invalidLabs = validationResults
    .filter(result => !result.isValid)
    .map(result => result.labId);
  
  return {
    valid: invalidLabs.length === 0,
    invalidLabs
  };
}

/**
 * Generate lab options for frontend dropdowns
 */
async function getLabOptions() {
  try {
    const labs = await Lab.find({ isActive: true })
      .select('labId labName description isSystem')
      .sort({ isSystem: -1, labId: 1 }); // System labs first
    
    return labs.map(lab => ({
      value: lab.labId,
      label: lab.labName,
      description: lab.description,
      isSystem: lab.isSystem
    }));
  } catch (error) {
    console.error('Error fetching lab options:', error);
    return [
      { value: 'central-store', label: 'Central Store', isSystem: true }
    ];
  }
}

module.exports = {
  validateLabId,
  getLabInfo,
  getAllActiveLabIds,
  validateLabIdMiddleware,
  validateMultipleLabIds,
  getLabOptions
};
