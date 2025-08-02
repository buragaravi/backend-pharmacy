const GlasswareLive = require('../models/GlasswareLive');
const Product = require('../models/Product');
const GlasswareTransaction = require('../models/GlasswareTransaction');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { logGlasswareTransaction } = require('../utils/glasswareTransactionLogger');


// Helper: generate glassware batch ID following same pattern as chemicals
function generateGlasswareBatchId() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${(date.getMonth() + 1)
    .toString()
    .padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0');
  return `GLASS-${ymd}-${random}`; // Changed prefix from BATCH- to GLASS-
}

// Helper: get latest glassware batch ID from DB
async function getLastUsedGlasswareBatchId() {
  const latest = await GlasswareLive.findOne({
    batchId: { $exists: true },
    labId: 'central-store'
  })
    .sort({ createdAt: -1 })
    .select('batchId');

  return latest?.batchId || null;
}

const addGlasswareToCentral = asyncHandler(async (req, res) => {
  const { items, usePreviousBatchId } = req.body; // [{ productId, name, variant, quantity }]

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No glassware items provided' });
  }

  let batchId;
  if (usePreviousBatchId) {
    batchId = await getLastUsedGlasswareBatchId();
  } else {
    batchId = generateGlasswareBatchId();
  }

  const savedItems = [];
  const qrCodes = []; // To store generated QR code data

  for (const item of items) {
    let { productId, name, variant, quantity, vendor, pricePerUnit, department } = item;

    // 1. Check for existing glassware with same productId AND variant
    const existingItem = await GlasswareLive.findOne({
      productId,
      variant, // Variant is the key differentiator
      labId: 'central-store'
    });

    // 2. If no matching glassware exists, create new with QR code
    if (!existingItem) {
      const qrCodeData = generateQRCodeData(productId, variant, batchId);
      const qrCodeImage = await generateQRCodeImage(qrCodeData);

      const newItem = await GlasswareLive.create({
        ...item,
        labId: 'central-store',
        batchId,
        department,
        vendor,
        pricePerUnit,
        addedBy: req.userId,
        qrCodeData,
        qrCodeImage
      });

      // Log glassware transaction for entry
      await GlasswareTransaction.create({
        glasswareLiveId: newItem._id,
        glasswareName: newItem.name,
        transactionType: 'entry',
        quantity: quantity,
        variant: variant,
        toLabId: 'central-store',
        condition: 'good',
        batchId,
        notes: `Initial entry to Central Store`,
        createdBy: req.userId || req._id || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75') // Fallback admin ID
      });

      savedItems.push(newItem);
      qrCodes.push({
        productId: newItem.productId,
        variant: newItem.variant,
        qrCodeImage: newItem.qrCodeImage
      });
      continue;
    }

    // 3. If matching variant exists, just update quantity
    existingItem.quantity += Number(quantity);
    await existingItem.save();

    // Log glassware transaction for additional entry
    await GlasswareTransaction.create({
      glasswareLiveId: existingItem._id,
      glasswareName: existingItem.name,
      transactionType: 'entry',
      quantity: Number(quantity),
      variant: existingItem.variant,
      toLabId: 'central-store',
      condition: 'good',
      batchId,
      notes: `Additional stock entry to Central Store`,
      createdBy: req.userId || req._id || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75') // Fallback admin ID
    });

    savedItems.push(existingItem);
  }

  res.status(201).json({
    message: 'Glassware added/updated successfully',
    batchId,
    items: savedItems,
    qrCodes: qrCodes.length > 0 ? qrCodes : undefined
  });
});

// Helper function to generate QR code data string
function generateQRCodeData(productId, variant, batchId) {
  return JSON.stringify({
    type: 'glassware',
    productId,
    variant,
    batchId,
    timestamp: Date.now()
  });
}

