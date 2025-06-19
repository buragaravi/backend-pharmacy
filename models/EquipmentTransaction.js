const mongoose = require('mongoose');

const equipmentTransactionSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  action: { type: String, enum: ['issue', 'assign','returned to lab', 'returned','return','discard', 'maintenance'], required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  performedByRole: { type: String },
  fromLocation: { type: String },
  toLocation: { type: String },
  assignedTo: { type: String },
  remarks: { type: String },
  interface: { type: String, enum: ['web', 'mobile'], default: 'web' },
  timestamp: { type: Date, default: Date.now },
  condition: { type: String },
});

module.exports = mongoose.model('EquipmentTransaction', equipmentTransactionSchema);
