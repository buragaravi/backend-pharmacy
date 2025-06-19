const mongoose = require('mongoose');

const equipmentLiveSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true }, // Unique per item
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  variant: { type: String },
  labId: {
    type: String,
    required: true,
    enum: ['LAB01', 'LAB02', 'LAB03', 'LAB04', 'LAB05', 'LAB06', 'LAB07', 'LAB08', 'central-lab'],
  },
  status: { type: String, enum: ['Available', 'Issued', 'Assigned','Maintenance', 'Discarded'], default: 'Available' },
  location: { type: String, default: 'Central Store' },
  assignedTo: { type: String, default: null },
  warranty: { type: String },
  maintenanceCycle: { type: String },
  auditLogs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentAuditLog' }],
  transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EquipmentTransaction' }],
  unit: { type: String },
  expiryDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  batchId: { type: String },
  qrCodeData: { type: String },
  qrCodeImage: { type: String },
  vendor: { type: String },
  pricePerUnit: { type: Number },
  department: { type: String },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});

equipmentLiveSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('EquipmentLive', equipmentLiveSchema);
