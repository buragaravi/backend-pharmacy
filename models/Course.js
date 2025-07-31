const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  courseName: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true 
  },
  courseCode: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    trim: true 
  },
  description: {
    type: String,
    trim: true
  },
  batches: [{
    batchName: { 
      type: String, 
      required: true,
      trim: true 
    },
    batchCode: { 
      type: String, 
      required: true,
      trim: true 
    },
    academicYear: { 
      type: String, 
      required: true,
      match: /^\d{4}-\d{2}$/ // Format: 2024-25
    },
    numberOfStudents: { 
      type: Number, 
      min: 1,
      required: false 
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    createdAt: { 
      type: Date, 
      default: Date.now 
    }
  }],
  isActive: { 
    type: Boolean, 
    default: true 
  },
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

// Validation: At least one batch required
courseSchema.pre('save', function(next) {
  if (this.batches.length === 0) {
    return next(new Error('Course must have at least one batch'));
  }
  
  // Ensure batch codes are unique within the course and academic year combination
  const batchIdentifiers = this.batches.map(b => `${b.batchCode}-${b.academicYear}`);
  const uniqueIdentifiers = [...new Set(batchIdentifiers)];
  if (batchIdentifiers.length !== uniqueIdentifiers.length) {
    return next(new Error('Batch codes must be unique within the same academic year for a course'));
  }
  
  next();
});

// Index for efficient searching
courseSchema.index({ courseCode: 1 });
courseSchema.index({ 'batches.academicYear': 1 });
courseSchema.index({ 'batches.batchCode': 1 });

// Virtual to get active batches only
courseSchema.virtual('activeBatches').get(function() {
  return this.batches.filter(batch => batch.isActive);
});

// Ensure virtual fields are serialized
courseSchema.set('toJSON', { virtuals: true });

const Course = mongoose.model('Course', courseSchema);

module.exports = Course;
