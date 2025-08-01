const Request = require('../models/Request');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');
const { logTransaction } = require('../utils/transactionLogger');
const ChemicalLive = require('../models/ChemicalLive');
const Transaction = require('../models/Transaction');
const Experiment = require('../models/Experiment');
const mongoose = require('mongoose');
const { 
  isAllocationAllowed, 
  getExperimentAllocationStatus, 
  getItemEditPermissions,
  validateBulkAllocation,
  updateExperimentAllocationStatus
} = require('../utils/dateValidation');

// Helper function to calculate request status considering disabled items and date restrictions
const calculateRequestStatus = (request, isAdmin = false) => {
  let totalItems = 0;
  let allocatedItems = 0;
  let allocatableItems = 0; // Items that can still be allocated (not disabled and within date)
  
  for (const experiment of request.experiments) {
    const dateStatus = isAllocationAllowed(experiment.date, isAdmin);
    const hasOverride = experiment.allocationStatus?.adminOverride && isAdmin;
    const canAllocateForDate = dateStatus.allowed || hasOverride;
    
    ['chemicals', 'glassware', 'equipment'].forEach(itemType => {
      const items = experiment[itemType] || [];
      
      items.forEach(item => {
        totalItems++;
        
        if (item.isAllocated) {
          allocatedItems++;
        } else if (!item.isDisabled && canAllocateForDate) {
          allocatableItems++;
        }
      });
    });
  }
  
  // If all items are allocated, status is fulfilled
  if (totalItems > 0 && allocatedItems === totalItems) {
    return 'fulfilled';
  }
  
  // If some items are allocated, status is partially_fulfilled
  if (allocatedItems > 0) {
    return 'partially_fulfilled';
  }
  
  // If no items are allocated but some are allocatable, keep current status
  // This prevents automatically changing approved requests to partially_fulfilled
  if (allocatableItems > 0) {
    return request.status; // Keep current status
  }
  
  // If no items can be allocated (all disabled or dates expired), 
  // but we have allocated items, it's partially fulfilled
  if (allocatedItems > 0) {
    return 'partially_fulfilled';
  }
  
  return request.status; // Keep current status
};

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Helper function to validate allocation input
const validateAllocationInput = (chemical) => {
  const errors = [];
  
  if (!chemical.chemicalName || typeof chemical.chemicalName !== 'string' || chemical.chemicalName.trim() === '') {
    errors.push('Chemical name is required and must be a non-empty string');
  }
  
  if (!chemical.quantity || typeof chemical.quantity !== 'number' || chemical.quantity <= 0) {
    errors.push('Quantity must be a positive number');
  }
  
  if (!chemical.unit || typeof chemical.unit !== 'string' || chemical.unit.trim() === '') {
    errors.push('Unit is required and must be a non-empty string');
  }
  
  return errors;
};

// @desc    Approve, reject or fulfill a request
// @route   POST /api/requests/approve
// @access  Private (Admin/Lab Assistant)
exports.approveRequest = asyncHandler(async (req, res) => {
  const { requestId, status, force = false } = req.body;
  const adminId = req.userId;

  const validStatuses = ['approved', 'rejected', 'fulfilled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ msg: 'Invalid status value.' });
  }

  const request = await Request.findById(requestId)
    .populate('facultyId', 'name email')
    .populate('experiments.experimentId');
  
  if (!request) {
    return res.status(404).json({ msg: 'Request not found.' });
  }

  if (status === 'fulfilled') {
    const labId = request.labId;
    const unfulfilledChemicals = [];
    const fulfilledChemicals = [];

    // Check stock for each chemical
    for (const experiment of request.experiments) {
      for (const chem of experiment.chemicals) {
        // Skip already allocated chemicals
        if (chem.isAllocated) continue;

        const { chemicalName, quantity, unit } = chem;
        const labStock = await ChemicalLive.findOne({ chemicalName, labId });

        if (!labStock || labStock.quantity < quantity) {
          unfulfilledChemicals.push({
            chemicalName,
            availableQuantity: labStock?.quantity || 0,
            requiredQuantity: quantity,
            reason: labStock ? 'Insufficient stock' : 'Not found in lab',
          });
        } else {
          fulfilledChemicals.push({ 
            experimentId: experiment.experimentId,
            experimentName: experiment.experimentName,
            chemicalName, 
            quantity, 
            unit,
            chemicalMasterId: chem.chemicalMasterId
          });
        }
      }
    }

    // If some are unavailable, return list and await frontend confirmation
    if (unfulfilledChemicals.length > 0 && !force) {
      return res.status(206).json({
        msg: 'Some chemicals are unavailable or insufficient. Proceed with available chemicals only?',
        partiallyAvailable: fulfilledChemicals,
        unavailable: unfulfilledChemicals,
        requiresConfirmation: true,
      });
    }

    // Process available chemicals
    for (const chem of fulfilledChemicals) {
      const { chemicalName, quantity, unit, experimentId, chemicalMasterId } = chem;
      const labStock = await ChemicalLive.findOne({ chemicalName, labId });

      // Update chemical stock
      labStock.quantity -= quantity;
      await labStock.save();

      // Record transaction
      await Transaction.create({
        transactionType: 'transfer',
        chemicalName,
        fromLabId: labId,
        toLabId: "faculty",
        chemicalLiveId: labStock._id,
        quantity,
        unit,
        createdBy: adminId,
        timestamp: new Date(),
      });

      // Update allocation status in request
      const experiment = request.experiments.find(e => e.experimentId.equals(experimentId));
      const chemical = experiment.chemicals.find(c => 
        c.chemicalName === chemicalName && 
        (!c.chemicalMasterId || c.chemicalMasterId.equals(chemicalMasterId))
      );

      chemical.allocatedQuantity = quantity;
      chemical.isAllocated = true;
      chemical.allocationHistory.push({
        date: new Date(),
        quantity,
        allocatedBy: adminId
      });
    }

    // Update overall request status using smart calculation
    const userRole = req.user?.role;
    const isAdminUser = userRole === 'admin';
    request.status = calculateRequestStatus(request, isAdminUser);
  } else {
    // Approve or reject
    request.status = status;
  }

  request.updatedBy = adminId;
  await request.save();

  await logTransaction({
    requestId,
    status: request.status,
    adminId,
    action: 'Approval/Reject/Fulfill',
    date: new Date(),
  });

  const notification = new Notification({
    userId: request.facultyId,
    message: `Your chemical request has been ${request.status.replace('_', ' ')}.`,
    type: 'request',
    relatedRequest: request._id
  });
  await notification.save();

  res.status(200).json({
    msg: `Request ${request.status} successfully.`,
    request
  });
});