// You'll need to implement these:
async function generateQRCodeImage(qrData) {
  try {
    return await QRCode.toDataURL(qrData);
  } catch (err) {
    console.error('QR generation failed:', err);
    return null;
  }
}
const allocateGlasswareToLab = asyncHandler(async (req, res) => {
  console.log('Allocation request received:', req.body);
  console.log('DB connection state:', mongoose.connection.readyState);

  const { labId: toLabId, allocations } = req.body;

  // Enhanced input validation
  if (!toLabId || !allocations || !Array.isArray(allocations)) {
    console.log('Invalid request - missing required fields');
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: labId and allocations array'
    });
  }

  // Validate each allocation
  for (const alloc of allocations) {
    if (!alloc.glasswareId || !alloc.quantity || alloc.quantity <= 0) {
      console.log('Invalid allocation entry:', alloc);
      return res.status(400).json({
        success: false,
        message: 'Each allocation must contain glasswareId and positive quantity'
      });
    }
  }

  const session = await mongoose.startSession({
    defaultTransactionOptions: {
      maxTimeMS: 30000 // 30 seconds timeout
    }
  });

  try {
    console.log('Starting transaction for allocation to lab:', toLabId);
    session.startTransaction();
    
    const allocationResults = [];
    let hasErrors = false;

    for (const alloc of allocations) {
      try {
        const { glasswareId, quantity } = alloc;
        let remainingQty = quantity;


        // Get glassware details (including variant if exists)
        const glasswareDetails = await GlasswareLive.findOne({
          _id: glasswareId,
          labId: 'central-store',
        }).session(session);

        if (!glasswareDetails) {
          allocationResults.push({
            glasswareId,
            success: false,
            message: 'Glassware not found in Central Store or out of stock'
          });
          hasErrors = true;
          continue;
        }

        // FIFO allocation
        const centralStocks = await GlasswareLive.find({
          _id: glasswareId,
          labId: 'central-store',
        })
          .sort({  createdAt: 1 })
          .limit(100)
          .session(session);

        if (!centralStocks.length) {
          console.log(`No available stock for glassware ${glasswareId}`);
          allocationResults.push({
            glasswareId,
            success: false,
            message: 'Insufficient stock in Central Store'
          });
          hasErrors = true;
          continue;
        }

        let totalAllocated = 0;

        for (const central of centralStocks) {
          if (remainingQty <= 0) break;
          const allocQty = Math.min(central.quantity, remainingQty);

          const updatedCentral = await GlasswareLive.findOneAndUpdate(
            { _id: central._id, quantity: { $gte: allocQty } },
            { $inc: { quantity: -allocQty } },
            { session, new: true }
          );

          if (!updatedCentral) {
            allocationResults.push({
              glasswareId,
              success: false,
              message: 'Stock modified during allocation'
            });
            hasErrors = true;
            continue;
          }

          const labStock = await GlasswareLive.findOneAndUpdate(
            { productId: central.productId, labId: toLabId, variant: central.variant || central.unit },
            {
              $inc: { quantity: allocQty },
              $setOnInsert: {
                name: central.name,
                variant: central.unit || central.variant,
                createdAt: new Date(),
                updatedAt: new Date()
              }
            },
            { session, new: true, upsert: true }
          );

          // Create glassware-specific transaction record
          await GlasswareTransaction.create([{
            glasswareLiveId: central._id,
            glasswareName: central.name,
            transactionType: 'allocation',
            quantity: allocQty,
            variant: central.variant || central.unit,
            fromLabId: 'central-store',
            toLabId,
            condition: 'good',
            batchId: central.batchId,
            notes: `Allocated from Central Store to ${toLabId}`,
            createdBy: req.user?._id || req.userId || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75')
          }], { session });

          totalAllocated += allocQty;
          remainingQty -= allocQty;
          console.log(`Allocated ${allocQty}, remaining to allocate: ${remainingQty}`);
        }

        if (totalAllocated < quantity) {
          console.log(`Partial allocation for ${glasswareId}: allocated ${totalAllocated} of ${quantity}`);
          allocationResults.push({
            glasswareId,
            success: false,
            allocated: totalAllocated,
            required: quantity,
            message: 'Insufficient stock in Central Store (partial allocation)'
          });
          hasErrors = true;
        } else {
          console.log(`Successfully allocated ${totalAllocated} of ${glasswareId} to lab ${toLabId}`);
          allocationResults.push({
            glasswareId,
            success: true,
            allocated: totalAllocated,
            message: 'Allocation successful'
          });
        }
      } catch (err) {
        console.error(`Error processing allocation for ${alloc.glasswareId}:`, err);
        allocationResults.push({
          glasswareId: alloc.glasswareId,
          success: false,
          message: `Allocation failed: ${err.message}`
        });
        hasErrors = true;
      }
    }

    if (hasErrors) {
      console.log('Partial failures detected, aborting transaction');
      await session.abortTransaction();
      return res.status(207).json({ // 207 Multi-Status
        success: false,
        message: 'Some allocations failed',
        results: allocationResults
      });
    }

    console.log('All allocations successful, committing transaction');
    await session.commitTransaction();
    res.status(200).json({
      success: true,
      message: 'All glassware allocated successfully',
      results: allocationResults
    });
  } catch (err) {
    console.error('Transaction error:', err);
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    res.status(500).json({
      success: false,
      message: 'Allocation failed',
      error: err.message,
    });
  } finally {
    session.endSession();
    console.log('Session ended');
  }
});
// Allocate glassware from lab to faculty
const allocateGlasswareToFaculty = asyncHandler(async (req, res) => {
  const { productId, variant, quantity, fromLabId } = req.body;
  if (!productId || !variant || !quantity || !fromLabId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  // Decrement from lab
  const labStock = await GlasswareLive.findOne({ productId, labId: fromLabId, variant });
  if (!labStock || labStock.quantity < quantity) {
    return res.status(400).json({ message: 'Insufficient stock in lab' });
  }
  labStock.quantity -= quantity;
  await labStock.save();

  // Log glassware transaction for faculty allocation
  await GlasswareTransaction.create({
    glasswareLiveId: labStock._id,
    glasswareName: labStock.name,
    transactionType: 'issue',
    quantity: quantity,
    variant: variant,
    fromLabId: fromLabId,
    toLabId: 'faculty',
    condition: 'good',
    notes: `Issued to faculty from ${fromLabId}`,
    createdBy: req.userId
  });

  res.status(200).json({ message: 'Glassware allocated to faculty' });
});

// Internal function for allocating glassware to faculty (for unified request fulfillment)
exports.allocateGlasswareToFacultyInternal = async function({ allocations, fromLabId, adminId }) {
  // allocations: [{ glasswareId, quantity }]
  try {
    for (const alloc of allocations) {
      const { glasswareId, quantity } = alloc;
      const labStock = await GlasswareLive.findOne({ _id: glasswareId, labId: fromLabId });
      if (!labStock || labStock.quantity < quantity) {
        return { success: false, message: `Insufficient stock for glassware ${glasswareId}` };
      }
      labStock.quantity -= quantity;
      await labStock.save();

      // Create glassware-specific transaction record only
      await GlasswareTransaction.create({
        glasswareLiveId: labStock._id,
        glasswareName: labStock.name,
        transactionType: 'transfer',
        quantity: quantity,
        variant: labStock.variant,
        fromLabId,
        toLabId: 'faculty',
        condition: 'good',
        notes: `Internal transfer to faculty from ${fromLabId}`,
        createdBy: adminId
      });
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

// Get central/lab stock
const getGlasswareStock = asyncHandler(async (req, res) => {
  const { labId } = req.query;
  
  // If no labId is provided, get stock from all labs
  // If labId is provided, filter by that specific lab
  const filter = labId ? { labId } : {};
  
  try {
    const stock = await GlasswareLive.find(filter)
      .populate('productId', 'name unit variant')
      .sort({ name: 1, labId: 1 });
    
    res.status(200).json(stock);
  } catch (error) {
    console.error('Error fetching glassware stock:', error);
    res.status(500).json({ message: 'Failed to fetch glassware stock' });
  }
});

// Get available glassware in Central Store (for allocation forms)
const getCentralAvailableGlassware = asyncHandler(async (req, res) => {
  try {
    const stock = await GlasswareLive.find({ labId: 'central-store' })
      .populate('productId', 'name unit variant')
      .select('_id productId name variant quantity unit expiryDate qrCodeImage qrCodeData');
    // Ensure name/unit/variant are always present (from product if missing)
    const result = stock.map(item => {
      let name = item.name;
      let unit = item.unit;
      let variant = item.variant;
      if ((!name || !unit) && item.productId && typeof item.productId === 'object') {
        name = name || item.productId.name;
        unit = unit || item.productId.unit;
        variant = variant || item.productId.variant;
      }
      return {
        _id: item._id,
        productId: item.productId._id ? item.productId._id : item.productId,
        name,
        variant,
        quantity: item.quantity,
        unit,
        expiryDate: item.expiryDate,
        qrCodeImage: item.qrCodeImage || null, // Ensure QR code image is included
        qrCodeData: item.qrCodeData || null // Include QR code data for scanning
      };
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch available glassware', error: err.message });
  }
});

// QR code scan endpoint: returns stock and transaction history for a glassware item
const scanGlasswareQRCode = asyncHandler(async (req, res) => {
  try {
    const { qrCodeData } = req.body;
    if (!qrCodeData) {
      return res.status(400).json({ message: 'qrCodeData is required' });
    }
    // Parse QR code data
    let parsed;
    try {
      parsed = typeof qrCodeData === 'string' ? JSON.parse(qrCodeData) : qrCodeData;
    } catch (err) {
      return res.status(400).json({ message: 'Invalid QR code data' });
    }
    const { productId, variant, batchId } = parsed;
    if (!productId || !variant || !batchId) {
      return res.status(400).json({ message: 'QR code missing required fields' });
    }
    
    // Find all stock entries for this batchId (across all labs)
    const stock = await GlasswareLive.find({ productId, variant, batchId });
    
    // Find all glassware transactions for this batchId
    const transactions = await GlasswareTransaction.find({
      batchId: batchId
    })
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 });
    
    res.status(200).json({
      stock,
      transactions
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to scan QR code', error: err.message });
  }
});

// @desc    Create a glassware transaction
// @route   POST /api/glassware/transaction
// @access  Private
const createGlasswareTransaction = asyncHandler(async (req, res) => {
  const { 
    glasswareLiveId, 
    transactionType, 
    quantity, 
    fromLabId, 
    toLabId, 
    reason, 
    condition, 
    notes 
  } = req.body;

  if (!glasswareLiveId || !transactionType || !quantity) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: glasswareLiveId, transactionType, quantity'
    });
  }

  try {
    // Find the glassware
    const glassware = await GlasswareLive.findById(glasswareLiveId);
    if (!glassware) {
      return res.status(404).json({
        success: false,
        message: 'Glassware not found'
      });
    }

    // Validate quantity for outgoing transactions
    if (['issue', 'allocation', 'transfer', 'broken'].includes(transactionType)) {
      if (glassware.quantity < quantity) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient quantity available'
        });
      }
    }

    // Create the transaction
    const transaction = await GlasswareTransaction.create({
      glasswareLiveId,
      glasswareName: glassware.name,
      transactionType,
      quantity,
      variant: glassware.variant,
      fromLabId,
      toLabId,
      reason,
      condition: condition || 'good',
      batchId: glassware.batchId,
      notes,
      createdBy: req.userId
    });

    // Update glassware quantity based on transaction type
    let quantityChange = 0;
    switch (transactionType) {
      case 'entry':
      case 'return':
        quantityChange = quantity;
        break;
      case 'issue':
      case 'allocation':
      case 'transfer':
      case 'broken':
        quantityChange = -quantity;
        break;
    }

    glassware.quantity += quantityChange;
    if (condition) {
      glassware.condition = condition;
    }
    await glassware.save();

    res.status(201).json({
      success: true,
      message: 'Glassware transaction created successfully',
      data: transaction
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: error.message
    });
  }
});

