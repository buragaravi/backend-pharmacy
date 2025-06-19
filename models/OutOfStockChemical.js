const mongoose = require('mongoose');

const OutOfStockChemicalSchema = new mongoose.Schema({
  displayName: { type: String, required: true, index: true },
  unit: { type: String },
  lastOutOfStock: { type: Date, default: Date.now },
});

module.exports = mongoose.model('OutOfStockChemical', OutOfStockChemicalSchema);
