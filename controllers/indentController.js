const mongoose = require('mongoose');
const Indent = require('../models/Indent');
const ChemicalMaster = require('../models/ChemicalMaster');
const ChemicalLive = require('../models/ChemicalLive');
const Transaction = require('../models/Transaction');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');

// LAB ASSISTANT: Create indent for deficient chemicals
exports.createLabIndent = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { labId, chemicals } = req.body;

  // Validate chemicals array
  if (!Array.isArray(chemicals)) {
    return res.status(400).json({ message: 'Chemicals must be an array' });
  }

  const indent = new Indent({
    createdByRole: 'lab_assistant',
    createdBy: req.user._id,
    labId,
    chemicals: chemicals.map(chem => ({
      chemicalName: chem.chemicalName,
      quantity: chem.quantity,
      unit: chem.unit,
      remarks: chem.remarks // Save remarks if provided
    })),
    status: 'pending',
    comments: [] // Ensure comments array is initialized
  });

  await indent.save();
  res.status(201).json({ msg: 'Lab indent submitted', indent });
});

// Central Store Admin: Create new draft indent
exports.createDraftIndent = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { vendorName, chemicals, totalPrice, expectedDeliveryDate } = req.body;

  const indent = new Indent({
    createdByRole: 'central_store_admin',
    createdBy: req.user._id,
    vendorName,
    chemicals: chemicals.map(chem => ({
      chemicalName: chem.chemicalName,
      quantity: chem.quantity,
      unit: chem.unit,
      pricePerUnit: chem.pricePerUnit,
      remarks: chem.remarks
    })),
    totalPrice,
    status: 'draft',
    comments: []
  });

  await indent.save();
  res.status(201).json({ msg: 'Draft indent created', indent });
});

// LAB ASSISTANT: Get indents
exports.getLabAssistantIndents = asyncHandler(async (req, res) => {
  const indents = await Indent.find({
    createdBy: req.user._id,
    createdByRole: 'lab_assistant'
  }).sort({ createdAt: -1 });
  res.status(200).json(indents);
});

// Central Store Admin: Get indents
exports.getCentralAdminIndents = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = {
    createdByRole: { $in: ['lab_assistant', 'central_store_admin'] }
  };
  if (status) query.status = status;
  const indents = await Indent.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name email');
  res.status(200).json(indents);
});

// ADMIN: Get indents (excluding drafts)
exports.getAdminIndents = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const query = {
    createdByRole: 'central_store_admin',
    status: { $ne: 'draft' }
  };
  if (status) query.status = status;
  const indents = await Indent.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name email');
  res.status(200).json(indents);
});

// GET single indent with details
exports.getIndentDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const indentId = new mongoose.Types.ObjectId(id);
  const indent = await Indent.findById(indentId)
    .populate('createdBy', 'name email role');
  if (!indent) {
    return res.status(404).json({ msg: 'Indent not found' });
  }
  res.status(200).json(indent);
});

// Add a comment to an indent (chat-like)
exports.addIndentComment = asyncHandler(async (req, res) => {
  const { indentId } = req.params;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ message: 'Comment text required' });
  const indent = await Indent.findById(indentId);
  if (!indent) return res.status(404).json({ message: 'Indent not found' });
  if (!Array.isArray(indent.comments)) {
    indent.comments = [];
  }
  indent.comments.push({
    text: text.trim(),
    author: req.user._id || req.userId,
    role: req.user.role,
    createdAt: new Date()
  });
  await indent.save();
  res.status(200).json({ message: 'Comment added', comments: indent.comments });
});

// Add chemical remarks to indent
exports.addChemicalRemarks = async (req, res) => {
  try {
    const { indentId } = req.params;
    const { chemicalUpdates } = req.body;
    if (req.user.role !== 'central_store_admin') {
      return res.status(403).json({ message: 'Only Central Store Administrators can add remarks to chemicals' });
    }
    const indent = await Indent.findById(indentId);
    if (!indent) {
      return res.status(404).json({ message: 'Indent not found' });
    }
    if (!Array.isArray(indent.comments)) {
      indent.comments = [];
    }
    indent.comments.push({
      text: chemicalUpdates.comments || `${req.user.name} added remarks to chemicals`,
      author: req.user?._id || req.userId,
      role: req.user?.role || 'system',
      createdAt: new Date()
    });
    if (Array.isArray(chemicalUpdates)) {
      chemicalUpdates.forEach(update => {
        if (typeof update.index === 'number' && indent.chemicals[update.index]) {
          indent.chemicals[update.index].remarks = update.remarks;
        }
      });
    }
    await indent.save();
    return res.status(200).json({
      message: 'Chemical remarks updated successfully',
      indent
    });
  } catch (error) {
    console.error('Error adding chemical remarks:', error);
    return res.status(500).json({ message: 'Failed to update chemical remarks', error: error.message });
  }
};

