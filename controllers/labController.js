const Lab = require('../models/Lab');
const { syncLabChanges, bulkSyncLabs, findOrphanedLabReferences } = require('../middleware/labSyncMiddleware');
const asyncHandler = require('express-async-handler');

// @desc    Get all labs
// @route   GET /api/labs
// @access  Private
const getLabs = asyncHandler(async (req, res) => {
  const { includeInactive } = req.query;
  
  const filter = includeInactive === 'true' ? {} : { isActive: true };
  
  const labs = await Lab.find(filter)
    .sort({ isSystem: -1, labId: 1 }) // System labs first, then alphabetical
    .select('-__v');

  res.status(200).json({
    success: true,
    count: labs.length,
    data: labs
  });
});

// @desc    Get single lab
// @route   GET /api/labs/:labId
// @access  Private
const getLab = asyncHandler(async (req, res) => {
  const lab = await Lab.findOne({ labId: req.params.labId });

  if (!lab) {
    res.status(404);
    throw new Error('Lab not found');
  }

  res.status(200).json({
    success: true,
    data: lab
  });
});

// @desc    Create new lab
// @route   POST /api/labs
// @access  Private (Admin only)
const createLab = asyncHandler(async (req, res) => {
  const { labId, labName, description } = req.body;

  // Check if lab already exists
  const existingLab = await Lab.findOne({ labId });
  if (existingLab) {
    res.status(400);
    throw new Error('Lab with this ID already exists');
  }

  // Prevent creation of central-store (it should be seeded)
  if (labId === 'central-store') {
    res.status(400);
    throw new Error('central-store is a system lab and cannot be created manually');
  }

  const lab = await Lab.create({
    labId,
    labName,
    description,
    isSystem: false,
    createdBy: req.user._id,
    lastModifiedBy: req.user._id
  });

  console.log(`✅ Lab created: ${labId} by ${req.user.email}`);

  res.status(201).json({
    success: true,
    message: 'Lab created successfully',
    data: lab
  });
});

// @desc    Update lab
// @route   PUT /api/labs/:labId
// @access  Private (Admin only)
const updateLab = asyncHandler(async (req, res) => {
  const { labId } = req.params;
  const { labName, description, isActive } = req.body;

  const lab = await Lab.findOne({ labId });

  if (!lab) {
    res.status(404);
    throw new Error('Lab not found');
  }

  // Prepare update data
  const updateData = {
    lastModifiedBy: req.user._id
  };

  // Only allow labName and description changes for system labs
  if (lab.isSystem) {
    if (labName !== undefined) updateData.labName = labName;
    if (description !== undefined) updateData.description = description;
    
    // Don't allow isActive changes for central-store
    if (labId !== 'central-store' && isActive !== undefined) {
      updateData.isActive = isActive;
    }
  } else {
    // Non-system labs can change everything except labId
    if (labName !== undefined) updateData.labName = labName;
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;
  }

  const updatedLab = await Lab.findOneAndUpdate(
    { labId },
    updateData,
    { new: true, runValidators: true }
  );

  // Sync changes across all related documents
  try {
    await syncLabChanges({
      labId: updatedLab.labId,
      labName: updatedLab.labName,
      description: updatedLab.description,
      isActive: updatedLab.isActive
    });

    console.log(`✅ Lab updated and synced: ${labId} by ${req.user.email}`);
  } catch (syncError) {
    console.error(`⚠️ Lab updated but sync failed for ${labId}:`, syncError.message);
    // Still return success but mention sync issue
  }

  res.status(200).json({
    success: true,
    message: 'Lab updated successfully',
    data: updatedLab
  });
});

