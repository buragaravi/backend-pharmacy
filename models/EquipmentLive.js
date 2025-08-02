const mongoose = require('mongoose');

const equipmentLiveSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true }, // Unique per item
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  variant: { type: String },
  labId: {
    type: String,
    required: true,
    validate: {
      validator: async function(value) {
        // Always allow central-store
        if (value === 'central-store') return true;
        
        // For other labs, check if they exist and are active
        const Lab = require('./Lab');
        const lab = await Lab.findOne({ labId: value, isActive: true });
        return !!lab;
      },
      message: 'Invalid lab ID or lab is inactive'
    }
  },
  labName: { type: String }, // Denormalized lab name for performance (auto-synced)
  status: { type: String, enum: ['Available', 'Issued', 'Assigned','Maintenance', 'Discarded'], default: 'Available' },
  location: { type: String, default: 'Central Store' },
  assignedTo: { type: String, default: null },
  warranty: { type: Date },
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

// Pre-save middleware to auto-populate labName
equipmentLiveSchema.pre('save', async function(next) {
  if (this.isModified('labId') || !this.labName) {
    try {
      if (this.labId === 'central-store') {
        this.labName = 'Central Store';
      } else {
        const Lab = require('./Lab');
        const lab = await Lab.findOne({ labId: this.labId, isActive: true });
        if (lab) {
          this.labName = lab.labName;
        }
      }
    } catch (error) {
      console.error('Error auto-populating labName:', error);
    }
  }
  next();
});

module.exports = mongoose.model('EquipmentLive', equipmentLiveSchema);
