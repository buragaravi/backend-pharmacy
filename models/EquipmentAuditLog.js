const mongoose = require('mongoose');

const equipmentAuditLogSchema = new mongoose.Schema({
  itemId: { type: String, required: true },
  action: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  performedByRole: { type: String },
  remarks: { type: String },
  interface: { type: String, enum: ['web', 'mobile'], default: 'web' },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model('EquipmentAuditLog', equipmentAuditLogSchema);
