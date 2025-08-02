const EquipmentLive = require('../models/EquipmentLive');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const EquipmentTransaction = require('../models/EquipmentTransaction');
const EquipmentAuditLog = require('../models/EquipmentAuditLog');
const EquipmentStockCheck = require('../models/EquipmentStockCheck');
const User = require('../models/User');
const path = require('path');
const fs = require('fs');

// Helper: generate equipment batch ID
function generateEquipmentBatchId() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `EQUIP-${ymd}-${random}`;
}

// Helper: get latest equipment batch ID from DB
async function getLastUsedEquipmentBatchId() {
  const latest = await EquipmentLive.findOne({ batchId: { $exists: true }, labId: 'central-store' })
    .sort({ createdAt: -1 })
    .select('batchId');
  return latest?.batchId || null;
}

// Helper: generate QR code data string
function generateQRCodeData(productId, variant, batchId) {
  return JSON.stringify({
    type: 'equipment',
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

// Add equipment to central store after invoice (item-level)
const addEquipmentToCentral = asyncHandler(async (req, res) => {
  const { items, usePreviousBatchId, userId, userRole } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No equipment items provided' });
  }
  let batchId;
  if (usePreviousBatchId) {
    batchId = await getLastUsedEquipmentBatchId();
  } else {
    batchId = generateEquipmentBatchId();
  }
  const savedItems = [];
  const qrCodes = [];
  for (const item of items) {
    let { productId, name, variant, quantity, vendor, pricePerUnit, department, unit, expiryDate, warranty, maintenanceCycle } = item;
    for (let i = 0; i < Number(quantity); i++) {
      const itemId = uuidv4();
      const qrCodeData = JSON.stringify({
        type: 'equipment',
        itemId,
        productId,
        name,
        variant,
        batchId,
        createdAt: new Date(),
      });
      const qrCodeImage = await generateQRCodeImage(qrCodeData);
      const newItem = await EquipmentLive.create({
        itemId,
        productId,
        name,
        variant,
        labId: 'central-store',
        status: 'Available',
        location: 'Central Store',
        assignedTo: null,
        warranty,
        maintenanceCycle,
        unit,
        expiryDate,
        batchId,
        qrCodeData,
        qrCodeImage,
        vendor,
        pricePerUnit,
        department,
        addedBy: req.userId || userId || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
      });
      savedItems.push(newItem);
      qrCodes.push({ itemId, qrCodeImage });
      // Audit log for registration
      await EquipmentAuditLog.create({
        itemId,
        action: 'register',
        performedBy: req.userId || userId || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
        performedByRole: req.userRole || 'admin' || userRole,
        remarks: 'Stock entry',
        interface: 'web',
      });
    }
  }
  res.status(201).json({
    message: 'Equipment items registered successfully',
    batchId,
    items: savedItems,
    qrCodes
  });
});

// Allocate equipment from central to lab (FIFO, transaction, expiry-aware)
const allocateEquipmentToLab = asyncHandler(async (req, res) => {
  const { productId, variant, quantity, toLabId } = req.body;
  if (!productId || !variant || !quantity || !toLabId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let remainingQty = quantity;
    // FIFO: sort by earliest expiry if present, else by createdAt
    const centralStocks = await EquipmentLive.find({
      productId, labId: 'central-store', variant, quantity: { $gt: 0 }
    }).sort({ expiryDate: 1, createdAt: 1 }).session(session);
    if (!centralStocks.length) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Insufficient stock in Central Store' });
    }
    let totalAllocated = 0;
    for (const central of centralStocks) {
      if (remainingQty <= 0) break;
      const allocQty = Math.min(central.quantity, remainingQty);
      const updatedCentral = await EquipmentLive.findOneAndUpdate(
        { _id: central._id, quantity: { $gte: allocQty } },
        { $inc: { quantity: -allocQty } },
        { session, new: true }
      );
      if (!updatedCentral) {
        await session.abortTransaction();
        return res.status(400).json({ message: 'Stock concurrency error' });
      }
      // Add/increment to lab
      let labStock = await EquipmentLive.findOneAndUpdate(
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
    res.status(200).json({ message: 'Equipment allocated to lab', allocated: totalAllocated });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ message: 'Allocation failed', error: err.message });
  } finally {
    session.endSession();
  }
});

// Allocate equipment from lab to faculty
const allocateEquipmentToFaculty = asyncHandler(async (req, res) => {
  const { productId, variant, quantity, fromLabId } = req.body;
  if (!productId || !variant || !quantity || !fromLabId) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  // Decrement from lab
  const labStock = await EquipmentLive.findOne({ productId, labId: fromLabId, variant });
  if (!labStock || labStock.quantity < quantity) {
    return res.status(400).json({ message: 'Insufficient stock in lab' });
  }
  labStock.quantity -= quantity;
  const updatedLabStock = await labStock.save();
  res.status(200).json({ message: 'Equipment allocated to faculty' });
});

// Allocate equipment to lab by QR scan (itemId)
const allocateEquipmentToLabByScan = asyncHandler(async (req, res) => {
  const { itemId, toLabId } = req.body;
  if (!itemId || !toLabId) {
    return res.status(400).json({ message: 'Missing required fields (itemId, toLabId)' });
  }
  const item = await EquipmentLive.findOne({ itemId });
  if (!item) {
    return res.status(404).json({ message: 'Equipment item not found' });
  }
  if (item.status !== 'Available' || item.labId !== 'central-store') {
    return res.status(400).json({ message: 'Item not available for allocation' });
  }
  item.status = 'Issued';
  item.labId = toLabId;
  item.location = toLabId;
  item.assignedTo = toLabId;
  await item.save();
  // Log transaction
  await EquipmentTransaction.create({
    itemId,
    action: 'issue',
    performedBy: req.userId || req.user?._id || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
    performedByRole: req.userRole || req.user?.role ||'admin',
    fromLocation: 'central-store',
    toLocation: toLabId,
    assignedTo: toLabId,
    remarks: 'Allocated to lab',
    interface: 'web',
  });
  // Audit log
  await EquipmentAuditLog.create({
    itemId,
    action: 'issue',
    performedBy: req.userId || req.user?._id || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
    performedByRole: req.userRole || req.user?.role ||'admin',
    remarks: 'Allocated to lab',
    interface: 'web',
  });
  res.status(200).json({ message: 'Equipment item allocated to lab', item });
});

// Return equipment to central by QR scan (itemId)
const returnEquipmentToCentral = asyncHandler(async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) {
    return res.status(400).json({ message: 'Missing required field: itemId' });
  }
  const item = await EquipmentLive.findOne({ itemId });
  if (!item) {
    return res.status(404).json({ message: 'Equipment item not found' });
  }
  if (item.status !== 'Issued') {
    return res.status(400).json({ message: 'Item is not currently issued' });
  }
  item.status = 'Available';
  item.labId = 'central-store';
  item.location = 'Central Store';
  item.assignedTo = null;
  await item.save();
  // Log transaction
  await EquipmentTransaction.create({
    itemId,
    action: 'return',
    performedBy: req.userId || req.user?._id || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
    performedByRole: req.userRole || req.user?.role ||'admin',
    fromLocation: item.labId,
    toLocation: 'central-store',
    assignedTo: null,
    remarks: 'Returned to central',
    interface: 'web',
  });
  // Audit log
  await EquipmentAuditLog.create({
    itemId,
    action: 'return',
    performedBy: req.userId || req.user?._id || new mongoose.Types.ObjectId('68272133e26ef88fb399cd75'),
    performedByRole: req.userRole || req.user?.role ||'admin',
    remarks: 'Returned to central',
    interface: 'web',
  });
  res.status(200).json({ message: 'Equipment item returned to central', item });
});

