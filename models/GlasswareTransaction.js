const mongoose = require('mongoose');

const glasswareTransactionSchema = new mongoose.Schema(
  {
    glasswareLiveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GlasswareLive',
      required: true,
    },
    glasswareName: {
      type: String,
      required: true,
    },
    transactionType: {
      type: String,
      enum: ['entry', 'issue', 'allocation', 'transfer', 'return', 'broken', 'maintenance'],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    variant: {
      type: String,
      required: true,
    },
    fromLabId: {
      type: String,
      enum: ['LAB01', 'LAB02', 'LAB03', 'LAB04', 'LAB05', 'LAB06', 'LAB07', 'LAB08', 'central-store','faculty'],
    },
    toLabId: {
      type: String,
      enum: ['LAB01', 'LAB02', 'LAB03', 'LAB04', 'LAB05', 'LAB06', 'LAB07', 'LAB08', 'central-store', 'faculty'],
    },
    reason: {
      type: String,
      // Required for broken/maintenance transactions
      required: function() {
        return ['broken', 'maintenance'].includes(this.transactionType);
      }
    },
    condition: {
      type: String,
      enum: ['good', 'damaged', 'broken', 'under_maintenance'],
      default: 'good',
    },
    previousCondition: {
      type: String,
      enum: ['good', 'damaged', 'broken', 'under_maintenance'],
    },
    batchId: {
      type: String,
    },
    notes: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Index for efficient querying
glasswareTransactionSchema.index({ glasswareLiveId: 1, createdAt: -1 });
glasswareTransactionSchema.index({ fromLabId: 1, toLabId: 1 });
glasswareTransactionSchema.index({ transactionType: 1, createdAt: -1 });

// Virtual for transaction direction
glasswareTransactionSchema.virtual('transactionDirection').get(function() {
  if (this.transactionType === 'entry') return 'in';
  if (this.transactionType === 'issue') return 'out';
  if (this.transactionType === 'transfer') return 'transfer';
  if (this.transactionType === 'return') return 'in';
  if (this.transactionType === 'allocation') return 'out';
  return 'other';
});

// Pre-save middleware for validation
glasswareTransactionSchema.pre('save', function(next) {
  // Validate lab IDs for transfer transactions
  if (this.transactionType === 'transfer') {
    if (!this.fromLabId || !this.toLabId) {
      return next(new Error('Transfer transactions require both fromLabId and toLabId'));
    }
    if (this.fromLabId === this.toLabId) {
      return next(new Error('Transfer transactions cannot have the same fromLabId and toLabId'));
    }
  }
  
  // Validate allocation transactions
  if (this.transactionType === 'allocation' && !this.toLabId) {
    return next(new Error('Allocation transactions require toLabId'));
  }
  
  // Validate return transactions
  if (this.transactionType === 'return' && !this.fromLabId) {
    return next(new Error('Return transactions require fromLabId'));
  }
  
  next();
});

module.exports = mongoose.model('GlasswareTransaction', glasswareTransactionSchema);
