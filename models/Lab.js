const mongoose = require('mongoose');

const labSchema = new mongoose.Schema(
  {
    labId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: {
        validator: function(value) {
          // Allow central-store and custom lab IDs
          if (value === 'central-store') return true;
          // Custom lab IDs should be alphanumeric, 3-20 chars
          return /^[A-Za-z0-9_-]{3,20}$/.test(value);
        },
        message: 'Lab ID must be alphanumeric, 3-20 characters (central-store is reserved)'
      }
    },
    labName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isSystem: {
      type: Boolean,
      default: false // true for central-store, false for user-created labs
    },
    canModifyLabId: {
      type: Boolean,
      default: function() {
        return !this.isSystem; // System labs can't have labId modified
      }
    },
    canDelete: {
      type: Boolean,
      default: function() {
        return !this.isSystem; // System labs can't be deleted
      }
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function() {
        return !this.isSystem; // System labs don't need createdBy
      }
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes
labSchema.index({ labId: 1 });
labSchema.index({ isActive: 1 });
labSchema.index({ isSystem: 1 });

// Virtual for checking if lab is central-store
labSchema.virtual('isCentralStore').get(function() {
  return this.labId === 'central-store';
});

// Pre-save middleware to prevent modification of system labs
labSchema.pre('save', function(next) {
  if (this.isSystem) {
    // For system labs, only allow labName and description changes
    if (this.isModified('labId') && !this.isNew) {
      return next(new Error('Cannot modify labId of system lab'));
    }
    if (this.isModified('isSystem') && !this.isNew) {
      return next(new Error('Cannot modify isSystem flag'));
    }
    if (this.isModified('canModifyLabId') && !this.isNew) {
      return next(new Error('Cannot modify canModifyLabId for system lab'));
    }
  }
  next();
});

// Pre-remove middleware to prevent deletion of system labs
labSchema.pre('remove', function(next) {
  if (this.isSystem) {
    return next(new Error('Cannot delete system lab'));
  }
  next();
});

// Static method to get all active labs
labSchema.statics.getActiveLabs = function() {
  return this.find({ isActive: true }).sort({ isSystem: -1, labId: 1 });
};

// Static method to validate lab ID exists
labSchema.statics.validateLabId = async function(labId) {
  const lab = await this.findOne({ labId, isActive: true });
  return !!lab;
};

// Static method to get lab info by ID
labSchema.statics.getLabInfo = async function(labId) {
  return await this.findOne({ labId, isActive: true }).select('labId labName description isSystem');
};

module.exports = mongoose.model('Lab', labSchema);
