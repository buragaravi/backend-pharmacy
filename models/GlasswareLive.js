const mongoose = require('mongoose');

const glasswareLiveSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  variant: { type: String },
  labId: {
      type: String,
      required: true,
      enum: ['LAB01', 'LAB02', 'LAB03', 'LAB04', 'LAB05', 'LAB06', 'LAB07', 'LAB08', 'central-lab'],
    },
  quantity: { type: Number, required: true },
  unit: { type: String },
  condition: { 
    type: String, 
    enum: ['good', 'damaged', 'broken', 'under_maintenance'],
    default: 'good'
  },
  expiryDate: { type: Date },
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

module.exports = mongoose.model('GlasswareLive', glasswareLiveSchema);
