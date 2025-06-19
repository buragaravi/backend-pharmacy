const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  unit: {
    type: String,
    trim: true,
    maxlength: [20, 'Unit cannot exceed 20 characters']
  },
  thresholdValue: {
    type: Number,
    required: [true, 'Threshold value is required'],
    min: [0, 'Threshold value cannot be negative']
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: {
      values: ['chemical', 'glassware', 'equipment', 'others'],
      message: 'Category must be either chemical, glassware, equipment, or others'
    },
    lowercase: true
  },
  subCategory: {
    type: String,
    required: false,
    trim: true,
    maxlength: [50, 'Subcategory cannot exceed 50 characters']
  },
  variant: {
    type: String,
    required: function() { return this.category !== 'chemical'; },
    trim: true,
    maxlength: [50, 'Variant cannot exceed 50 characters']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better performance
productSchema.index({ name: 1 }); // For faster searching by name
productSchema.index({ category: 1 }); // For faster filtering by category

module.exports = mongoose.model('Product', productSchema);