// @desc    Fulfill remaining chemicals, then allocate glassware and equipment
// @route   POST /api/requests/fulfill-remaining
// @access  Private (Admin/Lab Assistant)
exports.fulfillRemaining = asyncHandler(async (req, res) => {
  const { requestId } = req.body;
  const adminId = req.userId;

  const request = await Request.findById(requestId)
    .populate('facultyId', 'name email')
    .populate('experiments.experimentId');
  
  if (!request) {
    return res.status(404).json({ msg: 'Request not found.' });
  }

  if (request.status !== 'partially_fulfilled') {
    return res.status(400).json({ msg: 'Only partially fulfilled requests can have remaining fulfilled.' });
  }

  const labId = request.labId;
  const unfulfilledChemicals = [];
  const fulfilledChemicals = [];

  // Process only unallocated chemicals
  for (const experiment of request.experiments) {
    for (const chem of experiment.chemicals) {
      if (chem.isAllocated) continue;

      const { chemicalName, quantity, unit } = chem;
      const labStock = await ChemicalLive.findOne({ chemicalName, labId });

      if (!labStock || labStock.quantity < quantity) {
        unfulfilledChemicals.push({
          chemicalName,
          availableQuantity: labStock?.quantity || 0,
          requiredQuantity: quantity,
          reason: labStock ? 'Insufficient stock' : 'Not found in lab',
        });
      } else {
        fulfilledChemicals.push({
          experimentId: experiment.experimentId,
          experimentName: experiment.experimentName,
          chemicalName,
          quantity,
          unit,
          chemicalMasterId: chem.chemicalMasterId
        });
      }
    }
  }

  // Allocate available chemicals
  for (const chem of fulfilledChemicals) {
    const { chemicalName, quantity, unit, experimentId, chemicalMasterId } = chem;
    const labStock = await ChemicalLive.findOne({ chemicalName, labId });

    // Update chemical stock
    labStock.quantity -= quantity;
    await labStock.save();

    // Record transaction
    await Transaction.create({
      transactionType: 'transfer',
      chemicalName,
      fromLabId: labId,
      toLabId: "faculty",
      chemicalLiveId: labStock._id,
      quantity,
      unit,
      createdBy: adminId,
      timestamp: new Date(),
    });

    // Update allocation status
    const experiment = request.experiments.find(e => e.experimentId.equals(experimentId));
    const chemical = experiment.chemicals.find(c => 
      c.chemicalName === chemicalName && 
      (!c.chemicalMasterId || c.chemicalMasterId.equals(chemicalMasterId))
    );

    chemical.allocatedQuantity = quantity;
    chemical.isAllocated = true;
    chemical.allocationHistory.push({
      date: new Date(),
      quantity,
      allocatedBy: adminId
    });
  }

  // --- NEW: Allocate glassware ---
  const glasswareAllocations = [];
  for (const experiment of request.experiments) {
    for (const glass of (experiment.glassware || [])) {
      if (glass.isAllocated) continue;
      glasswareAllocations.push({
        glasswareId: glass.glasswareId,
        quantity: glass.quantity
      });
    }
  }
  let glasswareResult = null;
  if (glasswareAllocations.length > 0) {
    // Call glassware allocation controller (simulate internal API call)
    const glasswareController = require('./glasswareController');
    glasswareResult = await glasswareController.allocateGlasswareToFacultyInternal({
      allocations: glasswareAllocations,
      fromLabId: labId,
      adminId
    });
    // Mark glassware as allocated if successful
    if (glasswareResult.success) {
      for (const experiment of request.experiments) {
        for (const glass of (experiment.glassware || [])) {
          if (!glass.isAllocated && glasswareAllocations.find(g => g.glasswareId.toString() === glass.glasswareId.toString())) {
            glass.isAllocated = true;
            glass.allocationHistory = glass.allocationHistory || [];
            glass.allocationHistory.push({
              date: new Date(),
              quantity: glass.quantity,
              allocatedBy: adminId
            });
          }
        }
      }
    }
  }

  // --- NEW: Allocate equipment ---
  const equipmentAllocations = [];
  for (const experiment of request.experiments) {
    for (const equip of (experiment.equipment || [])) {
      if (equip.isAllocated) continue;
      // Expect equip to have a field: itemIds (array of itemId strings)
      equipmentAllocations.push({
        name: equip.name,
        variant: equip.variant,
        itemIds: equip.itemIds || []
      });
    }
  }
  let equipmentResult = null;
  if (equipmentAllocations.length > 0) {
    // Call equipment allocation controller (simulate internal API call)
    const equipmentController = require('./equipmentController');
    equipmentResult = await equipmentController.allocateEquipmentToFacultyInternal({
      allocations: equipmentAllocations,
      fromLabId: labId
    });
    // Mark equipment as allocated if successful
    if (equipmentResult.success) {
      for (const experiment of request.experiments) {
        for (const equip of (experiment.equipment || [])) {
          if (!equip.isAllocated && equipmentAllocations.find(e => e.name === equip.name && e.variant === equip.variant)) {
            equip.isAllocated = true;
            equip.allocationHistory = equip.allocationHistory || [];
            equip.allocationHistory.push({
              date: new Date(),
              quantity: (equip.itemIds || []).length,
              itemIds: equip.itemIds || [],
              allocatedBy: req.userId
            });
          }
        }
      }
    }
  }

  // Update request status using smart calculation
  const userRole = req.user?.role;
  const isAdminUser = userRole === 'admin';
  request.status = calculateRequestStatus(request, isAdminUser);
  request.updatedBy = adminId;
  await request.save();

  res.status(200).json({
    msg: `Successfully fulfilled chemicals, glassware, and equipment.`,
    unfulfilled: unfulfilledChemicals,
    glasswareResult,
    equipmentResult,
    request
  });
});

// @desc    Create a new unified request (chemicals, equipment, glassware)
// @route   POST /api/requests
// @access  Private (Faculty)
exports.createRequest = asyncHandler(async (req, res) => {
  const { labId, experiments } = req.body;
  const facultyId = req.userId;

  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  // Process experiments and validate course/batch for each
  const processedExperiments = await Promise.all(experiments.map(async exp => {
    const experiment = await Experiment.findById(exp.experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${exp.experimentId}`);
    }

    // Validate course and batch for this experiment
    if (!exp.courseId || !exp.batchId) {
      throw new Error(`Course and batch are required for experiment: ${experiment.name}`);
    }

    // Chemicals (existing logic)
    const chemicals = exp.chemicals || [];
    // Equipment (new unified logic)
    const equipment = exp.equipment || [];
    // Glassware (new unified logic)
    const glassware = exp.glassware || [];

    return {
      experimentId: experiment._id,
      experimentName: experiment.name,
      courseId: exp.courseId,
      batchId: exp.batchId,
      date: exp.date,
      chemicals,
      equipment,
      glassware
    };
  }));

  const newRequest = new Request({
    facultyId,
    labId,
    experiments: processedExperiments,
    status: 'pending',
    createdBy: facultyId
  });

  await newRequest.save();

  // Notify lab assistant
  const labAssistant = await User.findOne({ role: 'lab_assistant', labId });
  if (labAssistant) {
    const newNotification = new Notification({
      userId: labAssistant._id,
      message: `New request submitted by faculty for lab ${labId}.`,
      type: 'request',
      relatedRequest: newRequest._id
    });
    await newNotification.save();
  }

  res.status(201).json({
    message: 'Request created and lab assistant notified.',
    request: newRequest
  });
});

// @desc    Get experiments for request form
// @route   GET /api/requests/experiments
// @access  Private (Faculty)
exports.getExperimentsForRequest = asyncHandler(async (req, res) => {
  const { semester } = req.query;
  
  const experiments = await Experiment.find({ semester })
    .select('name subject description defaultChemicals averageUsage')
    .sort({ subject: 1, name: 1 });

  res.status(200).json(experiments);
});

// @desc    Get suggested chemicals for an experiment
// @route   GET /api/requests/experiments/:experimentId/suggested-chemicals
// @access  Private (Faculty)
exports.getSuggestedChemicalsForExperiment = asyncHandler(async (req, res) => {
  const { experimentId } = req.params;

  if (!isValidObjectId(experimentId)) {
    return res.status(400).json({ message: 'Invalid experiment ID format' });
  }

  const experiment = await Experiment.findById(experimentId);
  if (!experiment) {
    return res.status(404).json({ message: 'Experiment not found' });
  }

  // Get historical usage data
  const historicalRequests = await Request.find({
    'experiments.experimentId': experimentId
  }).select('experiments.chemicals');

  // Calculate average usage
  const chemicalUsage = {};
  historicalRequests.forEach(request => {
    request.experiments.forEach(exp => {
      if (exp.experimentId.toString() === experimentId) {
        exp.chemicals.forEach(chem => {
          if (!chemicalUsage[chem.chemicalName]) {
            chemicalUsage[chem.chemicalName] = {
              total: 0,
              count: 0,
              unit: chem.unit
            };
          }
          chemicalUsage[chem.chemicalName].total += chem.quantity;
          chemicalUsage[chem.chemicalName].count += 1;
        });
      }
    });
  });

  // Combine default chemicals with historical usage
  const suggestedChemicals = experiment.defaultChemicals.map(defaultChem => {
    const usage = chemicalUsage[defaultChem.chemicalName];
    return {
      chemicalName: defaultChem.chemicalName,
      quantity: usage ? usage.total / usage.count : defaultChem.quantity,
      unit: defaultChem.unit,
      chemicalMasterId: defaultChem.chemicalMasterId
    };
  });

  res.status(200).json({
    defaultChemicals: experiment.defaultChemicals,
    suggestedChemicals,
    historicalUsage: chemicalUsage
  });
});

// @desc    Get all chemical requests
// @route   GET /api/requests
// @access  Private (Admin/Lab Assistant)
exports.getAllRequests = asyncHandler(async (req, res) => {
  try    {
    const requests = await Request.find()
      .populate('facultyId', 'name email')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('experiments.experimentId', 'name subject')
      .populate('experiments.chemicals.chemicalMasterId')
      .populate('experiments.chemicals.allocationHistory.allocatedBy', 'name')
      .sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (err) {
    console.error('Error fetching all requests:', err);
    res.status(500).json({ msg: 'Server error fetching requests' });
  }
});

// @desc    Get all approved requests ready for allocation
// @route   GET /api/requests/approved
// @access  Private (Central Lab Admin)
exports.getApprovedRequests = asyncHandler(async (req, res) => {
  try {
    const requests = await Request.find({ status: 'approved' })
      .populate('facultyId', 'name email')
      .populate('labId', 'name')
      .populate('experiments.experimentId', 'name subject')
      .populate('experiments.courseId', 'courseName courseCode batches')
      .populate('approvalHistory.approvedBy', 'name')
      .sort({ 'approvalHistory.date': -1 }); // Sort by approval date (newest first)

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (err) {
    console.error('Error fetching approved requests:', err);
    res.status(500).json({ msg: 'Server error fetching approved requests' });
  }
});

// @desc    Get all unapproved requests
// @route   GET /api/requests/unapproved
// @access  Private (Admin)
exports.getUnapprovedRequests = asyncHandler(async (req, res) => {
  try {
    const requests = await Request.find({ status: 'pending' })
      .populate('facultyId', 'name email')
      .populate('labId', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (err) {
    console.error('Error fetching unapproved requests:', err);
    res.status(500).json({ msg: 'Server error fetching unapproved requests' });
  }
});

// @desc    Get requests by faculty ID
// @route   GET /api/requests/faculty
// @access  Private (Faculty)
exports.getRequestsByFacultyId = asyncHandler(async (req, res) => {
  try {
    const facultyId = req.userId;
    const requests = await Request.find({ facultyId })
      .populate('experiments.experimentId', 'name subject')
      .populate('experiments.courseId', 'courseName courseCode batches')
      .populate('experiments.chemicals.chemicalMasterId')
      .populate('experiments.chemicals.allocationHistory.allocatedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error('Error fetching faculty requests:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// @desc    Get requests by lab ID
// @route   GET /api/requests/lab/:labId
// @access  Private (Admin/Lab Assistant)
exports.getRequestsByLabId = asyncHandler(async (req, res) => {
  const { labId } = req.params;

  try {
    const requests = await Request.find({ labId })
      .populate('facultyId', 'name email')
      .populate('experiments.experimentId', 'name')
      .populate('experiments.courseId', 'courseName courseCode batches')
      .populate('experiments.chemicals.chemicalMasterId')
      .populate('experiments.chemicals.allocationHistory.allocatedBy', 'name')
      .sort({ createdAt: -1 });
    res.status(200).json(requests);
  } catch (err) {
    console.error(`Error fetching requests for lab ${labId}:`, err);
    res.status(500).json({ msg: 'Server error fetching lab requests' });
  }
});

// @desc    Get request by ID
// @route   GET /api/requests/:id
// @access  Private
exports.getRequestById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id)
    .populate('facultyId', 'name email')
    .populate('createdBy', 'name')
    .populate('updatedBy', 'name')
    .populate('experiments.experimentId', 'name subject description')
    .populate('experiments.chemicals.chemicalMasterId')
    .populate('experiments.chemicals.allocationHistory.allocatedBy', 'name');

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  res.status(200).json(request);
});

// @desc    Update request
// @route   PUT /api/requests/:id
// @access  Private (Faculty)
exports.updateRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { labId, experiments } = req.body;
  const facultyId = req.userId;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  // Only allow updates if request is pending
  if (request.status !== 'pending') {
    return res.status(400).json({ message: 'Can only update pending requests' });
  }

  // Only the creator can update the request
  if (!request.createdBy.equals(facultyId)) {
    return res.status(403).json({ message: 'Not authorized to update this request' });
  }

  // Process experiments
  const processedExperiments = await Promise.all(experiments.map(async exp => {
    const experiment = await Experiment.findById(exp.experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${exp.experimentId}`);
    }

    return {
      experimentId: experiment._id,
      experimentName: experiment.name,
      date: exp.date,
      session: exp.session,
      chemicals: exp.chemicals
    };
  }));

  // Update request
  request.labId = labId;
  request.experiments = processedExperiments;
  request.updatedBy = facultyId;
  await request.save();

  res.status(200).json(request);
});

