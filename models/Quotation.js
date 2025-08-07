const mongoose = require('mongoose');

const quotationSchema = new mongoose.Schema({
  createdByRole: {
    type: String,
    enum: ['lab_assistant', 'central_store_admin'],
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  labId: { type: String }, // Required for lab assistant quotes
  quotationType: {
    type: String,
    enum: ['chemicals', 'equipment', 'glassware', 'mixed'],
    default: 'chemicals'
  },
  chemicals: [
    {
      chemicalName: { type: String, required: true },
      quantity: { type: Number, required: true },
      unit: { type: String, required: true },
      pricePerUnit: { type: Number }, // optional for lab assistant
      remarks: { type: String }, // Added field for chemical-specific remarks
    }
  ],
  equipment: [
    {
      equipmentName: { type: String, required: true },
      quantity: { type: Number, required: true },
      unit: { type: String, required: true },
      pricePerUnit: { type: Number }, // optional for lab assistant
      specifications: { type: String }, // equipment specifications
      remarks: { type: String },
    }
  ],
  glassware: [
    {
      glasswareName: { type: String, required: true },
      quantity: { type: Number, required: true },
      unit: { type: String, required: true },
      pricePerUnit: { type: Number }, // optional for lab assistant
      condition: { 
        type: String, 
        enum: ['new', 'good', 'replacement'],
        default: 'new'
      },
      remarks: { type: String },
    }
  ],
  totalPrice: { type: Number },
  itemCounts: {
    chemicalCount: { type: Number, default: 0 },
    equipmentCount: { type: Number, default: 0 },
    glasswareCount: { type: Number, default: 0 },
    totalItems: { type: Number, default: 0 }
  },
  status: {
    type: String,
    enum: [
      // For Lab Assistant
      'pending', 'reviewed', 'allocated', 'partially_fulfilled', 'rejected',
      // For Central Admin
      'draft', 'suggestions', 'approved', 'purchasing', 'purchased'
    ],
    required: true,
  },
  comments: [{
    text: { type: String},
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    role: { type: String },
    createdAt: { type: Date, default: Date.now }
  }], // Array of comments for chat-like conversation
}, { timestamps: true });

// Pre-save middleware to calculate item counts
quotationSchema.pre('save', function(next) {
  this.itemCounts.chemicalCount = this.chemicals ? this.chemicals.length : 0;
  this.itemCounts.equipmentCount = this.equipment ? this.equipment.length : 0;
  this.itemCounts.glasswareCount = this.glassware ? this.glassware.length : 0;
  this.itemCounts.totalItems = this.itemCounts.chemicalCount + this.itemCounts.equipmentCount + this.itemCounts.glasswareCount;
  
  // Automatically determine quotation type
  if (this.itemCounts.chemicalCount > 0 && (this.itemCounts.equipmentCount > 0 || this.itemCounts.glasswareCount > 0)) {
    this.quotationType = 'mixed';
  } else if (this.itemCounts.equipmentCount > 0) {
    this.quotationType = 'equipment';
  } else if (this.itemCounts.glasswareCount > 0) {
    this.quotationType = 'glassware';
  } else {
    this.quotationType = 'chemicals';
  }
  
  next();
});

module.exports = mongoose.model('Quotation', quotationSchema);