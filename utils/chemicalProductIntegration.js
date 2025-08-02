// Helper functions for Product-Chemical integration
const Product = require('../models/Product');

/**
 * Extract suffix from chemical name (e.g., "Sodium Chloride - A" → " - A")
 * @param {string} chemicalName - The chemical name with potential suffix
 * @returns {string} - The suffix part (including " - ") or empty string
 */
const extractSuffix = (chemicalName) => {
  const suffixMatch = chemicalName.match(/ - [A-Z]$/);
  return suffixMatch ? suffixMatch[0] : '';
};

/**
 * Get base name without suffix (e.g., "Sodium Chloride - A" → "Sodium Chloride")
 * @param {string} chemicalName - The chemical name with potential suffix
 * @returns {string} - The base name without suffix
 */
const getBaseName = (chemicalName) => {
  return chemicalName.replace(/ - [A-Z]$/, '');
};

/**
 * Update chemical name while preserving suffix
 * @param {string} oldChemicalName - Current chemical name (possibly with suffix)
 * @param {string} newBaseName - New base name from Product
 * @returns {string} - Updated chemical name with preserved suffix
 */
const updateChemicalNameWithSuffix = (oldChemicalName, newBaseName) => {
  const suffix = extractSuffix(oldChemicalName);
  return newBaseName + suffix;
};

/**
 * Find or create a Product reference for a chemical
 * @param {string} chemicalName - The name of the chemical (base name without suffix)
 * @param {string} unit - The unit of the chemical
 * @param {number} thresholdValue - Default threshold value
 * @returns {Promise<Object>} - Product document
 */
const findOrCreateChemicalProduct = async (chemicalName, unit, thresholdValue = 0) => {
  try {
    // Use base name for Product lookup (without suffix)
    const baseName = getBaseName(chemicalName);
    
    // First, try to find existing product
    let product = await Product.findOne({
      name: baseName,
      unit: unit,
      category: 'chemical'
    });

    if (product) {
      console.log(`✅ Found existing Product for chemical: ${baseName}`);
      return product;
    }

    // If not found, create new product
    product = await Product.create({
      name: baseName,
      unit: unit,
      thresholdValue: thresholdValue,
      category: 'chemical',
      subCategory: '', // Can be enhanced later
      variant: '' // Not used for chemicals
    });

    console.log(`🆕 Created new Product for chemical: ${baseName} (ID: ${product._id})`);
    return product;

  } catch (error) {
    console.error('❌ Error in findOrCreateChemicalProduct:', error);
    throw error;
  }
};

/**
 * Update ChemicalMaster with Product reference
 * @param {Object} chemicalMaster - ChemicalMaster document
 * @param {string} productId - Product ObjectId
 */
const linkChemicalToProduct = async (chemicalMaster, productId) => {
  try {
    if (!chemicalMaster.productId) {
      chemicalMaster.productId = productId;
      await chemicalMaster.save();
      console.log(`🔗 Linked ChemicalMaster ${chemicalMaster._id} to Product ${productId}`);
    }
  } catch (error) {
    console.error('❌ Error linking chemical to product:', error);
    throw error;
  }
};

/**
 * Enhanced function to create new chemical with Product reference
 * @param {string} chemicalName 
 * @param {number} quantity 
 * @param {string} unit 
 * @param {Date} expiryDate 
 * @param {string} batchId 
 * @param {string} vendor 
 * @param {number} pricePerUnit 
 * @param {string} department 
 * @param {string} userId 
 * @param {number} thresholdValue 
 * @returns {Promise<Object>} - ChemicalMaster document
 */
const createNewChemicalWithProduct = async (
  chemicalName, quantity, unit, expiryDate, batchId, 
  vendor, pricePerUnit, department, userId, thresholdValue = 10
) => {
  try {
    // Step 1: Find or create Product reference using base name
    const baseName = getBaseName(chemicalName);
    const product = await findOrCreateChemicalProduct(baseName, unit, thresholdValue);

    // Step 2: Create ChemicalMaster with Product reference
    // Note: chemicalName might have suffix, which is preserved
    const chemicalMaster = await ChemicalMaster.create({
      productId: product._id, // Add Product reference
      chemicalName, // This might have suffix like "Sodium Chloride - A"
      quantity: Number(quantity),
      unit,
      expiryDate,
      batchId,
      vendor,
      pricePerUnit: Number(pricePerUnit),
      department
    });

    console.log(`✅ Created ChemicalMaster with Product reference: ${chemicalMaster._id}`);
    console.log(`📝 Chemical name: "${chemicalName}" → Product: "${baseName}"`);
    return chemicalMaster;

  } catch (error) {
    console.error('❌ Error creating chemical with product reference:', error);
    throw error;
  }
};

/**
 * Migrate existing ChemicalMaster documents to use Product references
 * This function should be run once to migrate existing data
 */
const migrateExistingChemicals = async () => {
  try {
    console.log('🔄 Starting migration of existing chemicals to Product references...');
    
    const ChemicalMaster = require('../models/ChemicalMaster');
    const existingChemicals = await ChemicalMaster.find({ productId: { $exists: false } });
    
    console.log(`📋 Found ${existingChemicals.length} chemicals without Product references`);
    
    let migrated = 0;
    let errors = 0;

    for (const chemical of existingChemicals) {
      try {
        // Extract base name for Product creation/lookup
        const baseName = getBaseName(chemical.chemicalName);
        
        // Find or create Product for this chemical using base name
        const product = await findOrCreateChemicalProduct(
          baseName, // Use base name for Product
          chemical.unit, 
          10 // Default threshold
        );

        // Link the chemical to the product
        await linkChemicalToProduct(chemical, product._id);
        
        console.log(`✅ Migrated: "${chemical.chemicalName}" → Product: "${baseName}"`);
        migrated++;

      } catch (error) {
        console.error(`❌ Failed to migrate chemical ${chemical._id}:`, error);
        errors++;
      }
    }

    console.log(`🎉 Migration completed: ${migrated} migrated, ${errors} errors`);
    return { migrated, errors, total: existingChemicals.length };

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

module.exports = {
  extractSuffix,
  getBaseName,
  updateChemicalNameWithSuffix,
  findOrCreateChemicalProduct,
  linkChemicalToProduct,
  createNewChemicalWithProduct,
  migrateExistingChemicals
};