// @desc    Delete request
// @route   DELETE /api/requests/:id
// @access  Private (Faculty)
exports.deleteRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const facultyId = req.userId;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  // Only allow deletion if request is pending
  if (request.status !== 'pending') {
    return res.status(400).json({ message: 'Can only delete pending requests' });
  }

  // Only the creator can delete the request
  if (!request.createdBy.equals(facultyId)) {
    return res.status(403).json({ message: 'Not authorized to delete this request' });
  }

  await Request.deleteOne({ _id: id });
  res.status(200).json({ message: 'Request deleted successfully' });
});

// @desc    Reject request
// @route   PUT /api/requests/:id/reject
// @access  Private (Admin/Lab Assistant)
exports.rejectRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.userId;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  request.status = 'rejected';
  request.updatedBy = adminId;
  await request.save();

  // Notify faculty
  const notification = new Notification({
    userId: request.facultyId,
    message: `Your chemical request has been rejected. ${reason ? 'Reason: ' + reason : ''}`,
    type: 'request',
    relatedRequest: request._id
  });
  await notification.save();

  res.status(200).json(request);
});

// @desc    Allocate chemicals to request
// @route   PUT /api/requests/:id/allocate
// @access  Private (Admin/Lab Assistant)
exports.allocateChemicals = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { chemicals } = req.body;
  const adminId = req.userId;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id)
    .populate('experiments.experimentId');

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  // Check lab stock before allocation
  const labId = request.labId;
  const stockIssues = [];

  for (const allocation of chemicals) {
    const { experimentId, chemicalName, quantity } = allocation;
    
    const labStock = await ChemicalLive.findOne({ chemicalName, labId });
    if (!labStock || labStock.quantity < quantity) {
      stockIssues.push({
        chemicalName,
        available: labStock ? labStock.quantity : 0,
        required: quantity
      });
    }
  }

  if (stockIssues.length > 0) {
    return res.status(400).json({
      message: 'Some chemicals have insufficient stock',
      stockIssues
    });
  }

  // Update chemical allocations
  for (const allocation of chemicals) {
    const { experimentId, chemicalName, quantity, unit, chemicalMasterId } = allocation;
    
    // Find the experiment and chemical
    const experiment = request.experiments.find(exp => exp.experimentId.equals(experimentId));
    if (!experiment) continue;
    
    const chemical = experiment.chemicals.find(chem => 
      chem.chemicalName === chemicalName && 
      (!chemicalMasterId || chem.chemicalMasterId.equals(chemicalMasterId))
    );
    
    if (!chemical) continue;

    // Update chemical stock
    const labStock = await ChemicalLive.findOne({ chemicalName, labId });
    labStock.quantity -= quantity;
    await labStock.save();

    // Record transaction
    await Transaction.create({
      transactionType: 'transfer',
      chemicalName,
      fromLabId: labId,
      toLabId: "faculty",
      chemicalLiveId: labStock._id,
      quantity,
      unit,
      createdBy: adminId,
      timestamp: new Date(),
    });

    // Update allocation
    chemical.allocatedQuantity = quantity;
    chemical.isAllocated = true;
    chemical.allocationHistory.push({
      date: new Date(),
      quantity,
      allocatedBy: adminId
    });
  }

  // Update request status
  const allAllocated = request.experiments.every(exp => 
    exp.chemicals.every(chem => chem.isAllocated)
  );
  request.status = allAllocated ? 'fulfilled' : 'partially_fulfilled';
  request.updatedBy = adminId;
  
  await request.save();

  res.status(200).json(request);
});

// @desc    Complete a fulfilled request
// @route   PUT /api/requests/:id/complete
// @access  Private (Admin/Lab Assistant)
exports.completeRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.userId;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);

  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  if (request.status !== 'fulfilled') {
    return res.status(400).json({ message: 'Can only complete fulfilled requests' });
  }

  request.status = 'completed';
  request.updatedBy = adminId;
  await request.save();

  // Notify faculty
  const notification = new Notification({
    userId: request.facultyId,
    message: 'Your chemical request has been completed and is ready for pickup.',
    type: 'request',
    relatedRequest: request._id
  });
  await notification.save();

  res.status(200).json(request);
});

// @desc    Allocate equipment to request (by itemIds)
// @route   PUT /api/requests/:id/allocate-equipment
// @access  Private (Admin/Lab Assistant)
exports.allocateEquipment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { allocations } = req.body; // [{ experimentId, name, variant, itemIds }]
  const adminId = req.userId;
  const {experimentId} = req.body;
  console.log("[allocateEquipment] called with params:", req.params, "body:", req.body);

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);
  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  const labId = request.labId;
  const equipmentController = require('./equipmentController');
  let allocationResults = [];

  for (const alloc of allocations) {
    const { experimentId, name, variant, itemIds } = alloc;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      allocationResults.push({ name, variant, success: false, message: 'No itemIds provided' });
      continue;
    }
    // Allocate in EquipmentLive and log
    const result = await equipmentController.allocateEquipmentToFacultyInternal({
      allocations: [{ name, variant, itemIds }],
      fromLabId: labId
    });
    allocationResults.push({ name, variant, success: result.success, message: result.message });
    // Update request allocationHistory
    const experiment = request.experiments.find(e => e.experimentId.equals(experimentId));
    if (!experiment) continue;
    const equip = (experiment.equipment || []).find(eq => eq.name === name && eq.variant === variant && !eq.isAllocated);
    if (!equip) continue;
    equip.isAllocated = true;
    equip.allocationHistory = equip.allocationHistory || [];
    equip.allocationHistory.push({
      date: new Date(),
      quantity: itemIds.length,
      itemIds: equip.itemIds || [],
      allocatedBy: adminId
    });
    // Log EquipmentTransaction and EquipmentAuditLog for each itemId
    const EquipmentTransaction = require('../models/EquipmentTransaction');
    const EquipmentAuditLog = require('../models/EquipmentAuditLog');
    for (const        itemId of itemIds) {
      await EquipmentTransaction.create({
        itemId,
        action: 'asign',
        performedBy: adminId,
        performedByRole: 'lab_assistant',
        fromLocation: labId || "central-lab",
        toLocation: 'faculty',
        assignedTo: 'faculty',
        remarks: 'Allocated to faculty (request allocation)',
        interface: 'web',
      });
      await EquipmentAuditLog.create({
        itemId,
        action: 'asign',
        performedBy: adminId,
        performedByRole: 'lab_assistant',
        remarks: 'Allocated to faculty (request allocation)',
        interface: 'web',
      });
    }
  }

  // Update request status
  const allAllocated = request.experiments.every(exp =>
    exp.chemicals.every(chem => chem.isAllocated) &&
    (exp.glassware ? exp.glassware.every(g => g.isAllocated) : true) &&
    (exp.equipment ? exp.equipment.every(e => e.isAllocated) : true)
  );
  request.status = allAllocated ? 'fulfilled' : 'partially_fulfilled';
  request.updatedBy = adminId;
  await request.save();

  res.status(200).json({
    msg: 'Equipment allocation complete',
    allocationResults,
    request
  });
});

