const Requirement = require('../models/Requirement');
const mongoose = require('mongoose');
const { convertApprovedRequirementToQuotation } = require('../utils/quotationIntegration');

// Create a new requirement
const createRequirement = async (req, res) => {
  try {
    const { priority, items, remarks } = req.body;
    const userId = req.user.id || req.user._id || req.user.userId; // Ensure userId is correctly set

    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }

    // Validate each item
    for (const item of items) {
      if (!item.itemType || !item.itemName || !item.quantity || !item.unit) {
        return res.status(400).json({
          success: false,
          message: 'Each item must have itemType, itemName, quantity, and unit'
        });
      }

      if (!['chemical', 'equipment', 'glassware'].includes(item.itemType)) {
        return res.status(400).json({
          success: false,
          message: 'Item type must be chemical, equipment, or glassware'
        });
      }

      if (item.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Quantity must be greater than 0'
        });
      }
    }

    // Create requirement
    const requirement = new Requirement({
      priority: priority || 'medium',
      raisedBy: userId,
      items: items.map(item => ({
        itemType: item.itemType,
        itemName: item.itemName.trim(),
        quantity: Number(item.quantity),
        unit: item.unit.trim(),
        specifications: item.specifications?.trim() || '',
        remarks: item.remarks?.trim() || ''
      }))
    });

    // Add initial comment if provided
    if (remarks && remarks.trim()) {
      requirement.comments.push({
        comment: remarks.trim(),
        commentBy: userId
      });
    }

    await requirement.save();
    await requirement.populate('raisedBy', 'name email department');

    res.status(201).json({
      success: true,
      message: 'Requirement created successfully',
      requirement
    });
  } catch (error) {
    console.error('Error creating requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create requirement',
      error: error.message
    });
  }
};

// Get requirements (with role-based filtering)
const getRequirements = async (req, res) => {
  try {
    console.log('getRequirements called with user:', {
      id: req.user.id,
      role: req.user.role,
      name: req.user.name,
      email: req.user.email
    });
    
    const userId = req.user.id || req.user._id || req.user.userId; // Ensure userId is correctly set
    const userRole = req.user.role;
    const { status, priority, search, page = 1, limit = 10 } = req.query;

    // Build query based on user role
    let query = {};
    
    // Role-based filtering
    const adminRoles = ['admin', 'central_store_admin', 'hod', 'dean'];
    
    // Non-admin users only see their own requirements
    if (!adminRoles.includes(userRole)) {
      query.raisedBy = userId;
    }

    console.log('Query built:', query, 'User role:', userRole);

    // Apply filters
    if (status) {
      query.status = status;
    }

    if (priority) {
      query.priority = priority;
    }

    // Search functionality
    if (search) {
      query.$or = [
        { requirementId: { $regex: search, $options: 'i' } },
        { 'items.itemName': { $regex: search, $options: 'i' } }
      ];
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log('About to execute query...');
    
    // Check if Requirement model is working
    const totalInDB = await Requirement.countDocuments({});
    console.log('Total requirements in database:', totalInDB);
    
    // Execute query
    const requirements = await Requirement.find(query)
      .populate('raisedBy', 'name email department')
      .populate('comments.commentBy', 'name email')
      .populate('approvals.approvedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    console.log('Found requirements:', requirements.length);

    // Get total count for pagination
    const totalCount = await Requirement.countDocuments(query);

    console.log('Total count:', totalCount);

    res.json({
      success: true,
      requirements,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + requirements.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Error fetching requirements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirements',
      error: error.message
    });
  }
};

// Get requirement by ID
const getRequirementById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const requirement = await Requirement.findById(id)
      .populate('raisedBy', 'name email department')
      .populate('comments.commentBy', 'name email')
      .populate('approvals.approvedBy', 'name email')
      .populate('quotationId', 'quotationType status createdAt');

    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Check access permissions
    if (userRole !== 'admin' && userRole !== 'central_store_admin' && 
        requirement.raisedBy._id.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      requirement
    });
  } catch (error) {
    console.error('Error fetching requirement:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement',
      error: error.message
    });
  }
};

