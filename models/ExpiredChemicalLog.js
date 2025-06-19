// models/ExpiredChemicalLog.js
const mongoose = require('mongoose');

const expiredChemicalLogSchema = new mongoose.Schema({
  chemicalLiveId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChemicalLive', required: true },
  chemicalName: { type: String, required: true },
  unit: { type: String, required: true },
  quantity: { type: Number, required: true },
  expiryDate: { type: Date, required: true },
  deletedAt: { type: Date, default: Date.now },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String },
  labId: { type: String, required: true },
  chemicalMasterId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChemicalMaster' },
}, { timestamps: true });

module.exports = mongoose.model('ExpiredChemicalLog', expiredChemicalLogSchema);
