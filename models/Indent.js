const mongoose = require('mongoose');

const indentSchema = new mongoose.Schema({
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
  labId: { type: String }, // Required for lab assistant indents
  vendorName: { type: String }, // Only for Central Store admin
  chemicals: [
    {
      chemicalName: { type: String, required: true },
      quantity: { type: Number, required: true },
      unit: { type: String, required: true },
      remarks: { type: String }, // Added field for chemical-specific remarks
    }
  ],
  totalPrice: { type: Number },
  status: {
    type: String,
    enum: [
      // For Lab Assistant
      'pending', 'reviewed', 'allocated', 'partially_fulfilled', 'rejected',
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

module.exports = mongoose.model('Indent', indentSchema);
