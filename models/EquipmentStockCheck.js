const mongoose = require('mongoose');

const EquipmentStockCheckItemSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  name: String,
  expectedLocation: String,
  status: { type: String, enum: ['Not Scanned', 'Present', 'Missing', 'Damaged', 'Location Mismatched'], default: 'Not Scanned' },
  remarks: String,
  lastScanAt: Date,
  scannedLocation: String,
});

const EquipmentStockCheckSchema = new mongoose.Schema({
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  performedByName: String,
  performedAt: { type: Date, default: Date.now },
  lab: String, // or location
  items: [EquipmentStockCheckItemSchema],
  summary: {
    present: Number,
    notScanned: Number,
    locationMismatched: Number,
    missing: Number,
    damaged: Number,
  },
  exportedReportPath: String, // for PDF/Excel
});

module.exports = mongoose.model('EquipmentStockCheck', EquipmentStockCheckSchema);