// Update requirement status (admin only) with auto-quotation conversion
const updateRequirementStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;
    const userId = req.user.id || req.user._id || req.user.userId; // Ensure userId is correctly set
    const userRole = req.user.role;

    // Check permissions
    if (userRole !== 'admin' && userRole !== 'central_store_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can update requirement status'
      });
    }

    // Validate status
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be approved or rejected'
      });
    }

    const requirement = await Requirement.findById(id);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Check if already processed
    if (requirement.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Requirement has already been processed'
      });
    }

    // Update status
    requirement.status = status;

    // Add approval record
    requirement.approvals.push({
      status,
      approvedBy: userId,
      comment: comment || ''
    });

    // Add comment if provided
    if (comment && comment.trim()) {
      requirement.comments.push({
        comment: comment.trim(),
        commentBy: userId
      });
    }

    await requirement.save();
    await requirement.populate([
      { path: 'raisedBy', select: 'name email department' },
      { path: 'comments.commentBy', select: 'name email' },
      { path: 'approvals.approvedBy', select: 'name email' }
    ]);

    // Auto-convert to quotation if approved
    if (status === 'approved') {
      try {
        console.log(`Auto-converting approved requirement ${requirement.requirementId} to quotation`);
        
        const conversionResult = await convertApprovedRequirementToQuotation(requirement, userId);
        
        // Re-populate the updated requirement
        await requirement.populate([
          { path: 'raisedBy', select: 'name email department' },
          { path: 'comments.commentBy', select: 'name email' },
          { path: 'approvals.approvedBy', select: 'name email' },
          { path: 'quotationId', select: 'quotationType status createdAt' }
        ]);

        console.log(`Successfully converted requirement to quotation ${conversionResult.quotation._id}`);
        
        return res.json({
          success: true,
          message: `Requirement approved and converted to quotation successfully`,
          requirement,
          quotation: {
            id: conversionResult.quotation._id,
            type: conversionResult.quotation.quotationType,
            status: conversionResult.quotation.status
          }
        });
      } catch (conversionError) {
        console.error('Error converting requirement to quotation:', conversionError);
        
        // Still return success for the approval, but note the conversion error
        return res.json({
          success: true,
          message: `Requirement approved successfully, but failed to convert to quotation: ${conversionError.message}`,
          requirement,
          conversionError: conversionError.message
        });
      }
    }

    res.json({
      success: true,
      message: `Requirement ${status} successfully`,
      requirement
    });
  } catch (error) {
    console.error('Error updating requirement status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update requirement status',
      error: error.message
    });
  }
};
// Add comment to requirement
const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const userId = req.user.id || req.user._id || req.user.userId; // Ensure userId is correctly set

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Comment is required'
      });
    }

    const requirement = await Requirement.findById(id);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    // Add comment
    requirement.comments.push({
      comment: comment.trim(),
      commentBy: userId
    });

    await requirement.save();
    await requirement.populate([
      { path: 'raisedBy', select: 'name email department' },
      { path: 'comments.commentBy', select: 'name email' },
      { path: 'approvals.approvedBy', select: 'name email' }
    ]);

    res.json({
      success: true,
      message: 'Comment added successfully',
      requirement
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message
    });
  }
};

// Get requirement statistics
const getRequirementStats = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id || req.user.userId; // Ensure userId is correctly set
    const userRole = req.user.role;

    // Build match query based on user role
    let matchQuery = {};
    if (userRole !== 'admin' && userRole !== 'central_store_admin') {
      matchQuery.raisedBy = mongoose.Types.ObjectId(userId);
    }

    const stats = await Requirement.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalRequirements: { $sum: 1 },
          pendingRequirements: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          approvedRequirements: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
          },
          rejectedRequirements: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          },
          convertedRequirements: {
            $sum: { $cond: [{ $eq: ['$status', 'converted_to_quotation'] }, 1, 0] }
          }
        }
      }
    ]);

    // Priority breakdown
    const priorityStats = await Requirement.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$priority',
          count: { $sum: 1 }
        }
      }
    ]);

    const result = stats[0] || {
      totalRequirements: 0,
      pendingRequirements: 0,
      approvedRequirements: 0,
      rejectedRequirements: 0,
      convertedRequirements: 0
    };

    res.json({
      success: true,
      stats: result,
      priorityBreakdown: priorityStats
    });
  } catch (error) {
    console.error('Error fetching requirement stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requirement statistics',
      error: error.message
    });
  }
};

// Manual conversion to quotation (additional endpoint for manual conversion if needed)
const convertToQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id || req.user.userId; // Ensure userId is correctly set
    const userRole = req.user.role;

    // Check permissions
    if (userRole !== 'admin' && userRole !== 'central_store_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can convert requirements to quotations'
      });
    }

    const requirement = await Requirement.findById(id);
    if (!requirement) {
      return res.status(404).json({
        success: false,
        message: 'Requirement not found'
      });
    }

    if (requirement.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved requirements can be converted to quotations'
      });
    }

    if (requirement.quotationId) {
      return res.status(400).json({
        success: false,
        message: 'Requirement has already been converted to quotation'
      });
    }

    try {
      const conversionResult = await convertApprovedRequirementToQuotation(requirement, userId);
      
      res.json({
        success: true,
        message: 'Requirement converted to quotation successfully',
        requirement: conversionResult.requirement,
        quotation: {
          id: conversionResult.quotation._id,
          type: conversionResult.quotation.quotationType,
          status: conversionResult.quotation.status
        }
      });
    } catch (conversionError) {
      console.error('Error converting requirement to quotation:', conversionError);
      res.status(500).json({
        success: false,
        message: 'Failed to convert requirement to quotation',
        error: conversionError.message
      });
    }
  } catch (error) {
    console.error('Error in convertToQuotation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert requirement to quotation',
      error: error.message
    });
  }
};

module.exports = {
  createRequirement,
  getRequirements,
  getRequirementById,
  updateRequirementStatus,
  addComment,
  getRequirementStats,
  convertToQuotation
};
