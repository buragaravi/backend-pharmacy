const asyncHandler = require('express-async-handler');
const Requirement = require('../models/Requirement');
const mongoose = require('mongoose');
const { convertApprovedRequirementToQuotation } = require('../utils/quotationIntegration');
const Quotation = require('../models/Quotation');
const User = require('../models/User');
const Lab = require('../models/Lab');
const mongoose = require('mongoose');

// @desc    Create a new requirement request
// @route   POST /api/requirements
// @access  Private (Faculty, Staff)
exports.createRequirement = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    priority,
    labId,
    items
  } = req.body;

  // Validation
  if (!title || !description || !labId || !items) {
    return res.status(400).json({ message: 'Title, description, lab, and items are required' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'At least one item must be specified' });
  }

  // Validate lab exists
  const lab = await Lab.findById(labId);
  if (!lab) {
    return res.status(404).json({ message: 'Lab not found' });
  }

  try {
    const requirement = new Requirement({
      title,
      description,
      type: 'general', // Default type
      priority: priority || 'medium',
      labId,
      department: req.user.department || 'Not specified',
      raisedBy: req.user._id,
      items: items.map(item => ({
        ...item,
        estimatedCost: 0 // Set default cost
      })),
      purpose: 'Faculty requirement', // Default purpose
      requiredBy: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
    });

    await requirement.save();

    // Populate the response
    const populatedRequirement = await Requirement.findById(requirement._id)
      .populate('raisedBy', 'name email role department')
      .populate('labId', 'labName');

    res.status(201).json({
      message: 'Requirement created successfully',
      requirement: populatedRequirement
    });
  } catch (error) {
    console.error('Error creating requirement:', error);
    res.status(500).json({ message: 'Failed to create requirement' });
  }
});

// @desc    Get all requirements (with filtering)
// @route   GET /api/requirements
// @access  Private
exports.getRequirements = asyncHandler(async (req, res) => {
  const { status, priority, type, department, labId, raisedBy } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Build filter object
  const filter = {};
  
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (type) filter.type = type;
  if (department) filter.department = department;
  if (labId) filter.labId = labId;
  if (raisedBy) filter.raisedBy = raisedBy;

  // Role-based filtering
  if (req.user.role === 'faculty' || req.user.role === 'lab_assistant') {
    // Faculty and lab assistants can only see their own requirements
    filter.raisedBy = req.user._id;
  }

  try {
    const requirements = await Requirement.find(filter)
      .populate('raisedBy', 'name email role department')
      .populate('labId', 'labName')
      .populate('relatedQuotation', 'status totalPrice')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Requirement.countDocuments(filter);

    res.status(200).json({
      requirements,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalRequirements: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching requirements:', error);
    res.status(500).json({ message: 'Failed to fetch requirements' });
  }
});

// @desc    Get single requirement details
// @route   GET /api/requirements/:id
// @access  Private
exports.getRequirementById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const requirement = await Requirement.findById(id)
      .populate('raisedBy', 'name email role department')
      .populate('labId', 'labName')
      .populate('relatedQuotation')
      .populate('comments.author', 'name role')
      .populate('approvals.approvedBy', 'name role');

    if (!requirement) {
      return res.status(404).json({ message: 'Requirement not found' });
    }

    // Check access permissions
    if ((req.user.role === 'faculty' || req.user.role === 'lab_assistant') && 
        requirement.raisedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.status(200).json(requirement);
  } catch (error) {
    console.error('Error fetching requirement:', error);
    res.status(500).json({ message: 'Failed to fetch requirement' });
  }
});

// @desc    Update requirement
// @route   PUT /api/requirements/:id
// @access  Private (Owner or Admin)
exports.updateRequirement = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const requirement = await Requirement.findById(id);

    if (!requirement) {
      return res.status(404).json({ message: 'Requirement not found' });
    }

    // Check permissions - only owner or admin can update
    if (requirement.raisedBy.toString() !== req.user._id.toString() && 
        !['admin', 'central_store_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Don't allow updates if already converted to quotation
    if (requirement.status === 'converted_to_quotation') {
      return res.status(400).json({ message: 'Cannot update requirement that has been converted to quotation' });
    }

    // Update fields
    const updateFields = { ...req.body };
    delete updateFields.status; // Status should be updated through separate endpoint
    delete updateFields.raisedBy; // Cannot change who raised it

    Object.assign(requirement, updateFields);
    await requirement.save();

    const updatedRequirement = await Requirement.findById(id)
      .populate('raisedBy', 'name email role department')
      .populate('labId', 'labName');

    res.status(200).json({
      message: 'Requirement updated successfully',
      requirement: updatedRequirement
    });
  } catch (error) {
    console.error('Error updating requirement:', error);
    res.status(500).json({ message: 'Failed to update requirement' });
  }
});

// @desc    Update requirement status (Admin only)
// @route   PATCH /api/requirements/:id/status
// @access  Private (Admin)
exports.updateRequirementStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, comments } = req.body;

  if (!['admin', 'central_store_admin', 'hod', 'dean'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const requirement = await Requirement.findById(id);

    if (!requirement) {
      return res.status(404).json({ message: 'Requirement not found' });
    }

    const oldStatus = requirement.status;
    requirement.status = status;

    // Add approval record
    requirement.approvals.push({
      approvedBy: req.user._id,
      role: req.user.role,
      status: status === 'approved' ? 'approved' : 'rejected',
      comments: comments || '',
      approvedAt: new Date()
    });

    // Add status change comment
    if (comments) {
      requirement.comments.push({
        text: `Status changed from "${oldStatus}" to "${status}": ${comments}`,
        author: req.user._id,
        role: req.user.role
      });
    }

    await requirement.save();

    const updatedRequirement = await Requirement.findById(id)
      .populate('raisedBy', 'name email role department')
      .populate('labId', 'labName')
      .populate('approvals.approvedBy', 'name role');

    res.status(200).json({
      message: `Requirement ${status} successfully`,
      requirement: updatedRequirement
    });
  } catch (error) {
    console.error('Error updating requirement status:', error);
    res.status(500).json({ message: 'Failed to update requirement status' });
  }
});

