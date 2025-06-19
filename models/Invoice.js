const mongoose = require('mongoose');

const invoiceLineItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  unit: { type: String},
  variant: { type: String },
  thresholdValue: { type: Number, required: true },
  quantity: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  pricePerUnit: { type: Number, required: true },
  expiryDate: { type: Date }
});

const invoiceSchema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true }, // auto-generated
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  vendorName: { type: String, required: true },
  invoiceNumber: { type: String, required: true },
  invoiceDate: { type: Date, required: true },
  lineItems: [invoiceLineItemSchema],
  totalInvoicePrice: { type: Number, required: true }, // <-- Add this field
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

invoiceSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Invoice', invoiceSchema);
