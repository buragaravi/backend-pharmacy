const mongoose = require('mongoose');

const voucherSchema = new mongoose.Schema({
  voucherId: {
    type: Number,
    required: true,
    unique: true
  },
  category: {
    type: String,
    required: true,
    enum: ['invoice', 'request', 'allocation', 'indent', 'quotation']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

voucherSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Voucher', voucherSchema);
