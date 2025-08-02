const mongoose = require('mongoose');
const QRCode = require('qrcode');
const OtherProductLive = require('../models/OtherProductLive');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const asyncHandler = require('express-async-handler');

// Helper: generate other product batch ID
function generateOtherProductBatchId() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `OTHER-${ymd}-${random}`;
}

// Helper: get latest other product batch ID from DB
async function getLastUsedOtherProductBatchId() {
  const latest = await OtherProductLive.findOne({ batchId: { $exists: true }, labId: 'central-store' })
    .sort({ createdAt: -1 })
    .select('batchId');
  return latest?.batchId || null;
}

// Helper: generate QR code data string
function generateQRCodeData(productId, variant, batchId) {
  return JSON.stringify({
    type: 'other',
    productId,
    variant,
    batchId,
    timestamp: Date.now()
  });
}

async function generateQRCodeImage(qrData) {
  try {
    return await QRCode.toDataURL(qrData);
  } catch (err) {
    console.error('QR generation failed:', err);
    return null;
  }
}

// Add other products to central store after invoice
const addOtherProductToCentral = asyncHandler(async (req, res) => {
  const { items, usePreviousBatchId } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No items provided' });
  }
  let batchId;
  if (usePreviousBatchId) {
    batchId = await getLastUsedOtherProductBatchId();
  } else {
    batchId = generateOtherProductBatchId();
  }
  const savedItems = [];
  const qrCodes = [];
  for (const item of items) {
    let { productId, name, variant, quantity, vendor, pricePerUnit, department } = item;
    const existing = await OtherProductLive.findOne({ productId, variant, labId: 'central-store' });
    if (!existing) {
      const qrCodeData = generateQRCodeData(productId, variant, batchId);
      const qrCodeImage = await generateQRCodeImage(qrCodeData);
      const newItem = await OtherProductLive.create({
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
      savedItems.push(newItem);
      qrCodes.push({ productId: newItem.productId, variant: newItem.variant, qrCodeImage: newItem.qrCodeImage });
      continue;
    }
    existing.quantity += Number(quantity);
    await existing.save();
    savedItems.push(existing);
  }
  res.status(201).json({
    message: 'Other products added/updated successfully',
    batchId,
    items: savedItems,
    qrCodes: qrCodes.length > 0 ? qrCodes : undefined
  });
});

// Allocate other products from central to lab (FIFO, transaction, expiry-aware)
const allocateOtherProductToLab = asyncHandler(async (req, res) => {
  const { productId, variant, quantity, toLabId } = req.body;
  if (!productId || !variant || !quantity || !toLabId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let remainingQty = quantity;
    // FIFO: sort by earliest expiry if present, else by createdAt
    const centralStocks = await OtherProductLive.find({
      productId, labId: 'central-store', variant, quantity: { $gt: 0 }
    }).sort({ expiryDate: 1, createdAt: 1 }).session(session);
    if (!centralStocks.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Insufficient stock in Central Store ' });
    }
    let totalAllocated = 0;
    for (const central of centralStocks) {
      if (remainingQty <= 0) break;
      const allocQty = Math.min(central.quantity, remainingQty);
      const updatedCentral = await OtherProductLive.findOneAndUpdate(
        { _id: central._id, quantity: { $gte: allocQty } },
        { $inc: { quantity: -allocQty } },
        { session, new: true }
      );
      if (!updatedCentral) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Stock concurrency error' });
      }
      // Add/increment to lab
      let labStock = await OtherProductLive.findOneAndUpdate(
        { productId, labId: toLabId, variant },
        { $inc: { quantity: allocQty }, $setOnInsert: {
            name: central.name,
            unit: central.unit,
            expiryDate: central.expiryDate,
            createdAt: new Date(),
            updatedAt: new Date()
          } },
        { session, new: true, upsert: true }
      );
      // Log transaction
      await Transaction.create([{
        chemicalName: central.name,
        transactionType: 'allocation',
        chemicalLiveId: labStock._id,
        fromLabId: 'central-store',
        toLabId,
        quantity: allocQty,
        unit: central.unit,
        createdBy: req.user?._id || req.userId || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
        timestamp: new Date()
      }], { session });
      totalAllocated += allocQty;
      remainingQty -= allocQty;
    }
    if (totalAllocated < quantity) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Insufficient stock in Central Store (partial allocation)', allocated: totalAllocated });
    }
    await session.commitTransaction();
    res.status(200).json({ message: 'Other product allocated to lab', allocated: totalAllocated });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ message: 'Allocation failed', error: err.message });
  } finally {
    session.endSession();
  }
});

// Allocate other products from lab to faculty
const allocateOtherProductToFaculty = asyncHandler(async (req, res) => {
  const { productId, variant, quantity, fromLabId } = req.body;
  if (!productId || !variant || !quantity || !fromLabId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  // Decrement from lab
  const labStock = await OtherProductLive.findOne({ productId, labId: fromLabId, variant });
  if (!labStock || labStock.quantity < quantity) {
    return res.status(400).json({ message: 'Insufficient stock in lab' });
  }
  labStock.quantity -= quantity;
  await labStock.save();
  res.status(200).json({ message: 'Other product allocated to faculty' });
});

// Get central/lab stock
const getOtherProductStock = asyncHandler(async (req, res) => {
  const { labId } = req.query;
  const filter = labId ? { labId } : {};
  const stock = await OtherProductLive.find(filter);
  res.status(200).json(stock);
});

// Get available other products in Central Store (for allocation forms)
const getCentralAvailableOtherProducts = asyncHandler(async (req, res) => {
  try {
    const stock = await OtherProductLive.find({ labId: 'central-store', quantity: { $gt: 0 } })
      .populate('productId', 'name unit variant')
      .select('_id productId name variant quantity unit expiryDate');
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
        expiryDate: item.expiryDate
      };
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch available other products', error: err.message });
  }
});

// QR code scan endpoint: returns stock and transaction history for an other product item
const scanOtherProductQRCode = asyncHandler(async (req, res) => {
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
    const stock = await OtherProductLive.find({ productId, variant, batchId });
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
  addOtherProductToCentral,
  allocateOtherProductToLab,
  allocateOtherProductToFaculty,
  getOtherProductStock,
  getCentralAvailableOtherProducts,
  scanOtherProductQRCode // <-- export new endpoint
};
