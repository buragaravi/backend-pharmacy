const mongoose = require('mongoose');

const SubjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    maxlength: 20,
    unique: true // Global unique constraint for subject codes
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
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

// Compound index for course + subject combination
SubjectSchema.index({ courseId: 1, code: 1 });
SubjectSchema.index({ isActive: 1 });

// Virtual for course details
SubjectSchema.virtual('course', {
  ref: 'Course',
  localField: 'courseId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
SubjectSchema.set('toJSON', { virtuals: true });
SubjectSchema.set('toObject', { virtuals: true });

// Pre-save middleware to validate course exists
SubjectSchema.pre('save', async function(next) {
  if (this.isModified('courseId')) {
    const Course = mongoose.model('Course');
    const courseExists = await Course.findById(this.courseId);
    if (!courseExists) {
      throw new Error('Invalid course reference');
    }
  }
  next();
});

module.exports = mongoose.model('Subject', SubjectSchema);
