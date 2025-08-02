const mongoose = require('mongoose');

const otherProductLiveSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  variant: { type: String },
  labId: { type: String, required: true }, // 'central-store' or lab code
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

module.exports = mongoose.model('OtherProductLive', otherProductLiveSchema);
