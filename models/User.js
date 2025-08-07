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
        // labId is required only if:
        // 1. User is lab_assistant AND
        // 2. No labAssignments are provided (fallback to legacy single lab)
        return this.role === 'lab_assistant' && (!this.labAssignments || this.labAssignments.length === 0);
      },
    },
    labName: { type: String }, // Denormalized lab name for performance (auto-synced)
    
    // Lab Assignments for Multi-Lab Assistant Feature
    labAssignments: [
      {
        labId: {
          type: String,
          required: true,
          validate: {
            validator: async function(value) {
              // Prevent assignment to central-store
              if (value === 'central-store') {
                return false;
              }
              
              // Validate lab exists and is active
              const Lab = require('./Lab');
              const lab = await Lab.findOne({ labId: value, isActive: true });
              return !!lab;
            },
            message: 'Invalid lab ID, lab is inactive, or central-store is not allowed'
          }
        },
        labName: {
          type: String,
          required: true
        },
        permission: {
          type: String,
          enum: ['read', 'read_write'],
          default: 'read',
          required: true
        },
        assignedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: false, // Not required during registration
          default: null, // Will be set by the system or admin user
          validate: {
            validator: function(value) {
              // Allow null, undefined, or valid ObjectId
              return value === null || value === undefined || mongoose.Types.ObjectId.isValid(value);
            },
            message: 'assignedBy must be a valid ObjectId or null'
          }
        },
        assignedAt: {
          type: Date,
          default: Date.now
        },
        isActive: {
          type: Boolean,
          default: true
        }
      }
    ],
    
    lastLogin: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Pre-save middleware to auto-populate labName and labAssignments
userSchema.pre('save', async function(next) {
  // Handle legacy labId field
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
  
  // Handle labAssignments labName auto-population
  if (this.isModified('labAssignments') && this.labAssignments?.length > 0) {
    try {
      const Lab = require('./Lab');
      for (let assignment of this.labAssignments) {
        if (assignment.isModified('labId') || !assignment.labName) {
          const lab = await Lab.findOne({ labId: assignment.labId, isActive: true });
          if (lab) {
            assignment.labName = lab.labName;
          }
        }
      }
    } catch (error) {
      console.error('Error auto-populating labName for lab assignments:', error);
    }
  }
  
  next();
});

// Instance methods for lab assignment management
userSchema.methods.addLabAssignment = function(labId, permission, assignedBy) {
  // Check if assignment already exists
  const existingAssignment = this.labAssignments.find(
    assignment => assignment.labId === labId && assignment.isActive
  );
  
  if (existingAssignment) {
    throw new Error(`Lab assignment for ${labId} already exists`);
  }
  
  // Add new assignment
  this.labAssignments.push({
    labId,
    permission,
    assignedBy,
    assignedAt: new Date(),
    isActive: true
  });
};

userSchema.methods.updateLabAssignment = function(labId, updates) {
  const assignment = this.labAssignments.find(
    assignment => assignment.labId === labId && assignment.isActive
  );
  
  if (!assignment) {
    throw new Error(`Lab assignment for ${labId} not found`);
  }
  
  // Update allowed fields
  if (updates.permission) assignment.permission = updates.permission;
  if (updates.isActive !== undefined) assignment.isActive = updates.isActive;
};

userSchema.methods.removeLabAssignment = function(labId) {
  const assignment = this.labAssignments.find(
    assignment => assignment.labId === labId && assignment.isActive
  );
  
  if (!assignment) {
    throw new Error(`Lab assignment for ${labId} not found`);
  }
  
  assignment.isActive = false;
};

userSchema.methods.getActiveLabAssignments = function() {
  return this.labAssignments.filter(assignment => assignment.isActive);
};

userSchema.methods.hasLabAccess = function(labId) {
  return this.labAssignments.some(
    assignment => assignment.labId === labId && assignment.isActive
  );
};

userSchema.methods.getLabPermission = function(labId) {
  const assignment = this.labAssignments.find(
    assignment => assignment.labId === labId && assignment.isActive
  );
  return assignment ? assignment.permission : null;
};

// Pre-save middleware to handle special cases
userSchema.pre('save', function(next) {
  // Handle assignedBy field for lab assignments during registration
  if (this.isNew && this.labAssignments && this.labAssignments.length > 0) {
    this.labAssignments.forEach(assignment => {
      // If assignedBy is not set or is null, leave it as null (system assignment)
      if (!assignment.assignedBy) {
        assignment.assignedBy = null;
      }
    });
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
