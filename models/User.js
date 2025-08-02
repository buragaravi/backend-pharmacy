const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      match: [/\S+@\S+\.\S+/, 'Please enter a valid email address'],
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'central_store_admin', 'lab_assistant', 'faculty'],
      required: true,
    },
    labId: {
      type: String,
      validate: {
        validator: async function(value) {
          // Only validate if labId is provided (it's conditionally required)
          if (!value) return true;
          
          // Always allow central-store
          if (value === 'central-store') return true;
          
          // For other labs, check if they exist and are active
          const Lab = require('./Lab');
          const lab = await Lab.findOne({ labId: value, isActive: true });
          return !!lab;
        },
        message: 'Invalid lab ID or lab is inactive'
      },
      required: function () {
        return this.role === 'lab_assistant';
      },
    },
    labName: { type: String }, // Denormalized lab name for performance (auto-synced)
    lastLogin: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Pre-save middleware to auto-populate labName
userSchema.pre('save', async function(next) {
  if (this.isModified('labId') && this.labId) {
    try {
      if (this.labId === 'central-store') {
        this.labName = 'Central Store';
      } else {
        const Lab = require('./Lab');
        const lab = await Lab.findOne({ labId: this.labId, isActive: true });
        if (lab) {
          this.labName = lab.labName;
        }
      }
    } catch (error) {
      console.error('Error auto-populating labName for user:', error);
    }
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
