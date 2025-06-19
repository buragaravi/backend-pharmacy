const GlasswareLive = require('../models/GlasswareLive');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const QRCode = require('qrcode');


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
    labId: 'central-lab'
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
      labId: 'central-lab'
    });

    // 2. If no matching glassware exists, create new with QR code
    if (!existingItem) {
      const qrCodeData = generateQRCodeData(productId, variant, batchId);
      const qrCodeImage = await generateQRCodeImage(qrCodeData);

      const newItem = await GlasswareLive.create({
        ...item,
        labId: 'central-lab',
        batchId,
        department,
        vendor,
        pricePerUnit,
        addedBy: req.userId,
        qrCodeData,
        qrCodeImage
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
          labId: 'central-lab',
        }).session(session);

        if (!glasswareDetails) {
          allocationResults.push({
            glasswareId,
            success: false,
            message: 'Glassware not found in central lab or out of stock'
          });
          hasErrors = true;
          continue;
        }

        // FIFO allocation
        const centralStocks = await GlasswareLive.find({
          _id: glasswareId,
          labId: 'central-lab',
        })
          .sort({  createdAt: 1 })
          .limit(100)
          .session(session);

        if (!centralStocks.length) {
          console.log(`No available stock for glassware ${glasswareId}`);
          allocationResults.push({
            glasswareId,
            success: false,
            message: 'Insufficient stock in central lab'
          });
          hasErrors = true;
          continue;
        }

        let totalAllocated = 0;
        const transactionRecords = [];

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

          transactionRecords.push({
            chemicalName: central.name,
            transactionType: 'allocation',
            chemicalLiveId: labStock._id,
            fromLabId: 'central-lab',
            toLabId,
            quantity: allocQty,
            unit: central.unit,
            createdBy: req.user?._id || req.userId || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
            timestamp: new Date()
          });

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
            message: 'Insufficient stock in central lab (partial allocation)'
          });
          hasErrors = true;
        } else {
          // Batch insert transactions for this allocation
          await Transaction.insertMany(transactionRecords, { session });
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
      await Transaction.create({
        transactionType: 'transfer',
        chemicalName: labStock.name,
        fromLabId,
        toLabId: 'faculty',
        chemicalLiveId: labStock._id,
        quantity,
        unit: labStock.unit,
        createdBy: adminId,
        timestamp: new Date(),
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
  const filter = labId ? { labId } : 'central-lab';
  if (!filter) {
    return res.status(400).json({ message: 'Lab ID is required' });
  }
  const stock = await GlasswareLive.find(filter);
  res.status(200).json(stock);
});

// Get available glassware in central lab (for allocation forms)
const getCentralAvailableGlassware = asyncHandler(async (req, res) => {
  try {
    const stock = await GlasswareLive.find({ labId: 'central-lab' })
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
    // Find all transactions for this batchId (across all labs)
    const transactions = await Transaction.find({
      chemicalName: { $exists: true },
      $or: [
        { 'chemicalName': { $regex: variant, $options: 'i' } },
        { 'chemicalName': { $regex: batchId, $options: 'i' } }
      ]
    }).sort({ timestamp: -1 });
    res.status(200).json({
      stock,
      transactions
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to scan QR code', error: err.message });
  }
});

module.exports = {
  addGlasswareToCentral,
  allocateGlasswareToLab,
  allocateGlasswareToFaculty,
  getGlasswareStock,
  getCentralAvailableGlassware,
  scanGlasswareQRCode, // <-- export new endpoint
  allocateGlasswareToFacultyInternal: exports.allocateGlasswareToFacultyInternal // <-- export internal function
};