// Update specific chemicals in an indent including remarks
exports.updateIndentChemicals = async (req, res) => {
  try {
    const { indentId } = req.params;
    const { chemicals } = req.body;
    const indent = await Indent.findById(indentId);
    if (!indent) {
      return res.status(404).json({ message: 'Indent not found' });
    }
    if (!Array.isArray(indent.comments)) {
      indent.comments = [];
    }
    indent.comments.push({
      text: 'Auto-generated comment',
      author: req.user?._id || req.userId,
      role: req.user?.role || 'system',
      createdAt: new Date()
    });
    if (req.user.role !== 'central_store_admin' && indent.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this indent' });
    }
    if (req.user.role === 'central_store_admin') {
      if (Array.isArray(chemicals)) {
        chemicals.forEach(updatedChem => {
          const index = indent.chemicals.findIndex(
            chem => chem._id.toString() === updatedChem._id
          );
          if (index !== -1) {
            indent.chemicals[index] = {
              ...indent.chemicals[index],
              ...updatedChem,
              _id: indent.chemicals[index]._id
            };
          }
        });
      }
      if (indent.totalPrice) {
        indent.totalPrice = indent.chemicals.reduce((sum, chem) => {
          return sum + (chem.pricePerUnit || 0) * chem.quantity;
        }, 0);
      }
      await indent.save();
      return res.status(200).json({
        message: 'Indent chemicals updated successfully',
        indent
      });
    } else {
      return res.status(403).json({
        message: 'Lab assistants cannot update chemical details after submission'
      });
    }
  } catch (error) {
    console.error('Error updating indent chemicals:', error);
    return res.status(500).json({ message: 'Failed to update indent chemicals', error: error.message });
  }
};

// Batch update remarks
exports.updateAllChemicalRemarks = async (req, res) => {
  try {
    const { indentId } = req.params;
    const { standardRemark } = req.body;
    if (!req.user || req.user.role !== 'central_store_admin') {
      return res.status(403).json({ message: 'Only Central Store Administrators can perform batch updates' });
    }
    const indent = await Indent.findById(indentId);
    if (!indent) {
      return res.status(404).json({ message: 'Indent not found' });
    }
    if (!Array.isArray(indent.comments)) {
      indent.comments = [];
    }
    indent.comments.push({
      text: 'Auto-generated comment',
      author: req.user?._id || req.userId,
      role: req.user?.role || 'system',
      createdAt: new Date()
    });
    indent.chemicals.forEach((chemical, index) => {
      if (!chemical.remarks || chemical.remarks.trim() === '') {
        indent.chemicals[index].remarks = standardRemark;
      }
    });
    await indent.save();
    return res.status(200).json({
      message: 'Standard remarks applied successfully to all chemicals without remarks',
      indent
    });
  } catch (error) {
    console.error('Error applying standard remarks:', error);
    return res.status(500).json({
      message: 'Failed to apply standard remarks',
      error: error.message
    });
  }
};

// Central Store Admin: Add chemical to existing draft indent
exports.addChemicalToDraft = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { indentId, chemicals } = req.body;
  const indent = await Indent.findById(indentId);
  if (!indent || indent.status !== 'draft') {
    return res.status(404).json({ msg: 'Draft indent not found' });
  }
  chemicals.forEach(chem => {
    indent.chemicals.push({
      chemicalName: chem.chemicalName,
      quantity: chem.quantity,
      unit: chem.unit,
      pricePerUnit: chem.pricePerUnit,
      remarks: chem.remarks || ''
    });
  });
  indent.totalPrice = indent.chemicals.reduce((sum, chem) => sum + (chem.quantity * (chem.pricePerUnit || 0)), 0);
  await indent.save();
  res.status(200).json({ msg: 'Chemical(s) added to draft', indent });
});

// Central Store Admin: Submit draft indent (status → pending)
exports.submitDraftToPending = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { indentId } = req.body;
  const draft = await Indent.findById(indentId);
  if (!draft || draft.status !== 'draft') {
    return res.status(404).json({ msg: 'Draft indent not found' });
  }
  draft.status = 'pending';
  draft.submittedAt = new Date();
  await draft.save();
  res.status(200).json({ msg: 'Draft submitted for approval', draft });
});

