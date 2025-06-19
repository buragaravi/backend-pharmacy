const mongoose = require('mongoose');

// Generic OutOfStock model for glassware, equipment, and other products
const OutOfStockProductSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  variant: { type: String },
  category: { type: String, enum: ['glassware', 'equipment', 'others'], required: true },
  lastOutOfStock: { type: Date, default: Date.now },
});

module.exports = mongoose.model('OutOfStockProduct', OutOfStockProductSchema);