// Get central/lab stock
const getEquipmentStock = asyncHandler(async (req, res) => {
  const { labId } = req.query;
  const filter = labId ? { labId } : {};
  const stock = await EquipmentLive.find(filter);
  res.status(200).json(stock);
});

// Get all live equipment from all labs (detailed information)
const getCentralAvailableEquipment = asyncHandler(async (req, res) => {
  try {
    console.log('Fetching all equipment from all labs...');
    
    // Fetch ALL equipment from ALL labs - no labId filter
    const stock = await EquipmentLive.find({})
      .populate('productId', 'name unit variant category subCategory thresholdValue')
      .populate('addedBy', 'name email')
      .sort({ createdAt: -1 });

    console.log(`Found ${stock.length} equipment items across all labs`);

    // Ensure name/unit/variant are always present (from product if missing)
    const result = stock.map(item => {
      let name = item.name;
      let unit = item.unit;
      let variant = item.variant;

      if ((!name || !unit || !variant) && item.productId && typeof item.productId === 'object') {
        name = name || item.productId.name;
        unit = unit || item.productId.unit;
        variant = variant || item.productId.variant;
      }

      return {
        _id: item._id,
        itemId: item.itemId,
        status: item.status,
        location: item.location,
        labId: item.labId,
        assignedTo: item.assignedTo,
        batchId: item.batchId,
        productId: item.productId._id ? item.productId._id : item.productId,
        name,
        variant,
        unit,
        quantity: item.quantity || 1, // Default to 1 for equipment items
        expiryDate: item.expiryDate,
        warranty: item.warranty,
        maintenanceCycle: item.maintenanceCycle,
        vendor: item.vendor,
        pricePerUnit: item.pricePerUnit,
        department: item.department,
        qrCodeImage: item.qrCodeImage,
        qrCodeData: item.qrCodeData,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        addedBy: item.addedBy ? {
          _id: item.addedBy._id,
          name: item.addedBy.name,
          email: item.addedBy.email
        } : null,
        // Include product details if populated
        product: item.productId && typeof item.productId === 'object' ? {
          _id: item.productId._id,
          name: item.productId.name,
          category: item.productId.category,
          subCategory: item.productId.subCategory,
          variant: item.productId.variant,
          unit: item.productId.unit,
          thresholdValue: item.productId.thresholdValue
        } : null
      };
    });

    // Group by lab for better organization
    const groupedByLab = result.reduce((acc, item) => {
      const lab = item.labId || 'unknown';
      if (!acc[lab]) {
        acc[lab] = [];
      }
      acc[lab].push(item);
      return acc;
    }, {});

    // Calculate summary statistics
    const summary = {
      total: result.length,
      byLab: Object.keys(groupedByLab).map(lab => ({
        labId: lab,
        count: groupedByLab[lab].length,
        available: groupedByLab[lab].filter(item => item.status === 'Available').length,
        issued: groupedByLab[lab].filter(item => item.status === 'Issued').length,
        maintenance: groupedByLab[lab].filter(item => item.status === 'Maintenance').length,
        damaged: groupedByLab[lab].filter(item => item.status === 'Damaged').length
      })),
      byStatus: {
        available: result.filter(item => item.status === 'Available').length,
        issued: result.filter(item => item.status === 'Issued').length,
        maintenance: result.filter(item => item.status === 'Maintenance').length,
        damaged: result.filter(item => item.status === 'Damaged').length
      }
    };

    console.log('Equipment summary:', summary);

    res.status(200).json({
      success: true,
      data: result,
      groupedByLab,
      summary
    });
  } catch (err) {
    console.error('Failed to fetch equipment:', err);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch equipment', 
      error: err.message 
    });
  }
});

