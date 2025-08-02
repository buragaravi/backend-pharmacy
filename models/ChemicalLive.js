// models/ChemicalLive.js
const mongoose = require('mongoose');

const chemicalLiveSchema = new mongoose.Schema(
  {
    chemicalMasterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChemicalMaster',
      required: true,
    },
    chemicalName: { type: String, required: true }, // Suffixed name (backend use)
    displayName: { type: String, required: true },  // Clean name (frontend use)
    unit: { type: String, required: true },
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
    originalQuantity: { type: Number, required: true },
    expiryDate: { type: Date},
    isAllocated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Pre-save middleware to auto-populate labName
chemicalLiveSchema.pre('save', async function(next) {
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

module.exports = mongoose.model('ChemicalLive', chemicalLiveSchema);