// @desc    Convert requirement to quotation
// @route   POST /api/requirements/:id/convert-to-quotation
// @access  Private (Admin/Central Store Admin)
exports.convertToQuotation = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!['admin', 'central_store_admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Only administrators can convert requirements to quotations' });
  }

  try {
    const requirement = await Requirement.findById(id)
      .populate('raisedBy', 'name email role')
      .populate('labId', 'labName');

    if (!requirement) {
      return res.status(404).json({ message: 'Requirement not found' });
    }

    if (requirement.status === 'converted_to_quotation') {
      return res.status(400).json({ message: 'Requirement already converted to quotation' });
    }

    if (requirement.status !== 'approved') {
      return res.status(400).json({ message: 'Only approved requirements can be converted to quotations' });
    }

    // Convert items to quotation format
    const chemicals = requirement.items.filter(item => item.itemType === 'chemical').map(item => ({
      chemicalName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      pricePerUnit: item.estimatedCost || 0,
      remarks: item.specifications || ''
    }));

    const equipment = requirement.items.filter(item => item.itemType === 'equipment').map(item => ({
      equipmentName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      pricePerUnit: item.estimatedCost || 0,
      specifications: item.specifications || '',
      remarks: ''
    }));

    const glassware = requirement.items.filter(item => item.itemType === 'glassware').map(item => ({
      glasswareName: item.itemName,
      quantity: item.quantity,
      unit: item.unit,
      pricePerUnit: item.estimatedCost || 0,
      condition: 'new',
      remarks: item.specifications || ''
    }));

    // Create quotation
    const quotation = new Quotation({
      quotationType: requirement.type,
      status: 'pending',
      labId: requirement.labId,
      createdBy: req.user._id,
      createdByRole: req.user.role,
      totalPrice: requirement.estimatedBudget,
      chemicals,
      equipment,
      glassware,
      comments: [{
        text: `Converted from requirement: ${requirement.title} (${requirement.requirementId})`,
        author: req.user._id,
        role: req.user.role
      }]
    });

    await quotation.save();

    // Update requirement
    requirement.status = 'converted_to_quotation';
    requirement.relatedQuotation = quotation._id;
    requirement.comments.push({
      text: `Converted to quotation ${quotation._id}`,
      author: req.user._id,
      role: req.user.role
    });

    await requirement.save();

    // Populate quotation response
    const populatedQuotation = await Quotation.findById(quotation._id)
      .populate('createdBy', 'name email role')
      .populate('labId', 'labName');

    res.status(201).json({
      message: 'Requirement converted to quotation successfully',
      quotation: populatedQuotation,
      requirement
    });
  } catch (error) {
    console.error('Error converting requirement to quotation:', error);
    res.status(500).json({ message: 'Failed to convert requirement to quotation' });
  }
});

// @desc    Add comment to requirement
// @route   POST /api/requirements/:id/comments
// @access  Private
exports.addComment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ message: 'Comment text is required' });
  }

  try {
    const requirement = await Requirement.findById(id);

    if (!requirement) {
      return res.status(404).json({ message: 'Requirement not found' });
    }

    requirement.comments.push({
      text: text.trim(),
      author: req.user._id,
      role: req.user.role
    });

    await requirement.save();

    const updatedRequirement = await Requirement.findById(id)
      .populate('comments.author', 'name role');

    res.status(200).json({
      message: 'Comment added successfully',
      requirement: updatedRequirement
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ message: 'Failed to add comment' });
  }
});

// @desc    Delete requirement
// @route   DELETE /api/requirements/:id
// @access  Private (Owner or Admin)
exports.deleteRequirement = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    const requirement = await Requirement.findById(id);

    if (!requirement) {
      return res.status(404).json({ message: 'Requirement not found' });
    }

    // Check permissions
    if (requirement.raisedBy.toString() !== req.user._id.toString() && 
        !['admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Don't allow deletion if converted to quotation
    if (requirement.status === 'converted_to_quotation') {
      return res.status(400).json({ message: 'Cannot delete requirement that has been converted to quotation' });
    }

    await Requirement.findByIdAndDelete(id);

    res.status(200).json({ message: 'Requirement deleted successfully' });
  } catch (error) {
    console.error('Error deleting requirement:', error);
    res.status(500).json({ message: 'Failed to delete requirement' });
  }
});

// @desc    Get requirements dashboard stats
// @route   GET /api/requirements/stats
// @access  Private (Admin)
exports.getRequirementStats = asyncHandler(async (req, res) => {
  if (!['admin', 'central_store_admin'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const totalRequirements = await Requirement.countDocuments();
    const pendingRequirements = await Requirement.countDocuments({ status: 'pending' });
    const approvedRequirements = await Requirement.countDocuments({ status: 'approved' });
    const convertedRequirements = await Requirement.countDocuments({ status: 'converted_to_quotation' });
    
    // Get requirements by priority
    const priorityStats = await Requirement.aggregate([
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent requirements
    const recentRequirements = await Requirement.find()
      .populate('raisedBy', 'name department')
      .populate('labId', 'labName')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      totalRequirements,
      pendingRequirements,
      approvedRequirements,
      convertedRequirements,
      priorityStats,
      recentRequirements
    });
  } catch (error) {
    console.error('Error fetching requirement stats:', error);
    res.status(500).json({ message: 'Failed to fetch requirement statistics' });
  }
});