// QR code scan endpoint: returns stock and transaction history for an equipment item
const scanEquipmentQRCode = asyncHandler(async (req, res) => {
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
    const { productId, variant, batchId, itemId } = parsed;
    if (!itemId || !variant || !batchId) {
      return res.status(400).json({ message: 'QR code missing required fields' });
    }
    // Find all stock entries for this batchId (across all labs)
    const stock = await EquipmentLive.find({  variant, batchId, itemId });
    // Find all transactions for this batchId (across all labs)
    const transactions = await Transaction.find({
      chemicalName: { $exists: true },
      $or: [
        { 'chemicalName': { $regex: variant, $options: 'i' } },
        { 'chemicalName': { $regex: batchId, $options: 'i' } }
      ]
    }).sort({ timestamp: -1 });

    // Find EquipmentTransaction and EquipmentAuditLog for this itemId (if present)
    let equipmentTransactions = [];
    let equipmentAuditLogs = [];
    if (itemId) {
      equipmentTransactions = await EquipmentTransaction.find({ itemId }).sort({ createdAt: -1 });
      equipmentAuditLogs = await EquipmentAuditLog.find({ itemId }).sort({ createdAt: -1 });
    }

    res.status(200).json({
      stock,
      transactions,
      equipmentTransactions,
      equipmentAuditLogs
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to scan QR code', error: err.message });
  }
});

// Utility: Get equipment item, transactions, and audit logs by itemId
async function getEquipmentItemFullTrace(itemId) {
  if (!itemId) throw new Error('itemId is required');
  const equipment = await EquipmentLive.findOne({ itemId });
  const transactions = await EquipmentTransaction.find({ itemId }).sort({ createdAt: -1 });
  const auditLogs = await EquipmentAuditLog.find({ itemId }).sort({ createdAt: -1 });
  return { equipment, transactions, auditLogs };
}

// @desc    Get full equipment trace (item, transactions, audit logs) by itemId
// @route   GET /api/equipment/item/:itemId/full-trace
// @access  Private (role-safe)
const getEquipmentItemFullTraceHandler = asyncHandler(async (req, res) => {
  const { itemId } = req.params;
  if (!itemId) return res.status(400).json({ message: 'itemId is required' });
  try {
    const { equipment, transactions, auditLogs } = await getEquipmentItemFullTrace(itemId);
    if (!equipment) return res.status(404).json({ message: 'Equipment item not found' });
    res.status(200).json({ equipment, transactions, auditLogs });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch equipment trace', error: err.message });
  }
});

// Start a new stock check session
exports.startStockCheck = async (req, res) => {
  try {
    const { lab } = req.query;
    const userId = req.user._id;
    const user = await User.findById(userId);
    // Get all items for the lab/location
    const filter = lab ? { location: lab } : {};
    const items = await EquipmentLive.find(filter);
    const stockCheck = await EquipmentStockCheck.create({
      performedBy: userId,
      performedByName: user.name,
      lab: lab || 'All',
      items: items.map(item => ({
        itemId: item.itemId,
        name: item.name,
        expectedLocation: item.location,
        status: 'Not Scanned',
        remarks: '',
        lastScanAt: null,
        scannedLocation: '',
      })),
      summary: {
        present: 0,
        notScanned: items.length,
        locationMismatched: 0,
        missing: 0,
        damaged: 0,
      },
    });
    res.json(stockCheck);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Scan and update item status
exports.scanStockCheckItem = async (req, res) => {
  try {
    const { stockCheckId, itemId, scannedLocation, remarks, status } = req.body;
    const stockCheck = await EquipmentStockCheck.findById(stockCheckId);
    if (!stockCheck) return res.status(404).json({ message: 'Stock check session not found' });
    const item = stockCheck.items.find(i => i.itemId === itemId);
    if (!item) return res.status(404).json({ message: 'Item not found in this stock check' });
    item.status = status || (item.expectedLocation === scannedLocation ? 'Present' : 'Location Mismatched');
    item.lastScanAt = new Date();
    item.scannedLocation = scannedLocation;
    if (remarks !== undefined) item.remarks = remarks;
    // Update summary
    stockCheck.summary.present = stockCheck.items.filter(i => i.status === 'Present').length;
    stockCheck.summary.locationMismatched = stockCheck.items.filter(i => i.status === 'Location Mismatched').length;
    stockCheck.summary.notScanned = stockCheck.items.filter(i => i.status === 'Not Scanned').length;
    stockCheck.summary.missing = stockCheck.items.filter(i => i.status === 'Missing').length;
    stockCheck.summary.damaged = stockCheck.items.filter(i => i.status === 'Damaged').length;
    await stockCheck.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Manually mark item as missing/damaged
exports.markStockCheckItem = async (req, res) => {
  try {
    const { stockCheckId, itemId, status, remarks } = req.body;
    const stockCheck = await EquipmentStockCheck.findById(stockCheckId);
    if (!stockCheck) return res.status(404).json({ message: 'Stock check session not found' });
    const item = stockCheck.items.find(i => i.itemId === itemId);
    if (!item) return res.status(404).json({ message: 'Item not found in this stock check' });
    item.status = status;
    if (remarks !== undefined) item.remarks = remarks;
    item.lastScanAt = new Date();
    // Update summary
    stockCheck.summary.present = stockCheck.items.filter(i => i.status === 'Present').length;
    stockCheck.summary.locationMismatched = stockCheck.items.filter(i => i.status === 'Location Mismatched').length;
    stockCheck.summary.notScanned = stockCheck.items.filter(i => i.status === 'Not Scanned').length;
    stockCheck.summary.missing = stockCheck.items.filter(i => i.status === 'Missing').length;
    stockCheck.summary.damaged = stockCheck.items.filter(i => i.status === 'Damaged').length;
    await stockCheck.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Finalize and save the report
exports.finalizeStockCheck = async (req, res) => {
  try {
    const { stockCheckId } = req.body;
    const stockCheck = await EquipmentStockCheck.findById(stockCheckId);
    if (!stockCheck) return res.status(404).json({ message: 'Stock check session not found' });
    stockCheck.performedAt = new Date();
    await stockCheck.save();
    res.json(stockCheck);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get all stock check reports (with filter)
const getStockCheckReports = asyncHandler(async (req, res) => {
  try {
    const { lab, from, to } = req.query;
    const filter = {};
    if (lab) filter.lab = lab;
    if (from || to) filter.performedAt = {};
    if (from) filter.performedAt.$gte = new Date(from);
    if (to) filter.performedAt.$lte = new Date(to);
    const reports = await EquipmentStockCheck.find(filter).sort({ performedAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get a single stock check report
const getStockCheckReport = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const report = await EquipmentStockCheck.findById(id);
    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Save a full stock check report (single call)
const saveStockCheckReport = asyncHandler(async (req, res) => {
  try {
    const { performedBy, performedByName, lab, items } = req.body;
    // Compute summary from items
    const summary = {
      present: 0,
      notScanned: 0,
      locationMismatched: 0,
      missing: 0,
      damaged: 0,
    };
    for (const item of items) {
      if (item.status === 'Present') summary.present++;
      else if (item.status === 'Not Scanned') summary.notScanned++;
      else if (item.status === 'Location Mismatched') summary.locationMismatched++;
      else if (item.status === 'Missing') summary.missing++;
      else if (item.status === 'Damaged') summary.damaged++;
    }
    const stockCheck = await EquipmentStockCheck.create({
      performedBy,
      performedByName,
      lab,
      items,
      summary,
      performedAt: new Date(),
    });
    res.json(stockCheck);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get live equipment by lab
const getLiveEquipmentByLab = asyncHandler(async (req, res) => {
  try {
    const { labId } = req.query;
    let filter = {};
    if (labId && labId.toLowerCase() !== 'central-store') {
      filter.location = labId;
    }
    const equipment = await EquipmentLive.find(filter);
    res.json(equipment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get stock check reports for current month
const getCurrentMonthStockCheckReports = asyncHandler(async (req, res) => {
  try {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const reports = await EquipmentStockCheck.find({
      performedAt: { $gte: firstDay, $lte: lastDay },
    }).sort({ performedAt: -1 });
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Internal function for allocating equipment to faculty (for unified request fulfillment)
// allocations: [{ name, variant, itemIds: [itemId, ...] }]
exports.allocateEquipmentToFacultyInternal = async function({ allocations, fromLabId }) {
  try {
    for (const alloc of allocations) {
      const { name, variant, itemIds } = alloc;
      if (!Array.isArray(itemIds) || itemIds.length === 0) {
        return { success: false, message: `No itemIds provided for equipment ${name} (${variant || 'N/A'})` };
      }
      // For each itemId, allocate the equipment
      for (const itemId of itemIds) {
        const item = await EquipmentLive.findOne({
          itemId,
          name,
          variant,
          labId: fromLabId,
          status: 'Available'
        });
        if (!item) {
          return { success: false, message: `Equipment item ${itemId} (${name}, ${variant}) not available in lab` };
        }
        item.status = 'Issued';
        item.labId = 'faculty';
        item.location = 'faculty';
        item.assignedTo = 'faculty';
        await item.save();
        await EquipmentTransaction.create({
          itemId: item.itemId,
          action: 'issue',
          performedByRole: 'lab_assistant',
          fromLocation: fromLabId,
          toLocation: 'faculty',
          assignedTo: 'faculty',
          remarks: 'Allocated to faculty',
          interface: 'web',
        });
        await EquipmentAuditLog.create({
          itemId: item.itemId,
          action: 'issue',
          performedByRole: 'lab_assistant',
          remarks: 'Allocated to faculty',
          interface: 'web',
        });
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
};

module.exports = {
  addEquipmentToCentral,
  allocateEquipmentToLab,
  allocateEquipmentToFaculty,
  getEquipmentStock,
  getCentralAvailableEquipment,
  scanEquipmentQRCode, // <-- export new endpoint
  allocateEquipmentToLabByScan,
  returnEquipmentToCentral,
  getEquipmentItemFullTraceHandler,
  // Stock check/report exports
  getStockCheckReports,
  getStockCheckReport,
  saveStockCheckReport,
  getLiveEquipmentByLab,
  getCurrentMonthStockCheckReports,
};