// @desc    Get glassware transaction history
// @route   GET /api/glassware/transactions/:glasswareId
// @access  Private
const getGlasswareTransactionHistory = asyncHandler(async (req, res) => {
  try {
    const { glasswareId } = req.params;
    
    const transactions = await GlasswareTransaction.find({ glasswareLiveId: glasswareId })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transaction history',
      error: error.message
    });
  }
});

// @desc    Get all glassware transactions for a lab
// @route   GET /api/glassware/transactions/lab/:labId
// @access  Private
const getLabGlasswareTransactions = asyncHandler(async (req, res) => {
  try {
    const { labId } = req.params;
    const { page = 1, limit = 50, transactionType } = req.query;

    const filter = {
      $or: [
        { fromLabId: labId },
        { toLabId: labId }
      ]
    };

    if (transactionType) {
      filter.transactionType = transactionType;
    }

    const transactions = await GlasswareTransaction.find(filter)
      .populate('glasswareLiveId', 'name variant')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await GlasswareTransaction.countDocuments(filter);

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: transactions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lab transactions',
      error: error.message
    });
  }
});

// @desc    Mark glassware as broken
// @route   POST /api/glassware/:id/broken
// @access  Private
const markGlasswareAsBroken = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, reason, notes } = req.body;

    const glassware = await GlasswareLive.findById(id);
    if (!glassware) {
      return res.status(404).json({
        success: false,
        message: 'Glassware not found'
      });
    }

    if (glassware.quantity < quantity) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient quantity to mark as broken'
      });
    }

    // Create broken transaction
    await GlasswareTransaction.create({
      glasswareLiveId: id,
      glasswareName: glassware.name,
      transactionType: 'broken',
      quantity,
      variant: glassware.variant,
      fromLabId: glassware.labId,
      reason,
      condition: 'broken',
      previousCondition: glassware.condition || 'good',
      notes,
      createdBy: req.userId
    });

    // Update glassware quantity
    glassware.quantity -= quantity;
    await glassware.save();

    res.status(200).json({
      success: true,
      message: 'Glassware marked as broken successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark glassware as broken',
      error: error.message
    });
  }
});

module.exports = {
  addGlasswareToCentral,
  allocateGlasswareToLab,
  allocateGlasswareToFaculty,
  getGlasswareStock,
  getCentralAvailableGlassware,
  scanGlasswareQRCode,
  createGlasswareTransaction,
  getGlasswareTransactionHistory,
  getLabGlasswareTransactions,
  markGlasswareAsBroken,
  allocateGlasswareToFacultyInternal: exports.allocateGlasswareToFacultyInternal
};
