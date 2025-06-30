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

// Helper function to validate ObjectId
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
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

    // Update overall request status
    const allChemicalsAllocated = request.experiments.every(exp => 
      exp.chemicals.every(chem => chem.isAllocated)
    );
    request.status = allChemicalsAllocated ? 'fulfilled' : 'partially_fulfilled';
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

  // Process experiments and suggested chemicals
  const processedExperiments = await Promise.all(experiments.map(async exp => {
    const experiment = await Experiment.findById(exp.experimentId);
    if (!experiment) {
      throw new Error(`Experiment not found: ${exp.experimentId}`);
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
      date: exp.date,
      session: exp.session,
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
    for (const itemId of itemIds) {
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

// @desc    Unified allocation for chemicals, equipment, and glassware
// @route   PUT /api/requests/:id/allocate-unified
// @desc    Unified allocation for chemicals, equipment, and glassware
// @route   PUT /api/requests/:id/allocate-unified
// @access  Private (Admin/Lab Assistant)
exports.allocateChemEquipGlass = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { equipment, glassware } = req.body; // Only equipment and glassware from body
  const adminId = req.userId;

  console.log('[allocateChemEquipGlass] called with params:', req.params, 'body:', req.body);

  if (!isValidObjectId(id)) {
    console.log('[allocateChemEquipGlass] Invalid request ID format:', id);
    return res.status(400).json({ message: 'Invalid request ID format' });
  }

  const request = await Request.findById(id);
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

  // --- 1. Allocate Chemicals (use chemicals from experiment, not from req.body) ---
  try {
    for (const experiment of request.experiments) {
      for (const chemical of experiment.chemicals) {
        if (chemical.isAllocated) continue;
        const { chemicalName, quantity, unit, chemicalMasterId } = chemical;
        console.log('[allocateChemEquipGlass] Allocating chemical:', chemicalName, 'quantity:', quantity);
        const labStock = await ChemicalLive.findOne({ chemicalName, labId });
        if (!labStock || labStock.quantity < quantity) {
          console.log('[allocateChemEquipGlass] Insufficient stock for', chemicalName);
          errors.push({ type: 'chemicals', error: `Insufficient stock for ${chemicalName}` });
          continue;
        }
        labStock.quantity -= quantity;
        await labStock.save();
        await Transaction.create({
          transactionType: 'transfer',
          chemicalName,
          fromLabId: labId,
          toLabId: 'faculty',
          chemicalLiveId: labStock._id,
          quantity,
          unit,
          createdBy: adminId,
          timestamp: new Date(),
        });
        chemical.allocatedQuantity = quantity;
        chemical.isAllocated = true;
        chemical.allocationHistory = chemical.allocationHistory || [];
        chemical.allocationHistory.push({
          date: new Date(),
          quantity,
          allocatedBy: adminId
        });
        console.log('[allocateChemEquipGlass] Allocated chemical:', chemicalName);
      }
    }
  } catch (err) {
    console.log('[allocateChemEquipGlass] Error in chemical allocation:', err);
    errors.push({ type: 'chemicals', error: err.message });
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

  // Update request status
  const allAllocated = request.experiments.every(exp =>
    exp.chemicals.every(chem => chem.isAllocated) &&
    (exp.glassware ? exp.glassware.every(g => g.isAllocated) : true) &&
    (exp.equipment ? exp.equipment.every(e => e.isAllocated) : true)
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
  const partially_fulfilled = await Request.countDocuments({ status: 'partially_fulfilled' });
  const fulfilled = await Request.countDocuments({ status: 'fulfilled' });
  const rejected = await Request.countDocuments({ status: 'rejected' });
  const active = pending + partially_fulfilled;
  res.status(200).json({ total, active, pending, partially_fulfilled, fulfilled, rejected });
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

module.exports = exports;