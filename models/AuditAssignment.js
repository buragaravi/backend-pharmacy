const mongoose = require('mongoose');

// Import after module definition to avoid circular dependency
let AuditExecution;

const auditTaskSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['chemical', 'equipment', 'glassware', 'others', 'all'],
    required: true
  },
  specificItems: [{
    itemId: String,
    itemName: String,
    itemType: String
  }],
  checklistItems: [{
    item: String,
    description: String,
    required: { type: Boolean, default: true }
  }]
});

const auditAssignmentSchema = new mongoose.Schema({
  assignmentId: {
    type: String,
    unique: true
    // Removed required: true since it's auto-generated in pre-save
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  
  // Assignment Details
  assignedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Scope Definition
  labs: [{
    labId: String,
    labName: String
  }],
  auditTasks: [auditTaskSchema],
  
  // Scheduling
  dueDate: {
    type: Date,
    required: true
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  estimatedDuration: Number, // in hours
  
  // Status & Progress
  status: {
    type: String,
    enum: ['pending', 'assigned', 'in_progress', 'completed', 'overdue', 'cancelled'],
    default: 'pending'
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  
  // Completion Data
  startedAt: Date,
  completedAt: Date,
  actualDuration: Number,
  
  // Audit Results Summary
  findings: [{
    category: String,
    labId: String,
    itemsChecked: Number,
    itemsFound: Number,
    itemsMissing: Number,
    itemsDamaged: Number,
    discrepancies: [{
      itemId: String,
      itemName: String,
      issue: String,
      severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical']
      }
    }]
  }],
  
  // Reports & Documentation
  reportPath: String,
  attachments: [{
    filename: String,
    path: String,
    uploadedAt: Date
  }],
  
  // Comments & Communication
  comments: [{
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String,
    createdAt: {
      type: Date,
      default: Date.now
    },
    isInternal: {
      type: Boolean,
      default: false
    }
  }],
  
  // Priority & Importance
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringPattern: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    },
    interval: Number, // every N frequency units
    nextDueDate: Date
  }
}, {
  timestamps: true
});

// Auto-generate assignment ID
auditAssignmentSchema.pre('save', async function(next) {
  if (!this.assignmentId) {
    const count = await mongoose.model('AuditAssignment').countDocuments();
    this.assignmentId = `AUDIT-${String(count + 1).padStart(4, '0')}`;
  }
  
  // Update status based on dates
  if (this.status === 'assigned' && this.startedAt) {
    this.status = 'in_progress';
  }
  if (this.status === 'in_progress' && this.completedAt) {
    this.status = 'completed';
    this.progress = 100;
  }
  if (this.dueDate < new Date() && this.status !== 'completed') {
    this.status = 'overdue';
  }
  
  next();
});

// Instance methods
auditAssignmentSchema.methods.addFinding = function(finding) {
  this.findings.push(finding);
  this.calculateProgress();
};

auditAssignmentSchema.methods.calculateProgress = async function() {
  try {
    // Lazy load to avoid circular dependency
    if (!AuditExecution) {
      AuditExecution = require('./AuditExecution');
    }
    
    // Each assignment should have only ONE execution per run
    // Progress should be based on whether the assignment has been completed, not per task
    const completedExecutions = await AuditExecution.countDocuments({
      assignmentId: this._id,
      status: 'completed'
    });
    
    // If there's at least one completed execution for this assignment, it's 100% complete
    // Otherwise, check if there's an in-progress execution
    const inProgressExecutions = await AuditExecution.countDocuments({
      assignmentId: this._id,
      status: 'in_progress'
    });
    
    if (completedExecutions > 0) {
      this.progress = 100;
      this.status = 'completed';
    } else if (inProgressExecutions > 0) {
      this.progress = 50; // Assignment is in progress
      this.status = 'in_progress';
    } else {
      this.progress = 0;
      // Keep existing status if no executions found
    }
    
    console.log(`Assignment ${this.assignmentId} progress updated: ${this.progress}% (completed: ${completedExecutions}, in_progress: ${inProgressExecutions})`);
  } catch (error) {
    console.error('Error calculating progress:', error);
    // Fallback: don't change progress if there's an error
  }
};

auditAssignmentSchema.methods.addComment = function(authorId, message, isInternal = false) {
  this.comments.push({
    author: authorId,
    message,
    isInternal,
    createdAt: new Date()
  });
};

module.exports = mongoose.model('AuditAssignment', auditAssignmentSchema);
