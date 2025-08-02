const mongoose = require('mongoose');

const chemicalMasterSchema = new mongoose.Schema(
  {
    // Add Product reference while keeping existing fields
    productId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Product', 
      required: true 
    },
    chemicalName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, required: true },
    expiryDate: { type: Date },
    batchId: { type: String, required: true }, // No longer unique
    vendor: { type: String, required: true },
    pricePerUnit: { type: Number, required: true },
    department: { type: String, required: true },
  },
  { timestamps: true }
);

// Add middleware to sync with Product changes
chemicalMasterSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('productId')) {
    try {
      const Product = mongoose.model('Product');
      const product = await Product.findById(this.productId);
      if (product) {
        // For new documents, set the name directly
        if (this.isNew) {
          this.chemicalName = product.name;
          this.unit = product.unit || this.unit;
        } else {
          // For existing documents, preserve suffix when updating
          const suffixMatch = this.chemicalName.match(/ - [A-Z]$/);
          const suffix = suffixMatch ? suffixMatch[0] : '';
          this.chemicalName = product.name + suffix;
          this.unit = product.unit || this.unit;
        }
      }
    } catch (error) {
      console.error('Error syncing with Product:', error);
    }
  }
  next();
});

// Add method to sync all related ChemicalLive documents
chemicalMasterSchema.methods.syncChemicalLive = async function() {
  try {
    const ChemicalLive = mongoose.model('ChemicalLive');
    const Product = mongoose.model('Product');
    
    const product = await Product.findById(this.productId);
    if (product) {
      // Update all ChemicalLive documents with this chemicalMasterId
      await ChemicalLive.updateMany(
        { chemicalMasterId: this._id },
        { 
          chemicalName: this.chemicalName,  // Match ChemicalMaster exactly (with suffix)
          displayName: product.name,        // Clean name for display (without suffix)
          unit: product.unit || this.unit,
        }
      );
      
      console.log(`🔄 Synced ChemicalLive documents for ChemicalMaster: ${this._id}`);
      console.log(`📝 Updated chemicalName to: "${this.chemicalName}"`);
      console.log(`📝 Updated displayName to: "${product.name}"`);
    }
  } catch (error) {
    console.error('Error syncing ChemicalLive:', error);
  }
};

module.exports = mongoose.model('ChemicalMaster', chemicalMasterSchema);
