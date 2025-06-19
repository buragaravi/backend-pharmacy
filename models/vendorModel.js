const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Vendor name is required'],
    trim: true
  },
  address: {
    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  phone: {
    type: String,
    validate: {
      validator: function(v) {
        return /^\+?[\d\s-]{10,}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  website: {
    type: String,
    validate: {
      validator: function(v) {
        return /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/.test(v);
      },
      message: props => `${props.value} is not a valid website URL!`
    }
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  vendorCode: {
    type: String,
    unique: true,
    default: function() {
      // Generate a unique vendor code (e.g., VEND-XXXXXX)
      return 'VEND-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
vendorSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create text index for search functionality
vendorSchema.index({ name: 'text', description: 'text' });

module.exports = mongoose.model('Vendor', vendorSchema);