// @desc    Admin approval for requests (separate from allocation)
// @route   PUT /api/requests/:id/admin-approve
// @access  Private (Admin only)
exports.adminApproveRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body; // action: 'approve' or 'reject'
  const adminId = req.userId;

  console.log('[adminApproveRequest] called with params:', req.params, 'body:', req.body);

  if (!isValidObjectId(id)) {
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'Invalid action. Must be "approve" or "reject"' });
  }

  const request = await Request.findById(id)
    .populate('facultyId', 'name email')
    .populate('experiments.experimentId', 'name');
  
  if (!request) {
    return res.status(404).json({ message: 'Request not found' });
  }

  // Only allow approval of pending requests
  if (request.status !== 'pending') {
    return res.status(400).json({ 
      message: `Cannot ${action} request with status: ${request.status}. Only pending requests can be approved/rejected.` 
    });
  }

  // Update request status
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  request.status = newStatus;
  request.updatedBy = adminId;
  
  // Add approval/rejection details
  if (!request.approvalHistory) {
    request.approvalHistory = [];
  }
  
  request.approvalHistory.push({
    action,
    approvedBy: adminId,
    reason: reason || '',
    date: new Date()
  });

  await request.save();

  // Log transaction
  await logTransaction({
    requestId: id,
    status: newStatus,
    adminId,
    action: `Admin ${action}`,
    date: new Date(),
    reason: reason || ''
  });

  // Notify faculty
  const notification = new Notification({
    userId: request.facultyId,
    message: `Your request has been ${action}d by admin.${reason ? ` Reason: ${reason}` : ''}`,
    type: 'request',
    relatedRequest: request._id
  });
  await notification.save();

  // If approved, notify central lab admin for allocation
  if (action === 'approve') {
    const centralLabAdmin = await User.findOne({ role: 'central_lab_admin' });
    if (centralLabAdmin) {
      const adminNotification = new Notification({
        userId: centralLabAdmin._id,
        message: `New approved request ready for allocation from ${request.facultyId.name}.`,
        type: 'request',
        relatedRequest: request._id
      });
      await adminNotification.save();
    }
  }

  res.status(200).json({
    message: `Request ${action}d successfully`,
    request,
    status: newStatus
  });
});

