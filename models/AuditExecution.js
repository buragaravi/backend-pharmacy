const mongoose = require('mongoose');

const auditChecklistItemSchema = new mongoose.Schema({
  itemId: String,
  itemName: String,
  itemType: String, // 'chemical', 'equipment', 'glassware', 'others'
  expectedLocation: String,
  actualLocation: String,
  status: {
    type: String,
    enum: ['not_checked', 'present', 'missing', 'damaged', 'location_mismatch', 'quantity_mismatch'],
    default: 'not_checked'
  },
  expectedQuantity: Number,
  actualQuantity: Number,
  condition: String,
  remarks: String,
  checkedAt: Date,
  images: [{
    filename: String,
    path: String,
    uploadedAt: Date
  }]
});

const auditExecutionSchema = new mongoose.Schema({
  assignmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AuditAssignment',
    required: true
  },
  executionId: {
    type: String,
    unique: true
    // Removed required: true since it's auto-generated
  },
  
  // Execution Details
  executedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  labId: {
    type: String,
    required: true
  },
  labName: String,
  category: {
    type: String,
    enum: ['chemical', 'equipment', 'glassware', 'others', 'all'],
    required: true
  },
  
  // Checklist Items
  checklistItems: [auditChecklistItemSchema],
  
  // Execution Tracking
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  duration: Number, // in minutes
  
  // Status
  status: {
    type: String,
    enum: ['in_progress', 'completed', 'paused'],
    default: 'in_progress'
  },
  
  // Summary Statistics
  summary: {
    totalItems: { type: Number, default: 0 },
    itemsChecked: { type: Number, default: 0 },
    itemsPresent: { type: Number, default: 0 },
    itemsMissing: { type: Number, default: 0 },
    itemsDamaged: { type: Number, default: 0 },
    locationMismatches: { type: Number, default: 0 },
    quantityMismatches: { type: Number, default: 0 }
  },
  
  // QR Scanning Data
  qrScanData: [{
    scannedData: String,
    timestamp: Date,
    location: String,
    result: String // 'match', 'mismatch', 'unknown'
  }],
  
  // Notes and Observations
  generalObservations: String,
  recommendations: String,
  
  // Validation
  isValidated: {
    type: Boolean,
    default: false
  },
  validatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  validatedAt: Date
}, {
  timestamps: true
});

// Auto-generate execution ID
auditExecutionSchema.pre('save', function(next) {
  if (!this.executionId) {
    const timestamp = Date.now().toString(36);
    this.executionId = `EXEC-${timestamp}`;
  }
  
  // Calculate duration if completed
  if (this.status === 'completed' && this.startedAt && this.completedAt) {
    this.duration = Math.round((this.completedAt - this.startedAt) / 60000); // minutes
  }
  
  // Update summary statistics
  this.updateSummary();
  
  next();
});

// Instance methods
auditExecutionSchema.methods.updateSummary = function() {
  this.summary.totalItems = this.checklistItems.length;
  this.summary.itemsChecked = this.checklistItems.filter(item => item.status !== 'not_checked').length;
  this.summary.itemsPresent = this.checklistItems.filter(item => item.status === 'present').length;
  this.summary.itemsMissing = this.checklistItems.filter(item => item.status === 'missing').length;
  this.summary.itemsDamaged = this.checklistItems.filter(item => item.status === 'damaged').length;
  this.summary.locationMismatches = this.checklistItems.filter(item => item.status === 'location_mismatch').length;
  this.summary.quantityMismatches = this.checklistItems.filter(item => item.status === 'quantity_mismatch').length;
};

auditExecutionSchema.methods.markItemStatus = function(itemId, status, actualQuantity, remarks, images) {
  const item = this.checklistItems.find(i => i.itemId === itemId);
  if (item) {
    item.status = status;
    item.actualQuantity = actualQuantity;
    item.remarks = remarks;
    item.checkedAt = new Date();
    if (images) item.images = images;
    this.updateSummary();
  }
};

auditExecutionSchema.methods.addQRScan = function(scannedData, location, result) {
  this.qrScanData.push({
    scannedData,
    timestamp: new Date(),
    location,
    result
  });
};

auditExecutionSchema.methods.getCompletionPercentage = function() {
  if (this.summary.totalItems === 0) return 0;
  return Math.round((this.summary.itemsChecked / this.summary.totalItems) * 100);
};

// Auto-generate executionId before saving
auditExecutionSchema.pre('save', async function(next) {
  if (!this.executionId) {
    try {
      // Get the count of existing executions to generate the next ID
      const count = await this.constructor.countDocuments();
      this.executionId = `EXEC-${String(count + 1).padStart(4, '0')}`;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model('AuditExecution', auditExecutionSchema);