// @desc    Delete lab
// @route   DELETE /api/labs/:labId
// @access  Private (Admin only)
const deleteLab = asyncHandler(async (req, res) => {
  const { labId } = req.params;

  const lab = await Lab.findOne({ labId });

  if (!lab) {
    res.status(404);
    throw new Error('Lab not found');
  }

  if (lab.isSystem) {
    res.status(400);
    throw new Error('Cannot delete system lab');
  }

  // Check if lab is referenced in any inventory or user documents
  const ChemicalLive = require('../models/ChemicalLive');
  const EquipmentLive = require('../models/EquipmentLive');
  const GlasswareLive = require('../models/GlasswareLive');
  const OtherProductLive = require('../models/OtherProductLive');
  const User = require('../models/User');

  const inventoryCount = await Promise.all([
    ChemicalLive.countDocuments({ labId }),
    EquipmentLive.countDocuments({ labId }),
    GlasswareLive.countDocuments({ labId }),
    OtherProductLive.countDocuments({ labId })
  ]);

  const userCount = await User.countDocuments({ labId });
  const totalReferences = inventoryCount.reduce((sum, count) => sum + count, 0) + userCount;

  if (totalReferences > 0) {
    res.status(400);
    throw new Error(`Cannot delete lab. It is referenced in ${totalReferences} documents. Deactivate it instead.`);
  }

  await Lab.deleteOne({ labId });

  console.log(`✅ Lab deleted: ${labId} by ${req.user.email}`);

  res.status(200).json({
    success: true,
    message: 'Lab deleted successfully'
  });
});

// @desc    Bulk sync all labs
// @route   POST /api/labs/bulk-sync
// @access  Private (Admin only)
const bulkSync = asyncHandler(async (req, res) => {
  console.log(`🔄 Bulk lab sync triggered by ${req.user.email}`);

  try {
    const result = await bulkSyncLabs();

    res.status(200).json({
      success: true,
      message: 'Bulk lab sync completed',
      data: result
    });
  } catch (error) {
    console.error('❌ Bulk lab sync failed:', error);
    res.status(500);
    throw new Error('Bulk sync failed: ' + error.message);
  }
});

// @desc    Check lab consistency
// @route   GET /api/labs/consistency-check
// @access  Private (Admin only)
const consistencyCheck = asyncHandler(async (req, res) => {
  try {
    const orphanedRefs = await findOrphanedLabReferences();
    
    res.status(200).json({
      success: true,
      message: orphanedRefs.length > 0 ? 'Found orphaned lab references' : 'All lab references are consistent',
      data: {
        hasOrphanedRefs: orphanedRefs.length > 0,
        orphanedReferences: orphanedRefs
      }
    });
  } catch (error) {
    console.error('❌ Consistency check failed:', error);
    res.status(500);
    throw new Error('Consistency check failed: ' + error.message);
  }
});

// @desc    Get lab statistics
// @route   GET /api/labs/stats
// @access  Private (Admin only)
const getLabStats = asyncHandler(async (req, res) => {
  try {
    const ChemicalLive = require('../models/ChemicalLive');
    const EquipmentLive = require('../models/EquipmentLive');
    const GlasswareLive = require('../models/GlasswareLive');
    const OtherProductLive = require('../models/OtherProductLive');
    const User = require('../models/User');

    const labs = await Lab.find({ isActive: true });
    const stats = [];

    for (const lab of labs) {
      const labStat = {
        labId: lab.labId,
        labName: lab.labName,
        isSystem: lab.isSystem,
        inventory: {
          chemicals: await ChemicalLive.countDocuments({ labId: lab.labId }),
          equipment: await EquipmentLive.countDocuments({ labId: lab.labId }),
          glassware: await GlasswareLive.countDocuments({ labId: lab.labId }),
          others: await OtherProductLive.countDocuments({ labId: lab.labId })
        },
        users: await User.countDocuments({ labId: lab.labId })
      };

      labStat.inventory.total = Object.values(labStat.inventory).reduce((sum, count) => sum + count, 0);
      stats.push(labStat);
    }

    res.status(200).json({
      success: true,
      data: {
        totalLabs: labs.length,
        systemLabs: labs.filter(l => l.isSystem).length,
        customLabs: labs.filter(l => !l.isSystem).length,
        labStats: stats
      }
    });
  } catch (error) {
    console.error('❌ Lab stats failed:', error);
    res.status(500);
    throw new Error('Failed to get lab statistics: ' + error.message);
  }
});

// @desc    Get assignable labs (excludes central-store)
// @route   GET /api/labs/assignable
// @access  Private (Admin only)
const getAssignableLabs = asyncHandler(async (req, res) => {
  const labs = await Lab.find({ 
    isActive: true, 
    labId: { $ne: 'central-store' } 
  })
    .sort({ labName: 1 })
    .select('labId labName description');

  res.status(200).json({
    success: true,
    count: labs.length,
    data: labs
  });
});

module.exports = {
  getLabs,
  getLab,
  createLab,
  updateLab,
  deleteLab,
  bulkSync,
  consistencyCheck,
  getLabStats,
  getAssignableLabs
};
