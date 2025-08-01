const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    facultyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    labId: {
      type: String,
      required: true,
    },
    experiments: [
      {
        experimentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Experiment',
          required: true
        },
        experimentName: {
          type: String,
          required: true
        },
        courseId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Course',
          required: true
        },
        batchId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true // This will be the subdocument _id from course.batches
        },
        date: {
          type: Date,
          required: true
        },
        allocationStatus: {
          canAllocate: { type: Boolean, default: true },
          reason: { type: String, default: null },
          reasonType: { 
            type: String, 
            enum: ['allocatable', 'date_expired_admin_only', 'date_expired_completely', 'fully_allocated', 'no_items'],
            default: 'allocatable'
          },
          lastChecked: { type: Date, default: Date.now },
          adminOverride: { type: Boolean, default: false }, // Allow admin to override date restrictions
          overrideReason: { type: String, default: null },
          overrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          overrideAt: { type: Date }
        },
        chemicals: [
          {
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
            },
            chemicalMasterId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'ChemicalMaster'
            },
            originalQuantity: {
              type: Number // Store original quantity when first edited
            },
            allocatedQuantity: {
              type: Number,
              default: 0
            },
            isAllocated: {
              type: Boolean,
              default: false
            },
            isDisabled: {
              type: Boolean,
              default: false
            },
            disabledReason: {
              type: String,
              default: ''
            },
            wasDisabled: {
              type: Boolean,
              default: false // Track if item was previously disabled
            },
            allocationHistory: [
              {
                date: Date,
                quantity: Number,
                allocatedBy: {
                  type: mongoose.Schema.Types.ObjectId,
                  ref: 'User'
                }
              }
            ]
          },
        ],
        equipment: [
          {
            name: { type: String, required: true },
            variant: { type: String },
            quantity: { type: Number, required: true, min: 1 },
            unit: { type: String },
            status: { type: String }, // e.g., 'Available', 'Issued', etc.
            originalQuantity: {
              type: Number // Store original quantity when first edited
            },
            isAllocated: { type: Boolean, default: false },
            isDisabled: {
              type: Boolean,
              default: false
            },
            disabledReason: {
              type: String,
              default: ''
            },
            wasDisabled: {
              type: Boolean,
              default: false // Track if item was previously disabled
            },
            allocationHistory: [
              {
                date: Date,
                quantity: Number,
                itemIds: [String], // Store allocated itemIds
                allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
              }
            ]
          }
        ],
        glassware: [
          {
            glasswareId: { type: mongoose.Schema.Types.ObjectId, ref: 'GlasswareLive', required: true },
            productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
            name: { type: String, required: true },
            variant: { type: String },
            quantity: { type: Number, required: true, min: 0 },
            unit: { type: String },
            originalQuantity: {
              type: Number // Store original quantity when first edited
            },
            isAllocated: { type: Boolean, default: false },
            isDisabled: {
              type: Boolean,
              default: false
            },
            disabledReason: {
              type: String,
              default: ''
            },
            wasDisabled: {
              type: Boolean,
              default: false // Track if item was previously disabled
            },
            allocationHistory: [
              {
                date: Date,
                quantity: Number,
                allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
              }
            ]
          }
        ]
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'fulfilled', 'partially_fulfilled'],
      default: 'pending',
    },
    adminEdits: {
      hasEdits: { type: Boolean, default: false },
      lastEditedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User' 
      },
      lastEditedAt: { type: Date },
      editSummary: { type: String } // Simple summary for display
    },
    approvalHistory: [
      {
        action: {
          type: String,
          enum: ['approve', 'reject'],
          required: true
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        reason: {
          type: String,
          default: ''
        },
        date: {
          type: Date,
          default: Date.now
        }
      }
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

// Indexes for efficient querying
requestSchema.index({ facultyId: 1, status: 1 });
requestSchema.index({ 'experiments.date': 1 });
requestSchema.index({ 'experiments.experimentId': 1 });
requestSchema.index({ 'experiments.allocationStatus.reasonType': 1 });
requestSchema.index({ 'experiments.allocationStatus.canAllocate': 1 });
requestSchema.index({ 'experiments.allocationStatus.adminOverride': 1 });

const Request = mongoose.model('Request', requestSchema);

module.exports = Request;