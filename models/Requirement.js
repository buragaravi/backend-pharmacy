const mongoose = require('mongoose');

// Comment schema for requirement comments
const commentSchema = new mongoose.Schema({
  comment: {
    type: String,
    required: true,
    trim: true
  },
  commentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Approval schema for tracking approval history
const approvalSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['approved', 'rejected'],
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedAt: {
    type: Date,
    default: Date.now
  },
  comment: {
    type: String,
    trim: true
  }
});

// Item schema for requirement items
const itemSchema = new mongoose.Schema({
  itemName: {
    type: String,
    required: true,
    trim: true
  },
  itemType: {
    type: String,
    enum: ['chemical', 'equipment', 'glassware'],
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    required: true,
    trim: true
  },
  specifications: {
    type: String,
    trim: true
  },
  remarks: {
    type: String,
    trim: true
  }
});

// Main requirement schema
const requirementSchema = new mongoose.Schema({
  requirementId: {
    type: String,
    unique: true
  },
  raisedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'converted_to_quotation'],
    default: 'pending'
  },
  items: [itemSchema],
  remarks: {
    type: String,
    trim: true
  },
  comments: [commentSchema],
  approvals: [approvalSchema],
  quotationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quotation'
  },
  convertedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Auto-increment requirement ID
requirementSchema.pre('save', async function(next) {
  if (this.isNew && !this.requirementId) {
    try {
      // Find the highest existing requirement ID
      const lastRequirement = await this.constructor.findOne(
        { requirementId: { $regex: /^REQ\d+$/ } },
        { requirementId: 1 }
      ).sort({ requirementId: -1 });

      let nextNumber = 1;
      if (lastRequirement && lastRequirement.requirementId) {
        const currentNumber = parseInt(lastRequirement.requirementId.replace('REQ', ''));
        nextNumber = currentNumber + 1;
      }
      
      // Format: REQ001, REQ002, etc.
      this.requirementId = `REQ${String(nextNumber).padStart(3, '0')}`;
      console.log('Generated requirementId:', this.requirementId);
      next();
    } catch (error) {
      console.error('Error generating requirementId:', error);
      next(error);
    }
  } else {
    next();
  }
});

// Indexes for better performance
requirementSchema.index({ raisedBy: 1 });
requirementSchema.index({ status: 1 });
requirementSchema.index({ priority: 1 });
requirementSchema.index({ createdAt: -1 });
requirementSchema.index({ requirementId: 1 });

// Virtual for getting total items count
requirementSchema.virtual('itemsCount').get(function() {
  return this.items.length;
});

// Virtual for getting latest comment
requirementSchema.virtual('latestComment').get(function() {
  return this.comments.length > 0 ? this.comments[this.comments.length - 1] : null;
});

// Virtual for getting latest approval
requirementSchema.virtual('latestApproval').get(function() {
  return this.approvals.length > 0 ? this.approvals[this.approvals.length - 1] : null;
});

// Method to add comment
requirementSchema.methods.addComment = function(comment, userId) {
  this.comments.push({
    comment,
    commentBy: userId
  });
  return this.save();
};

// Method to update status with approval tracking
requirementSchema.methods.updateStatus = function(status, userId, comment) {
  this.status = status;
  
  if (status === 'approved' || status === 'rejected') {
    this.approvals.push({
      status,
      approvedBy: userId,
      comment
    });
  }
  
  if (status === 'converted_to_quotation') {
    this.convertedAt = new Date();
  }
  
  return this.save();
};

// Method to link quotation
requirementSchema.methods.linkQuotation = function(quotationId) {
  this.quotationId = quotationId;
  this.status = 'converted_to_quotation';
  this.convertedAt = new Date();
  return this.save();
};

// Static method to get requirements with filters
requirementSchema.statics.getFilteredRequirements = function(filters = {}) {
  const query = {};
  
  if (filters.status) {
    query.status = filters.status;
  }
  
  if (filters.priority) {
    query.priority = filters.priority;
  }
  
  if (filters.raisedBy) {
    query.raisedBy = filters.raisedBy;
  }
  
  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {};
    if (filters.dateFrom) {
      query.createdAt.$gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      query.createdAt.$lte = new Date(filters.dateTo);
    }
  }
  
  return this.find(query)
    .populate('raisedBy', 'name email department role')
    .populate('quotationId', 'quotationType status')
    .populate('comments.commentBy', 'name role')
    .populate('approvals.approvedBy', 'name role')
    .sort({ createdAt: -1 });
};

// Static method to get requirement statistics
requirementSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const result = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    converted_to_quotation: 0
  };
  
  stats.forEach(stat => {
    result[stat._id] = stat.count;
    result.total += stat.count;
  });
  
  return result;
};

const Requirement = mongoose.model('Requirement', requirementSchema);

module.exports = Requirement;
