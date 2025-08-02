const mongoose = require('mongoose');

const glasswareLiveSchema = new mongoose.Schema({
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
  quantity: { type: Number, required: true },
  unit: { type: String },
  condition: { 
    type: String, 
    enum: ['good', 'damaged', 'broken', 'under_maintenance'],
    default: 'good'
  },
  expiryDate: { type: Date },
  warranty: { type: Date },
  qrCodeData: String,      // The encoded data string
  qrCodeImage: String,     // Base64 encoded QR image
  batchId: String,         // Added for tracking
  addedBy: {type:mongoose.Schema.Types.ObjectId, ref:'User'}, // Who added it
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

glasswareLiveSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Pre-save middleware to auto-populate labName
glasswareLiveSchema.pre('save', async function(next) {
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

module.exports = mongoose.model('GlasswareLive', glasswareLiveSchema);
