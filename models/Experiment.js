const mongoose = require('mongoose');

const experimentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: false  // Temporarily remove required for debugging
  },
  // Keep old subject field for backward compatibility during migration
  subject: {
    type: String,
    trim: true
  },
  // Keep semester field but make it optional for backward compatibility
  semester: {
    type: Number,
    min: 1,
    max: 10
  },
  description: {
    type: String,
    trim: true
  },
  defaultChemicals: [{
    chemicalName: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String,
      required: true
    }
  }],
  averageUsage: [{
    chemicalName: String,
    averageQuantity: Number,
    unit: String,
    lastUpdated: Date
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Virtual to get course information through subject
experimentSchema.virtual('course', {
  ref: 'Course',
  localField: 'subjectId',
  foreignField: '_id',
  justOne: true,
  populate: {
    path: 'subjectId',
    populate: {
      path: 'courseId'
    }
  }
});

// Virtual to get subject details
experimentSchema.virtual('subjectDetails', {
  ref: 'Subject',
  localField: 'subjectId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
experimentSchema.set('toJSON', { virtuals: true });
experimentSchema.set('toObject', { virtuals: true });

// Index for efficient querying
experimentSchema.index({ semester: 1, subjectId: 1 });
experimentSchema.index({ subjectId: 1 });
experimentSchema.index({ name: 'text' });

// Pre-save middleware to validate subject exists
experimentSchema.pre('save', async function(next) {
  if (this.isModified('subjectId')) {
    const Subject = mongoose.model('Subject');
    const subjectExists = await Subject.findById(this.subjectId);
    if (!subjectExists) {
      throw new Error('Invalid subject reference');
    }
  }
  next();
});

const Experiment = mongoose.model('Experiment', experimentSchema);

module.exports = Experiment; 