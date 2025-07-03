const GlasswareTransaction = require('../models/GlasswareTransaction');
const GlasswareLive = require('../models/GlasswareLive');
const { validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');
const { logGlasswareTransaction } = require('../utils/glasswareTransactionLogger');

// @desc    Create a new glassware transaction
// @route   POST /api/glassware-transactions/create
// @access  Private
const createTransaction = asyncHandler(async (req, res) => {
  const { 
    glasswareName, 
    transactionType, 
    glasswareLiveId, 
    fromLabId, 
    toLabId, 
    quantity, 
    variant,
    reason,
    condition,
    batchId,
    notes 
  } = req.body;
  
  const userId = req.userId; // User ID from authentication middleware

  // Validate request data
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      errors: errors.array() 
    });
  }

  try {
    // Find the glassware in live inventory
    const glasswareLive = await GlasswareLive.findById(glasswareLiveId);
    if (!glasswareLive) {
      return res.status(404).json({ 
        success: false,
        message: 'Glassware not found in live inventory' 
      });
    }

    // Get previous condition for tracking
    const previousCondition = glasswareLive.condition || 'good';

    // Validate transaction based on type
    let updatedQuantity = glasswareLive.quantity;
    let targetLabGlassware = null;

    switch (transactionType) {
      case 'entry':
        // Adding new stock
        updatedQuantity += quantity;
        break;

      case 'issue':
        // Issuing glassware from inventory
        if (glasswareLive.quantity < quantity) {
          return res.status(400).json({ 
            success: false,
            message: 'Insufficient stock for issue transaction' 
          });
        }
        updatedQuantity -= quantity;
        break;

      case 'allocation':
        // Allocating glassware to a lab
        if (glasswareLive.quantity < quantity) {
          return res.status(400).json({ 
            success: false,
            message: 'Insufficient stock for allocation' 
          });
        }
        
        // Find or create target lab inventory
        targetLabGlassware = await GlasswareLive.findOne({
          productId: glasswareLive.productId,
          name: glasswareLive.name,
          variant: glasswareLive.variant,
          labId: toLabId
        });

        if (targetLabGlassware) {
          targetLabGlassware.quantity += quantity;
          await targetLabGlassware.save();
        } else {
          // Create new entry for target lab
          await GlasswareLive.create({
            productId: glasswareLive.productId,
            name: glasswareLive.name,
            variant: glasswareLive.variant,
            labId: toLabId,
            quantity: quantity,
            unit: glasswareLive.unit,
            batchId: batchId || glasswareLive.batchId,
            addedBy: userId._id
          });
        }
        
        updatedQuantity -= quantity;
        break;

      case 'transfer':
        // Transferring between labs
        if (glasswareLive.quantity < quantity) {
          return res.status(400).json({ 
            success: false,
            message: 'Insufficient stock for transfer' 
          });
        }

        // Find or create target lab inventory
        targetLabGlassware = await GlasswareLive.findOne({
          productId: glasswareLive.productId,
          name: glasswareLive.name,
          variant: glasswareLive.variant,
          labId: toLabId
        });

        if (targetLabGlassware) {
          targetLabGlassware.quantity += quantity;
          await targetLabGlassware.save();
        } else {
          // Create new entry for target lab
          await GlasswareLive.create({
            productId: glasswareLive.productId,
            name: glasswareLive.name,
            variant: glasswareLive.variant,
            labId: toLabId,
            quantity: quantity,
            unit: glasswareLive.unit,
            batchId: batchId || glasswareLive.batchId,
            addedBy: userId._id
          });
        }
        
        updatedQuantity -= quantity;
        break;

      case 'return':
        // Returning glassware to inventory
        updatedQuantity += quantity;
        break;

      case 'broken':
        // Marking glassware as broken
        if (glasswareLive.quantity < quantity) {
          return res.status(400).json({ 
            success: false,
            message: 'Cannot mark more items as broken than available' 
          });
        }
        updatedQuantity -= quantity;
        break;

      case 'maintenance':
        // Sending glassware for maintenance
        if (glasswareLive.quantity < quantity) {
          return res.status(400).json({ 
            success: false,
            message: 'Cannot send more items for maintenance than available' 
          });
        }
        updatedQuantity -= quantity;
        break;

      default:
        return res.status(400).json({ 
          success: false,
          message: 'Invalid transaction type' 
        });
    }

    // Create the transaction record
    const newTransaction = new GlasswareTransaction({
      glasswareLiveId,
      glasswareName: glasswareName || glasswareLive.name,
      transactionType,
      quantity,
      variant: variant || glasswareLive.variant,
      fromLabId,
      toLabId,
      reason,
      condition: condition || 'good',
      previousCondition,
      batchId: batchId || glasswareLive.batchId,
      notes,
      createdBy: userId._id,
    });

    // Save the transaction
    await newTransaction.save();

    // Update the source glassware inventory
    glasswareLive.quantity = updatedQuantity;
    if (condition && ['broken', 'damaged', 'under_maintenance'].includes(condition)) {
      glasswareLive.condition = condition;
    }
    await glasswareLive.save();

    // Log the transaction
    await logGlasswareTransaction({
      glasswareLiveId,
      glasswareName: glasswareName || glasswareLive.name,
      transactionType,
      quantity,
      variant: variant || glasswareLive.variant,
      fromLabId,
      toLabId,
      reason,
      condition: condition || 'good',
      createdBy: userId._id,
      date: new Date()
    });

    // Populate the response
    await newTransaction.populate('createdBy', 'name email');

    res.status(201).json({ 
      success: true,
      message: 'Glassware transaction processed successfully',
      data: newTransaction
    });

  } catch (error) {
    console.error('Error creating glassware transaction:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// @desc    Get all glassware transactions
// @route   GET /api/glassware-transactions/all
// @access  Private (Central Lab Admin)
const getAllTransactions = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 50, transactionType, labId, startDate, endDate } = req.query;
    
    // Build filter query
    let filter = {};
    
    if (transactionType) {
      filter.transactionType = transactionType;
    }
    
    if (labId) {
      filter.$or = [
        { fromLabId: labId },
        { toLabId: labId }
      ];
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    
    // Get transactions with pagination
    const transactions = await GlasswareTransaction.find(filter)
      .populate('glasswareLiveId', 'name variant labId')
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await GlasswareTransaction.countDocuments(filter);
    
    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// @desc    Get transactions for a specific lab
// @route   GET /api/glassware-transactions/lab/:labId
// @access  Private (Lab Assistant, Central Lab Admin)
const getLabTransactions = asyncHandler(async (req, res) => {
  const { labId } = req.params;
  const { page = 1, limit = 50, transactionType, startDate, endDate } = req.query;

  try {
    // Build filter query
    let filter = {
      $or: [
        { fromLabId: labId },
        { toLabId: labId }
      ]
    };
    
    if (transactionType) {
      filter.transactionType = transactionType;
    }
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    const transactions = await GlasswareTransaction.find(filter)
      .populate('glasswareLiveId', 'name variant labId')
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    if (transactions.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No transactions found for this lab' 
      });
    }

    // Get total count
    const total = await GlasswareTransaction.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching lab transactions:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// @desc    Get transaction history for specific glassware
// @route   GET /api/glassware-transactions/glassware/:glasswareId
// @access  Private
const getGlasswareHistory = asyncHandler(async (req, res) => {
  const { glasswareId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  try {
    // Calculate pagination
    const skip = (page - 1) * limit;

    const transactions = await GlasswareTransaction.find({ glasswareLiveId: glasswareId })
      .populate('createdBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    if (transactions.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'No transaction history found for this glassware' 
      });
    }

    // Get total count
    const total = await GlasswareTransaction.countDocuments({ glasswareLiveId: glasswareId });

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: transactions
    });
  } catch (error) {
    console.error('Error fetching glassware history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

// @desc    Get transaction statistics
// @route   GET /api/glassware-transactions/stats
// @access  Private
const getTransactionStats = asyncHandler(async (req, res) => {
  const { timeRange = 'last30Days', labId } = req.query;

  try {
    // Calculate date range
    let startDate = new Date();
    switch (timeRange) {
      case 'last7Days':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'last30Days':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case 'last90Days':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case 'thisYear':
        startDate = new Date(startDate.getFullYear(), 0, 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    // Build match criteria
    let matchCriteria = {
      createdAt: { $gte: startDate }
    };

    if (labId) {
      matchCriteria.$or = [
        { fromLabId: labId },
        { toLabId: labId }
      ];
    }

    // Aggregate statistics
    const stats = await GlasswareTransaction.aggregate([
      { $match: matchCriteria },
      {
        $group: {
          _id: '$transactionType',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      }
    ]);

    // Get broken/damaged items stats
    const conditionStats = await GlasswareTransaction.aggregate([
      { 
        $match: { 
          ...matchCriteria,
          transactionType: { $in: ['broken', 'maintenance'] }
        }
      },
      {
        $group: {
          _id: '$transactionType',
          count: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' }
        }
      }
    ]);

    // Get lab-wise transaction counts
    const labStats = await GlasswareTransaction.aggregate([
      { $match: matchCriteria },
      { $unwind: { path: '$fromLabId', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$toLabId', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$fromLabId', '$toLabId'] },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { transactionCount: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        transactionStats: stats,
        conditionStats,
        labStats,
        timeRange,
        period: `${startDate.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`
      }
    });
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error' 
    });
  }
});

module.exports = {
  createTransaction,
  getAllTransactions,
  getLabTransactions,
  getGlasswareHistory,
  getTransactionStats
};