// Central Store Admin: Allocate chemicals from lab assistant's indent
exports.allocateLabIndent = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { indentId, comments, status } = req.body;
  if (!['allocated', 'partially_fulfilled', 'rejected', 'fulfilled'].includes(status)) {
    return res.status(400).json({
      success: false,
      msg: 'Invalid status for allocation',
      validStatuses: ['allocated', 'partially_fulfilled', 'rejected', 'fulfilled']
    });
  }
  const indent = await Indent.findOne({
    _id: new mongoose.Types.ObjectId(indentId),
    createdByRole: 'lab_assistant',
  }).populate('createdBy');
  if (!indent) {
    return res.status(404).json({
      success: false,
      msg: 'Pending lab indent not found',
      details: { indentId }
    });
  }
  if (!Array.isArray(indent.comments)) {
    indent.comments = [];
  }
  indent.comments.push({
    text: comments || `Indent marked as ${status}`,
    author: req.user._id,
    role: req.user.role,
    createdAt: new Date()
  });

  // If status is 'allocated' or 'fulfilled', allocate chemicals to the lab
  if (['allocated', 'fulfilled'].includes(status)) {
    // For each chemical, deduct from Central Store and add to the lab's stock
    const allocationResults = [];
    let allAllocated = true;
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      for (const chem of indent.chemicals) {
        try {
          // Find central stock (FIFO: earliest expiry)
          const centralStock = await ChemicalLive.findOneAndUpdate(
            {
              displayName: chem.chemicalName,
              labId: 'central-store',
              quantity: { $gte: chem.quantity }
            },
            { $inc: { quantity: -chem.quantity } },
            { session, new: true, sort: { expiryDate: 1 } }
          );
          if (!centralStock) {
            allocationResults.push({
              chemicalName: chem.chemicalName,
              status: 'failed',
              reason: 'Insufficient stock or not found'
            });
            allAllocated = false;
            continue;
          }
          // Add/update lab stock
          const labStock = await ChemicalLive.findOneAndUpdate(
            {
              chemicalMasterId: centralStock.chemicalMasterId,
              labId: indent.labId
            },
            {
              $inc: { quantity: chem.quantity },
              $setOnInsert: {
                chemicalName: centralStock.chemicalName,
                displayName: centralStock.displayName,
                unit: centralStock.unit,
                expiryDate: centralStock.expiryDate,
                originalQuantity: chem.quantity,
                isAllocated: true
              }
            },
            { session, new: true, upsert: true }
          );
          // Create transaction record
          await Transaction.create([
            {
              chemicalName: centralStock.chemicalName,
              transactionType: 'allocation',
              chemicalLiveId: labStock._id,
              fromLabId: 'central-store',
              toLabId: indent.labId,
              quantity: chem.quantity,
              unit: centralStock.unit,
              createdBy: req.user._id,
              indentId: indent._id,
              timestamp: new Date()
            }
          ], { session });
          allocationResults.push({
            chemicalName: chem.chemicalName,
            status: 'allocated',
            quantity: chem.quantity
          });
        } catch (error) {
          allocationResults.push({
            chemicalName: chem.chemicalName,
            status: 'error',
            reason: error.message
          });
          allAllocated = false;
        }
      }
      await session.commitTransaction();
      session.endSession();
      indent.status = allAllocated ? status : 'partially_fulfilled';
      await indent.save();
      return res.status(200).json({
        success: true,
        msg: `Indent ${indent.status}`,
        status: indent.status,
        allocationResults,
        indent
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        msg: 'Allocation failed',
        error: error.message
      });
    }
  } else {
    indent.status = status;
    await indent.save();
    return res.status(200).json({
      success: true,
      msg: `Indent ${status}`,
      status: indent.status,
      indent
    });
  }
});

// ADMIN: Approve/reject central admin's indent
exports.processCentralIndent = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { indentId, status, comments, chemicalUpdates } = req.body;
  if (!['approved', 'rejected', 'purchasing', 'purchased'].includes(status)) {
    return res.status(400).json({ msg: 'Invalid status for central indent' });
  }
  const indent = await Indent.findById(new mongoose.Types.ObjectId(indentId));
  if (!indent) {
    return res.status(404).json({ msg: 'Pending central indent not found' });
  }
  if (!Array.isArray(indent.comments)) {
    indent.comments = [];
  }
  indent.comments.push({
    text: comments || `Indent marked as ${status}`,
    author: req.user._id,
    role: req.user.role,
    createdAt: new Date()
  });
  if (Array.isArray(chemicalUpdates)) {
    chemicalUpdates.forEach(update => {
      if (typeof update.index === 'number' && indent.chemicals[update.index]) {
        indent.chemicals[update.index].remarks = update.remarks;
      }
    });
  }
  indent.status = status;
  await indent.save();
  res.status(200).json({ msg: `Indent ${status}`, indent });
});
