const mongoose = require('mongoose');

const otherProductLiveSchema = new mongoose.Schema({
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
  }, // 'central-store' or lab code
  labName: { type: String }, // Denormalized lab name for performance (auto-synced)
  quantity: { type: Number, required: true },
  unit: { type: String },
  expiryDate: { type: Date },
  batchId: { type: String },
  qrCodeData: { type: String },
  qrCodeImage: { type: String },
  vendor: { type: String },
  pricePerUnit: { type: Number },
  department: { type: String },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

otherProductLiveSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Pre-save middleware to auto-populate labName
otherProductLiveSchema.pre('save', async function(next) {
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

module.exports = mongoose.model('OtherProductLive', otherProductLiveSchema);