// @desc    Unified allocation for chemicals, equipment, and glassware
// @route   PUT /api/requests/:id/allocate-unified
// @access  Private (Central Lab Admin/Lab Assistant)
exports.allocateChemEquipGlass = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { equipment, glassware } = req.body; // Only equipment and glassware from body
  const adminId = req.userId;
  const userRole = req.user?.role;
  const isAdmin = userRole === 'admin';

  console.log('[allocateChemEquipGlass] called with params:', req.params, 'body:', req.body);

  if (!isValidObjectId(id)) {
    console.log('[allocateChemEquipGlass] Invalid request ID format:', id);
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);
  
  if (!request) {
    console.log('[allocateChemEquipGlass] Request not found:', id);
    return res.status(404).json({ message: 'Request not found' });
  }

  // *** NEW: Date validation for all experiments ***
  const dateValidationResult = validateBulkAllocation(request.experiments, isAdmin);
  
  if (!dateValidationResult.valid) {
    console.log('[allocateChemEquipGlass] Date validation failed:', dateValidationResult.errors);
    return res.status(403).json({ 
      message: 'Cannot allocate - experiment date restrictions',
      errors: dateValidationResult.errors,
      warnings: dateValidationResult.warnings,
      experimentStatuses: dateValidationResult.experimentStatuses,
      code: 'DATE_VALIDATION_FAILED'
    });
  }

  // Log warnings but continue if only warnings
  if (dateValidationResult.warnings.length > 0) {
    console.log('[allocateChemEquipGlass] Date validation warnings:', dateValidationResult.warnings);
  }

  // *** Status guard - only allow allocation of approved requests ***
  if (request.status !== 'approved') {
    console.log('[allocateChemEquipGlass] Request not approved for allocation:', request.status);
    return res.status(400).json({ 
      message: `Cannot allocate resources to request with status: ${request.status}. Only approved requests can be allocated.`,
      currentStatus: request.status,
      allowedStatus: 'approved'
    });
  }
  let experimentIds = [];
  if (request && request.experiments) {
    experimentIds = request.experiments.map(exp => exp.experimentId.toString());
  }
  if (!experimentIds || experimentIds.length === 0) {
    console.log('[allocateChemEquipGlass] No experiments found in request:', id);
    return res.status(400).json({ message: 'No experiments found in request' });
  }
  console.log('[allocateChemEquipGlass] Loaded request:', request ? request._id : null);
  if (!request) {
    console.log('[allocateChemEquipGlass] Request not found:', id);
    return res.status(404).json({ message: 'Request not found' });
  }

  const labId = request.labId;
  let chemResult = null, glassResult = null, equipResult = null;
  let errors = [];

  // --- 1. Enhanced Chemical Allocation with Fallback and Transaction Safety ---
  // Helper function for atomic chemical allocation with fallback
  async function allocateChemicalWithFallback(chemical, labId, adminId, session) {
    const { chemicalName, quantity, unit, chemicalMasterId } = chemical;
    let remainingQty = quantity;
    let allocations = [];
    let totalAllocated = 0;

    console.log(`[allocateChemicalWithFallback] Processing ${chemicalName}, requested: ${quantity}`);

    // 1. Try to allocate from requested lab first
    try {
      const labStock = await ChemicalLive.findOne({ chemicalName, labId }).session(session);
      if (labStock && labStock.quantity > 0) {
        const allocateFromLab = Math.min(labStock.quantity, remainingQty);
        
        // Atomic update with session
        const updatedLabStock = await ChemicalLive.findOneAndUpdate(
          { _id: labStock._id, quantity: { $gte: allocateFromLab } },
          { $inc: { quantity: -allocateFromLab } },
          { new: true, session }
        );
        
        if (updatedLabStock) {
          allocations.push({
            source: 'lab',
            fromLabId: labId,
            quantity: allocateFromLab,
            stockId: updatedLabStock._id,
            sourceName: `Lab ${labId}`
          });
          remainingQty -= allocateFromLab;
          totalAllocated += allocateFromLab;
          console.log(`[allocateChemicalWithFallback] Allocated ${allocateFromLab} from ${labId}, remaining: ${remainingQty}`);
        }
      }
    } catch (err) {
      console.error(`[allocateChemicalWithFallback] Error allocating from lab ${labId}:`, err);
    }

    // 2. If still need more, try central lab
    if (remainingQty > 0) {
      try {
        const centralStock = await ChemicalLive.findOne({ 
          chemicalName, 
          labId: 'central-lab' 
        }).session(session);
        
        if (centralStock && centralStock.quantity > 0) {
          const allocateFromCentral = Math.min(centralStock.quantity, remainingQty);
          
          // Atomic update with session
          const updatedCentralStock = await ChemicalLive.findOneAndUpdate(
            { _id: centralStock._id, quantity: { $gte: allocateFromCentral } },
            { $inc: { quantity: -allocateFromCentral } },
            { new: true, session }
          );
          
          if (updatedCentralStock) {
            allocations.push({
              source: 'central',
              fromLabId: 'central-lab',
              quantity: allocateFromCentral,
              stockId: updatedCentralStock._id,
              sourceName: 'Central Lab'
            });
            remainingQty -= allocateFromCentral;
            totalAllocated += allocateFromCentral;
            console.log(`[allocateChemicalWithFallback] Allocated ${allocateFromCentral} from central-lab, remaining: ${remainingQty}`);
          }
        }
      } catch (err) {
        console.error(`[allocateChemicalWithFallback] Error allocating from central-lab:`, err);
      }
    }

    // 3. Create transaction records for each allocation source
    const transactionPromises = allocations.map(allocation => 
      Transaction.create([{
        transactionType: 'transfer',
        chemicalName,
        fromLabId: allocation.fromLabId,
        toLabId: 'faculty',
        chemicalLiveId: allocation.stockId,
        quantity: allocation.quantity,
        unit,
        createdBy: adminId,
        timestamp: new Date(),
        notes: `Allocation from ${allocation.sourceName} (${allocation.quantity}/${quantity} total requested)`
      }], { session })
    );

    await Promise.all(transactionPromises);

    return {
      success: remainingQty === 0,
      allocations,
      remainingQty,
      totalAllocated,
      chemicalName,
      requestedQuantity: quantity
    };
  }

  // Main chemical allocation logic with session management
  const chemicalSession = await mongoose.startSession();
  try {
    chemicalSession.startTransaction();
    
    for (const experiment of request.experiments) {
      for (const chemical of experiment.chemicals) {
        if (chemical.isAllocated) continue;
        
        // Skip disabled items
        if (chemical.isDisabled) {
          console.log(`[allocateChemEquipGlass] Skipping disabled chemical: ${chemical.chemicalName}`);
          continue;
        }
        
        console.log(`[allocateChemEquipGlass] Allocating chemical: ${chemical.chemicalName}, quantity: ${chemical.quantity}`);
        
        // Validate chemical data
        const validationErrors = validateAllocationInput(chemical);
        if (validationErrors.length > 0) {
          errors.push({ 
            type: 'chemicals', 
            error: `Invalid chemical data for ${chemical.chemicalName}: ${validationErrors.join(', ')}`,
            details: { 
              chemicalName: chemical.chemicalName,
              quantity: chemical.quantity,
              unit: chemical.unit,
              validationErrors 
            }
          });
          continue;
        }

        // Attempt allocation with fallback
        const allocationResult = await allocateChemicalWithFallback(
          chemical, 
          labId, 
          adminId, 
          chemicalSession
        );

        if (allocationResult.success) {
          // Full allocation successful
          chemical.allocatedQuantity = allocationResult.totalAllocated;
          chemical.isAllocated = true;
          chemical.allocationHistory = chemical.allocationHistory || [];
          chemical.allocationHistory.push({
            date: new Date(),
            quantity: allocationResult.totalAllocated,
            allocatedBy: adminId,
            sources: allocationResult.allocations.map(a => ({
              source: a.sourceName,
              quantity: a.quantity
            }))
          });
          
          console.log(`[allocateChemEquipGlass] Successfully allocated ${allocationResult.totalAllocated} of ${chemical.chemicalName} from ${allocationResult.allocations.length} source(s)`);
          
        } else {
          // Partial or failed allocation
          if (allocationResult.totalAllocated > 0) {
            // Partial allocation
            chemical.allocatedQuantity = allocationResult.totalAllocated;
            chemical.isAllocated = false; // Mark as not fully allocated
            chemical.allocationHistory = chemical.allocationHistory || [];
            chemical.allocationHistory.push({
              date: new Date(),
              quantity: allocationResult.totalAllocated,
              allocatedBy: adminId,
              sources: allocationResult.allocations.map(a => ({
                source: a.sourceName,
                quantity: a.quantity
              })),
              isPartial: true
            });
          }
          
          errors.push({
            type: 'chemicals',
            error: `Partial allocation for ${chemical.chemicalName}`,
            details: {
              requested: allocationResult.requestedQuantity,
              allocated: allocationResult.totalAllocated,
              remaining: allocationResult.remainingQty,
              sources: allocationResult.allocations.map(a => ({
                source: a.sourceName,
                fromLabId: a.fromLabId,
                quantity: a.quantity
              })),
              availableSources: allocationResult.allocations.length
            }
          });
          
          console.log(`[allocateChemEquipGlass] Partial allocation for ${chemical.chemicalName}: ${allocationResult.totalAllocated}/${allocationResult.requestedQuantity}`);
        }
      }
    }
    
    await chemicalSession.commitTransaction();
    console.log('[allocateChemEquipGlass] Chemical allocation session committed successfully');
    
  } catch (err) {
    await chemicalSession.abortTransaction();
    console.error('[allocateChemEquipGlass] Chemical allocation session aborted due to error:', err);
    errors.push({ 
      type: 'chemicals', 
      error: `Chemical allocation failed: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    chemicalSession.endSession();
  }

  // --- 2. Allocate Glassware (if present in body) ---
  if (Array.isArray(glassware) && glassware.length > 0) {
    console.log('[allocateChemEquipGlass] Allocating glassware:', glassware);
    try {
      const GlasswareLive = require('../models/GlasswareLive');
      
      for (const g of glassware) {
        const { experimentId, glasswareId, quantity } = g;
        
        // Find the glassware in GlasswareLive collection
        const glasswareStock = await GlasswareLive.findById(glasswareId);
        if (!glasswareStock) {
          console.log(`[allocateChemEquipGlass] Glassware not found in live stock: ${glasswareId}`);
          errors.push({ type: 'glassware', error: `Glassware not found in stock: ${glasswareId}` });
          continue;
        }

        // Check if sufficient quantity is available
        if (glasswareStock.quantity < quantity) {
          console.log(`[allocateChemEquipGlass] Insufficient glassware stock for ${glasswareStock.name}: available ${glasswareStock.quantity}, requested ${quantity}`);
          errors.push({ 
            type: 'glassware', 
            error: `Insufficient stock for ${glasswareStock.name}: available ${glasswareStock.quantity}, requested ${quantity}` 
          });
          continue;
        }

        // Deduct the quantity from GlasswareLive
        glasswareStock.quantity -= quantity;
        await glasswareStock.save();
        console.log(`[allocateChemEquipGlass] Deducted ${quantity} from ${glasswareStock.name}, remaining: ${glasswareStock.quantity}`);

        // Find the experiment by either subdocument _id or experimentId
        const experiment = request.experiments.find(exp =>
          exp._id.equals(experimentId) || (exp.experimentId && exp.experimentId.equals(experimentId))
        );
        if (!experiment) {
          console.log(`[allocateChemEquipGlass] Experiment not found: ${experimentId}`);
          continue;
        }

        // Find the glassware item in the experiment
        const glass = (experiment.glassware || []).find(gl => gl.glasswareId.equals(glasswareId));
        if (!glass) {
          console.log(`[allocateChemEquipGlass] Glassware item not found in experiment: ${glasswareId}`);
          continue;
        }

        // Skip disabled items
        if (glass.isDisabled) {
          console.log(`[allocateChemEquipGlass] Skipping disabled glassware: ${glass.name}`);
          continue;
        }

        // Mark as allocated and update allocation history
        glass.isAllocated = true;
        glass.allocatedQuantity = quantity;
        glass.allocationHistory = glass.allocationHistory || [];
        glass.allocationHistory.push({
          date: new Date(),
          quantity: quantity,
          allocatedBy: adminId
        });
        
        console.log(`[allocateChemEquipGlass] Successfully allocated ${quantity} of ${glasswareStock.name}`);
      }
    } catch (err) {
      console.error('[allocateChemEquipGlass] Error in glassware allocation:', err);
      errors.push({ type: 'glassware', error: err.message });
    }
  }

  // --- 3. Robust Equipment Allocation ---
  if (Array.isArray(equipment) && equipment.length > 0) {
    console.log('[allocateChemEquipGlass] Allocating equipment:', equipment);
    try {
      const EquipmentTransaction = require('../models/EquipmentTransaction');
      const EquipmentAuditLog = require('../models/EquipmentAuditLog');
      const EquipmentLive = require('../models/EquipmentLive');

      for (const alloc of equipment) {
        let { experimentId, name, variant, itemIds, quantity: requestedQuantity } = alloc;
        
        // Validate itemIds array
        if (!Array.isArray(itemIds) || itemIds.length === 0) {
          errors.push({ type: 'equipment', error: `No itemIds provided for ${name} (${variant})` });
          continue;
        }

       

        // Find the experiment
        let experiment = request.experiments.find(exp =>
          (exp.experimentId && exp.experimentId.equals(experimentId)) || 
          (exp._id && exp._id.equals(experimentId))
        );
        
        if (!experiment) {
          errors.push({ type: 'equipment', error: `Experiment not found for equipment ${name} (${variant})` });
          continue;
        }

        // If experiment was found by _id but has experimentId, use that
        if (experiment.experimentId) {
          experimentId = experiment.experimentId;
        }

        // Find the equipment in experiment that needs allocation
        const equip = (experiment.equipment || []).find(eq => 
          eq.name === name && 
          eq.variant === variant && 
          !eq.isAllocated
        );
        
        if (!equip) {
          errors.push({ type: 'equipment', error: `Equipment ${name} (${variant}) not found or already allocated` });
          continue;
        }

        // Skip disabled items
        if (equip.isDisabled) {
          console.log(`[allocateChemEquipGlass] Skipping disabled equipment: ${equip.name} (${equip.variant})`);
          continue;
        }

        // Determine the required quantity (default to itemIds length if not specified)
        const requiredQuantity = requestedQuantity || equip.quantity || itemIds.length;
        
        let allocatedItems = [];
        let unallocatedItems = [];
        let invalidItems = [];

        for (const itemId of itemIds) {
          try {
            // Validate and convert itemId to ObjectId
          
                const item = await EquipmentLive.findOne({ itemId }).populate('itemId');

            if (!item) {
              invalidItems.push({ itemId, error: 'Item not found in database' });
              continue;
            }

            // Verify item matches requested equipment
            if (item.name !== name || item.variant !== variant) {
              console.log(`[allocateChemEquipGlass] Item ${itemId} type mismatch. Expected: ${name} (${variant}), Found: ${item.name} (${item.variant})`);
              invalidItems.push({ 
                itemId, 
                error: `Item type mismatch. Expected: ${name} (${variant}), Found: ${item.name} (${item.variant})` 
              });
              continue;
            }

            // Check item availability
            if (item.isAllocated || item.status !== 'Available') {
              // Special case: if item is allocated but in the same lab, we might still allocate it
              if (item.status === 'Issued' || item.status === 'issued' && item.location === labId) {
                // Allow allocation of items already allocated to this lab
              } else {
                console.log(`[allocateChemEquipGlass] Item ${itemId} not available for allocation. Status: ${item.status}, Location: ${item.Location}`);
                unallocatedItems.push({ 
                  itemId, 
                  error: `Item not available. Status: ${item.status}, Location: ${item.location}` 
                });
                continue;
              }
            }
            // Log the item allocation
            console.log(request.facultyId);
            const faculty = await User.findById(request.facultyId);
            if(!faculty) {
              console.log(`[allocateChemEquipGlass] Faculty not found for ID: ${request.facultyId}`);
            }

            // Allocate the item
            item.isAllocated = true;
            item.labId = labId; // Set labId for tracking
            item.status = 'Assigned';
            item.assignedTo = `${faculty.name}` || 'faculty';
            item.location =  labId || 'central-lab'; // Use labId if available, otherwise default to 'central-lab'
            item.allocatedTo =  ` At ${faculty.name}` || 'faculty'; // Use facultyId if available, otherwise default to 'faculty'
            item.lastUpdatedBy = adminId;
            item.lastUpdatedAt = new Date();
            
            await item.save();

            // Create transaction record
            await EquipmentTransaction.create({
              itemId: itemId,
              action: 'assign',
              performedBy: adminId  || req.userId || 'admin', 
              performedByRole: 'lab_assistant',
              fromLocation: labId,
              toLocation: 'faculty',
              assignedTo: faculty.name ||'faculty',
              remarks: `Allocated to faculty for experiment ${experimentId}`,
              interface: 'web',
              timestamp: new Date()
            });

            // Create audit log
            await EquipmentAuditLog.create({
              itemId: itemId,
              action: 'assign',
              performedBy: adminId  || req.userId || 'admin',
              performedByRole: 'lab_assistant',
              remarks: `Allocated to ${faculty.name} faculty for experiment ${experimentId}`,
              interface: 'web',
              timestamp: new Date()
            });

            allocatedItems.push(itemId);

            // Stop if we've allocated enough items
            if (allocatedItems.length >= requiredQuantity) {
              break;
            }

          } catch (err) {
            console.error(`Error processing item ${itemId}:`, err);
            invalidItems.push({ itemId, error: `Processing error: ${err.message}` });
          }
        }

        // Update equipment allocation status in the request
        equip.isAllocated = allocatedItems.length >= requiredQuantity;
        equip.allocatedQuantity = allocatedItems.length;
        equip.allocationHistory = equip.allocationHistory || [];
        equip.allocationHistory.push({
          date: new Date(),
          quantity: allocatedItems.length,
          itemIds: allocatedItems,
          allocatedBy: adminId,
          notes: `Requested ${requiredQuantity}, allocated ${allocatedItems.length}`
        });

        // Handle partial or failed allocations
        if (allocatedItems.length < requiredQuantity) {
          const errorMsg = `Partial allocation for ${name} (${variant}): requested ${requiredQuantity}, allocated ${allocatedItems.length}`;
          errors.push({
            type: 'equipment',
            error: errorMsg,
            details: {
              allocatedItems,
              unallocatedItems,
              invalidItems,
              requiredQuantity,
              actualAllocated: allocatedItems.length
            }
          });
        }
      }
    } catch (err) {
      console.error('[allocateChemEquipGlass] Error in equipment allocation:', err);
      errors.push({ 
        type: 'equipment', 
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  }

  // Update request status (exclude disabled items from allocation completion check)
  const allAllocated = request.experiments.every(exp =>
    exp.chemicals.filter(chem => !chem.isDisabled).every(chem => chem.isAllocated) &&
    (exp.glassware ? exp.glassware.filter(g => !g.isDisabled).every(g => g.isAllocated) : true) &&
    (exp.equipment ? exp.equipment.filter(e => !e.isDisabled).every(e => e.isAllocated) : true)
  );
  request.status = allAllocated ? 'fulfilled' : 'partially_fulfilled';
  request.updatedBy = adminId;
  await request.save();

  // Filter experiments for response
  const filteredExperiments = filterExperimentsForResponse(request.experiments);
  const filteredRequest = {
    ...request.toObject(),
    experiments: filteredExperiments
  };

  console.log('[allocateChemEquipGlass] Final allocation status:', request.status, 'Errors:', errors);

  res.status(errors.length > 0 ? 207 : 200).json({
    msg: 'Unified allocation complete',
    chemResult,
    glassResult,
    equipResult,
    errors,
    request: filteredRequest
  });
});

// Helper to filter experiments for response (only include chemicals, glassware, equipment if present)
function filterExperimentsForResponse(experiments) {
  return experiments.map(exp => {
    const filtered = {
      ...exp.toObject(),
      chemicals: Array.isArray(exp.chemicals) && exp.chemicals.length > 0 ? exp.chemicals : undefined,
      glassware: Array.isArray(exp.glassware) && exp.glassware.length > 0 ? exp.glassware : undefined,
      equipment: Array.isArray(exp.equipment) && exp.equipment.length > 0 ? exp.equipment : undefined,
    };
    // Remove undefined fields
    Object.keys(filtered).forEach(key => filtered[key] === undefined && delete filtered[key]);
    return filtered;
  });
}

// @desc    Get request stats (counts by status)
// @route   GET /api/requests/stats
// @access  Private (admin, central_lab_admin)
exports.getRequestStats = asyncHandler(async (req, res) => {
  const total = await Request.countDocuments();
  const pending = await Request.countDocuments({ status: 'pending' });
  const approved = await Request.countDocuments({ status: 'approved' });
  const partially_fulfilled = await Request.countDocuments({ status: 'partially_fulfilled' });
  const fulfilled = await Request.countDocuments({ status: 'fulfilled' });
  const rejected = await Request.countDocuments({ status: 'rejected' });
  const active = pending + approved + partially_fulfilled;
  res.status(200).json({ 
    total, 
    active, 
    pending, 
    approved, 
    partially_fulfilled, 
    fulfilled, 
    rejected 
  });
});

// @desc    Get all pending and partially fulfilled requests (all labs)
// @route   GET /api/requests/pending-overview
// @access  Private (admin, central_lab_admin)
exports.getPendingOverviewRequests = asyncHandler(async (req, res) => {
  const requests = await Request.find({ status: { $in: ['pending', 'partially_fulfilled'] } })
    .populate('facultyId', 'name email')
    .populate('labId', 'name')
    .sort({ createdAt: -1 });
  res.status(200).json({ count: requests.length, data: requests });
});

// @desc    Get all requests for dashboard feed
// @route   GET /api/requests/all
// @access  Private (Admin/Lab Assistant)
exports.getAllRequestsForDashboard = asyncHandler(async (req, res) => {
  try {
    const requests = await Request.find()
      .populate('facultyId', 'name email')
      .populate('labId', 'name')
      .sort({ createdAt: -1 });
    res.status(200).json({ count: requests.length, data: requests });
  } catch (err) {
    console.error('Error fetching all requests for dashboard:', err);
    res.status(500).json({ msg: 'Server error fetching requests' });
  }
});

// @desc    Admin edit request items (quantities, disable items) - supports bulk editing
// @route   PUT /api/requests/:id/admin-edit
// @access  Private (Admin only)
exports.adminEditRequest = asyncHandler(async (req, res) => {
  const { edits, reason } = req.body;
  const requestId = req.params.id;
  const adminId = req.userId;
  const userRole = req.user?.role;
  const isAdmin = userRole === 'admin';

  // Debug logging
  console.log('=== ADMIN EDIT REQUEST DEBUG ===');
  console.log('Request ID:', requestId);
  console.log('Admin ID:', adminId);
  console.log('Request Body:', JSON.stringify(req.body, null, 2));
  console.log('User Role:', req.user?.role);
  console.log('Edits received:', edits);
  console.log('Edits type:', typeof edits);
  console.log('Edits is array:', Array.isArray(edits));
  console.log('Reason:', reason);
  
  // Check for alternate body structure
  console.log('Raw req.body.edits:', req.body.edits);
  console.log('Raw req.body properties:', Object.keys(req.body));

  // 1. Verify admin permissions
  if (req.user.role !== 'admin') {
    console.log('ERROR: Admin access required. User role:', req.user.role);
    return res.status(403).json({ message: 'Admin access required' });
  }

  // 2. Validate input - support both single edit and bulk edits
  let editsArray = [];
  
  if (edits && Array.isArray(edits)) {
    console.log('Processing bulk edit format with', edits.length, 'edits');
    // Bulk edit format
    editsArray = edits;
  } else if (req.body.experimentId && req.body.itemType && req.body.itemId) {
    console.log('Processing single edit format');
    // Single edit format (backwards compatibility)
    const updates = {};
    if (req.body.newQuantity !== undefined) updates.newQuantity = req.body.newQuantity;
    if (req.body.disableItem !== undefined) updates.disableItem = req.body.disableItem;
    if (req.body.disableReason !== undefined) updates.disableReason = req.body.disableReason;
    
    editsArray = [{
      experimentId: req.body.experimentId,
      itemType: req.body.itemType,
      itemId: req.body.itemId,
      ...updates
    }];
    console.log('Converted to editsArray:', editsArray);
  } else {
    console.log('ERROR: Missing required fields');
    console.log('Available fields:', Object.keys(req.body));
    return res.status(400).json({ 
      message: 'Missing required fields: either provide edits array or experimentId, itemType, itemId with updates',
      received: Object.keys(req.body),
      body: req.body
    });
  }

  if (editsArray.length === 0) {
    console.log('ERROR: No edits provided');
    return res.status(400).json({ message: 'No edits provided' });
  }

  console.log('Final editsArray to process:', JSON.stringify(editsArray, null, 2));

  // 3. Find the request
  const request = await Request.findById(requestId);
  if (!request) {
    console.log('ERROR: Request not found:', requestId);
    return res.status(404).json({ message: 'Request not found' });
  }

  console.log('Request found. Processing', editsArray.length, 'edits...');

  // 3.5. Validate experiment dates for affected experiments
  const affectedExperiments = new Set();
  editsArray.forEach(edit => {
    if (edit.experimentId) {
      affectedExperiments.add(edit.experimentId);
    }
  });

  const dateValidationErrors = [];
  for (const experimentId of affectedExperiments) {
    const experiment = request.experiments.id(experimentId);
    if (experiment) {
      const dateStatus = isAllocationAllowed(experiment.date, isAdmin);
      
      // Check for admin override
      const hasOverride = experiment.allocationStatus?.adminOverride && isAdmin;
      
      if (!dateStatus.allowed && !hasOverride && dateStatus.reason === 'date_expired_completely') {
        dateValidationErrors.push({
          experimentId,
          experimentName: experiment.experimentName,
          date: experiment.date,
          error: `Experiment "${experiment.experimentName}" date expired beyond grace period (${dateStatus.daysOverdue} days overdue)`
        });
      }
    }
  }

  if (dateValidationErrors.length > 0) {
    console.log('ERROR: Date validation failed for experiments:', dateValidationErrors);
    return res.status(403).json({
      message: 'Cannot edit - experiment date restrictions',
      dateValidationErrors,
      code: 'DATE_VALIDATION_FAILED'
    });
  }

  const validItemTypes = ['chemicals', 'equipment', 'glassware'];
  const processedEdits = [];
  const errors = [];

  // 4. Process each edit
  for (let i = 0; i < editsArray.length; i++) {
    const edit = editsArray[i];
    const { experimentId, itemType, itemId } = edit;

    console.log(`\n--- Processing Edit ${i + 1} ---`);
    console.log('Edit data:', JSON.stringify(edit, null, 2));

    try {
      // Validate required fields for this edit
      if (!experimentId || !itemType || !itemId) {
        console.log('ERROR: Missing required fields for edit', i + 1);
        console.log('experimentId:', experimentId);
        console.log('itemType:', itemType);
        console.log('itemId:', itemId);
        errors.push(`Edit ${i + 1}: Missing experimentId, itemType, or itemId`);
        continue;
      }

      if (!validItemTypes.includes(itemType)) {
        console.log('ERROR: Invalid itemType:', itemType);
        errors.push(`Edit ${i + 1}: Invalid itemType '${itemType}'. Must be one of: ${validItemTypes.join(', ')}`);
        continue;
      }

      console.log('Looking for experiment with ID:', experimentId);
      console.log('Available experiments:', request.experiments.map(exp => ({ id: exp._id.toString(), experimentName: exp.experimentName })));

      // Find the experiment
      const experiment = request.experiments.id(experimentId);
      if (!experiment) {
        console.log('ERROR: Experiment not found in request');
        errors.push(`Edit ${i + 1}: Experiment not found in request`);
        continue;
      }

      console.log('Found experiment:', experiment.experimentName);
      console.log(`Looking for ${itemType} with ID:`, itemId);
      console.log(`Available ${itemType}:`, experiment[itemType]?.map(item => ({ id: item._id.toString(), name: item.name || item.chemicalName || item.glasswareName })));

      // Find the specific item
      const item = experiment[itemType].id(itemId);
      if (!item) {
        console.log('ERROR: Item not found in experiment');
        errors.push(`Edit ${i + 1}: ${itemType.slice(0, -1)} not found in experiment`);
        continue;
      }

      console.log('Found item:', { 
        name: item.name || item.chemicalName || item.glasswareName,
        currentQuantity: item.quantity,
        isDisabled: item.isDisabled 
      });

      // Store original quantity on first edit (if not already stored)
      if (!item.originalQuantity && edit.newQuantity !== undefined) {
        item.originalQuantity = item.quantity;
        console.log('Stored original quantity:', item.originalQuantity);
      }

      // Apply updates
      let hasChanges = false;
      console.log('Processing updates:', Object.keys(edit).filter(key => !['experimentId', 'itemType', 'itemId'].includes(key)));

      if (edit.newQuantity !== undefined) {
        console.log('Processing quantity update:', edit.newQuantity);
        const newQuantity = parseFloat(edit.newQuantity);
        if (isNaN(newQuantity) || newQuantity < 0) {
          console.log('ERROR: Invalid quantity:', edit.newQuantity);
          errors.push(`Edit ${i + 1}: Quantity must be a valid positive number`);
          continue;
        }
        
        console.log('Quantity validation passed. Old:', item.quantity, 'New:', newQuantity);
        console.log('Allocated quantity:', item.allocatedQuantity);
        
        // Check if trying to reduce below already allocated amount
        if (item.allocatedQuantity && newQuantity < item.allocatedQuantity) {
          console.log('ERROR: Cannot reduce below allocated amount');
          errors.push(`Edit ${i + 1}: Cannot reduce quantity below already allocated amount (${item.allocatedQuantity})`);
          continue;
        }
        
        if (item.quantity !== newQuantity) {
          console.log('Updating quantity from', item.quantity, 'to', newQuantity);
          item.quantity = newQuantity;
          hasChanges = true;
        } else {
          console.log('Quantity unchanged');
        }
      }

      if (edit.disableItem !== undefined) {
        console.log('Processing disable update:', edit.disableItem);
        const isDisabled = Boolean(edit.disableItem);
        if (item.isDisabled !== isDisabled) {
          item.isDisabled = isDisabled;
          hasChanges = true;
        }
        
        // If disabling, require a reason
        if (item.isDisabled && !edit.disableReason && !item.disabledReason) {
          errors.push(`Edit ${i + 1}: Disabled reason is required when disabling an item`);
          continue;
        }
      }

      if (edit.disableReason !== undefined) {
        console.log('Processing disable reason update:', edit.disableReason);
        if (item.disabledReason !== edit.disableReason) {
          console.log('Updating disable reason from', item.disabledReason, 'to', edit.disableReason);
          item.disabledReason = edit.disableReason;
          hasChanges = true;
        }
      }

      console.log('Edit processed. Has changes:', hasChanges);

      if (hasChanges) {
        processedEdits.push({
          experimentId,
          itemType,
          itemId,
          itemName: item.name || item.chemicalName,
          changes: edit
        });
        console.log('Added to processedEdits');
      }

    } catch (error) {
      console.log('ERROR in edit processing:', error.message);
      errors.push(`Edit ${i + 1}: ${error.message}`);
    }
  }

  console.log('\n=== PROCESSING COMPLETE ===');
  console.log('Processed edits:', processedEdits.length);
  console.log('Errors:', errors.length);
  if (errors.length > 0) {
    console.log('Error details:', errors);
  }

  // 5. Return errors if any occurred
  if (errors.length > 0) {
    console.log('Returning errors to client');
    return res.status(400).json({ 
      message: 'Some edits failed', 
      errors,
      processedCount: processedEdits.length
    });
  }

  if (processedEdits.length === 0) {
    console.log('No changes were made');
    return res.status(200).json({ 
      message: 'No changes were made',
      processedCount: 0
    });
  }

  console.log('Proceeding with save. Changes to be saved:', processedEdits.length);

  // 6. Update request-level edit tracking
  request.adminEdits = {
    hasEdits: true,
    lastEditedBy: adminId,
    lastEditedAt: new Date(),
    editSummary: reason || 'Request modified by admin'
  };

  console.log('Saving request...');
  // 7. Save the changes
  await request.save();
  console.log('Request saved successfully');

  // 8. Create notification for faculty
  try {
    await Notification.create({
      userId: request.facultyId,
      type: 'request_edited',
      title: 'Request Modified',
      message: `Your request has been modified by admin. ${reason || 'Please review the changes.'}`,
      relatedId: request._id,
      relatedType: 'Request'
    });
    console.log('Notification created successfully');
  } catch (notificationError) {
    console.error('Error creating notification:', notificationError);
    // Don't fail the request if notification fails
  }

  console.log('Sending success response');
  // 9. Return success response
  res.status(200).json({
    message: `Request updated successfully! ${processedEdits.length} items modified.`,
    processedCount: processedEdits.length,
    processedEdits,
    request: {
      _id: request._id,
      adminEdits: request.adminEdits,
      experiments: request.experiments
    }
  });
});

// @desc    Get allocation status for a request
// @route   GET /api/requests/:id/allocation-status
// @access  Private (Admin/Lab Assistant)
exports.getRequestAllocationStatus = asyncHandler(async (req, res) => {
  const requestId = req.params.id;
  const userRole = req.user?.role;
  const isAdmin = userRole === 'admin';

  // Validate request ID
  if (!isValidObjectId(requestId)) {
    return res.status(400).json({ 
      message: 'Invalid request ID format',
      code: 'INVALID_REQUEST_ID'
    });
  }

  const request = await Request.findById(requestId)
    .populate('facultyId', 'name email')
    .populate('experiments.experimentId');

  if (!request) {
    return res.status(404).json({ 
      message: 'Request not found',
      code: 'REQUEST_NOT_FOUND'
    });
  }

  // Get status for each experiment
  const experimentStatuses = request.experiments.map(exp => {
    const status = getExperimentAllocationStatus(exp, isAdmin);
    
    return {
      experimentId: exp._id,
      experimentName: exp.experimentName,
      date: exp.date,
      ...status,
      itemBreakdown: {
        chemicals: {
          total: exp.chemicals?.length || 0,
          allocated: exp.chemicals?.filter(item => item.isAllocated).length || 0,
          disabled: exp.chemicals?.filter(item => item.isDisabled).length || 0,
          pending: exp.chemicals?.filter(item => !item.isAllocated && !item.isDisabled).length || 0,
          reenabled: exp.chemicals?.filter(item => item.wasDisabled && !item.isDisabled && !item.isAllocated).length || 0
        },
        glassware: {
          total: exp.glassware?.length || 0,
          allocated: exp.glassware?.filter(item => item.isAllocated).length || 0,
          disabled: exp.glassware?.filter(item => item.isDisabled).length || 0,
          pending: exp.glassware?.filter(item => !item.isAllocated && !item.isDisabled).length || 0,
          reenabled: exp.glassware?.filter(item => item.wasDisabled && !item.isDisabled && !item.isAllocated).length || 0
        },
        equipment: {
          total: exp.equipment?.length || 0,
          allocated: exp.equipment?.filter(item => item.isAllocated).length || 0,
          disabled: exp.equipment?.filter(item => item.isDisabled).length || 0,
          pending: exp.equipment?.filter(item => !item.isAllocated && !item.isDisabled).length || 0,
          reenabled: exp.equipment?.filter(item => item.wasDisabled && !item.isDisabled && !item.isAllocated).length || 0
        }
      }
    };
  });

  // Overall request status
  const overallStatus = {
    canAllocateAny: experimentStatuses.some(exp => exp.canAllocate),
    totalExperiments: experimentStatuses.length,
    allocatableExperiments: experimentStatuses.filter(exp => exp.canAllocate).length,
    dateExpiredExperiments: experimentStatuses.filter(exp => exp.reasonType?.includes('date_expired')).length,
    fullyAllocatedExperiments: experimentStatuses.filter(exp => exp.reasonType === 'fully_allocated').length
  };

  res.json({
    requestId: request._id,
    requestStatus: request.status,
    faculty: {
      id: request.facultyId._id,
      name: request.facultyId.name,
      email: request.facultyId.email
    },
    labId: request.labId,
    overallStatus,
    experimentStatuses,
    lastUpdated: new Date()
  });
});

// @desc    Set admin override for experiment date
// @route   POST /api/requests/:id/experiments/:experimentId/admin-override
// @access  Private (Admin only)
exports.setAdminOverride = asyncHandler(async (req, res) => {
  const { id: requestId, experimentId } = req.params;
  const { reason, enable = true } = req.body;
  const adminId = req.user.userId;

  // Validate input
  if (!isValidObjectId(requestId) || !isValidObjectId(experimentId)) {
    return res.status(400).json({ 
      message: 'Invalid ID format',
      code: 'INVALID_ID_FORMAT'
    });
  }

  if (enable && (!reason || typeof reason !== 'string' || reason.trim().length === 0)) {
    return res.status(400).json({ 
      message: 'Reason is required when enabling admin override',
      code: 'REASON_REQUIRED'
    });
  }

  const request = await Request.findById(requestId);
  if (!request) {
    return res.status(404).json({ 
      message: 'Request not found',
      code: 'REQUEST_NOT_FOUND'
    });
  }

  const experiment = request.experiments.id(experimentId);
  if (!experiment) {
    return res.status(404).json({ 
      message: 'Experiment not found',
      code: 'EXPERIMENT_NOT_FOUND'
    });
  }

  // Check if override is actually needed
  const dateStatus = isAllocationAllowed(experiment.date, true);
  if (dateStatus.allowed && enable) {
    return res.status(400).json({ 
      message: 'Admin override not needed - experiment date is still valid',
      experimentDate: experiment.date,
      code: 'OVERRIDE_NOT_NEEDED'
    });
  }

  // Update admin override
  if (!experiment.allocationStatus) {
    experiment.allocationStatus = {};
  }

  experiment.allocationStatus.adminOverride = enable;
  experiment.allocationStatus.overrideReason = enable ? reason.trim() : null;
  experiment.allocationStatus.overrideBy = enable ? adminId : null;
  experiment.allocationStatus.overrideAt = enable ? new Date() : null;
  experiment.allocationStatus.lastChecked = new Date();

  // Update overall allocation status
  updateExperimentAllocationStatus(experiment, true);

  await request.save();

  // Create notification for faculty
  try {
    await Notification.create({
      userId: request.facultyId,
      title: enable ? 'Admin Override Enabled' : 'Admin Override Disabled',
      message: enable 
        ? `Admin has enabled allocation override for experiment "${experiment.experimentName}" with reason: ${reason}`
        : `Admin has disabled allocation override for experiment "${experiment.experimentName}"`,
      type: 'info',
      relatedId: request._id,
      relatedModel: 'Request'
    });
  } catch (notificationError) {
    console.error('Error creating notification:', notificationError);
  }

  res.json({
    message: enable ? 'Admin override enabled successfully' : 'Admin override disabled successfully',
    experiment: {
      id: experiment._id,
      name: experiment.experimentName,
      date: experiment.date,
      adminOverride: experiment.allocationStatus.adminOverride,
      overrideReason: experiment.allocationStatus.overrideReason,
      overrideBy: experiment.allocationStatus.overrideBy,
      overrideAt: experiment.allocationStatus.overrideAt
    }
  });
});

// @desc    Get item edit permissions
// @route   GET /api/requests/:id/edit-permissions
// @access  Private (Admin only)
exports.getItemEditPermissions = asyncHandler(async (req, res) => {
  const requestId = req.params.id;
  const userRole = req.user?.role;
  const isAdmin = userRole === 'admin';

  if (!isAdmin) {
    return res.status(403).json({ 
      message: 'Access denied - Admin only',
      code: 'ACCESS_DENIED'
    });
  }

  if (!isValidObjectId(requestId)) {
    return res.status(400).json({ 
      message: 'Invalid request ID format',
      code: 'INVALID_REQUEST_ID'
    });
  }

  const request = await Request.findById(requestId);
  if (!request) {
    return res.status(404).json({ 
      message: 'Request not found',
      code: 'REQUEST_NOT_FOUND'
    });
  }

  const experimentsPermissions = [];

  for (const experiment of request.experiments) {
    const experimentPermissions = {
      experimentId: experiment._id,
      experimentName: experiment.experimentName,
      date: experiment.date,
      dateStatus: isAllocationAllowed(experiment.date, isAdmin),
      adminOverride: experiment.allocationStatus?.adminOverride || false,
      items: {
        chemicals: [],
        glassware: [],
        equipment: []
      }
    };

    // Get permissions for each item type
    ['chemicals', 'glassware', 'equipment'].forEach(itemType => {
      const items = experiment[itemType] || [];
      
      items.forEach(item => {
        const permissions = getItemEditPermissions(item, experiment.date, isAdmin, 999999); // TODO: Get actual inventory
        
        experimentPermissions.items[itemType].push({
          itemId: item._id,
          name: item.name || item.chemicalName,
          currentQuantity: item.quantity,
          isAllocated: item.isAllocated,
          isDisabled: item.isDisabled,
          wasDisabled: item.wasDisabled,
          permissions
        });
      });
    });

    experimentsPermissions.push(experimentPermissions);
  }

  res.json({
    requestId: request._id,
    requestStatus: request.status,
    experimentsPermissions,
    lastUpdated: new Date()
  });
});

// @desc    Update item disabled status and track history
// @route   PUT /api/requests/:id/items/disable-status
// @access  Private (Admin only)
exports.updateItemDisabledStatus = asyncHandler(async (req, res) => {
  const requestId = req.params.id;
  const { updates } = req.body; // Array of { experimentId, itemType, itemId, isDisabled, reason }
  const adminId = req.user.userId;

  if (!isValidObjectId(requestId)) {
    return res.status(400).json({ 
      message: 'Invalid request ID format',
      code: 'INVALID_REQUEST_ID'
    });
  }

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ 
      message: 'Updates array is required',
      code: 'UPDATES_REQUIRED'
    });
  }

  const request = await Request.findById(requestId);
  if (!request) {
    return res.status(404).json({ 
      message: 'Request not found',
      code: 'REQUEST_NOT_FOUND'
    });
  }

  const processedUpdates = [];
  const errors = [];

  for (const update of updates) {
    const { experimentId, itemType, itemId, isDisabled, reason } = update;

    try {
      const experiment = request.experiments.id(experimentId);
      if (!experiment) {
        errors.push({ experimentId, error: 'Experiment not found' });
        continue;
      }

      const item = experiment[itemType]?.id(itemId);
      if (!item) {
        errors.push({ experimentId, itemId, error: `${itemType} item not found` });
        continue;
      }

      // Cannot disable allocated items
      if (isDisabled && item.isAllocated) {
        errors.push({ 
          experimentId, 
          itemId, 
          error: 'Cannot disable allocated items' 
        });
        continue;
      }

      // Track if item is being re-enabled after being disabled
      if (!isDisabled && item.isDisabled) {
        item.wasDisabled = true;
      }

      // Update item status
      const oldStatus = {
        isDisabled: item.isDisabled,
        disabledReason: item.disabledReason
      };

      item.isDisabled = isDisabled;
      item.disabledReason = isDisabled ? (reason || 'No reason provided') : '';

      processedUpdates.push({
        experimentId,
        experimentName: experiment.experimentName,
        itemType,
        itemId,
        itemName: item.name || item.chemicalName,
        oldStatus,
        newStatus: {
          isDisabled: item.isDisabled,
          disabledReason: item.disabledReason
        },
        action: isDisabled ? 'disabled' : 'enabled'
      });

    } catch (error) {
      errors.push({ 
        experimentId, 
        itemId, 
        error: error.message 
      });
    }
  }

  // Update allocation status for all experiments
  for (const experiment of request.experiments) {
    updateExperimentAllocationStatus(experiment, true);
  }

  // Update admin edits tracking
  request.adminEdits = {
    hasEdits: true,
    lastEditedBy: adminId,
    lastEditedAt: new Date(),
    editSummary: `Updated disabled status for ${processedUpdates.length} items`
  };

  await request.save();

  res.json({
    message: `Successfully processed ${processedUpdates.length} updates`,
    processedUpdates,
    errors: errors.length > 0 ? errors : undefined,
    totalProcessed: processedUpdates.length,
    totalErrors: errors.length
  });
});

module.exports = exports;