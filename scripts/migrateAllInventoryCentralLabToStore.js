// Comprehensive migration script to update all inventory types from 'central-lab' to 'central-store'
const mongoose = require('mongoose');
const ChemicalLive = require('../models/ChemicalLive');
const EquipmentLive = require('../models/EquipmentLive');
const GlasswareLive = require('../models/GlasswareLive');
const OtherProductLive = require('../models/OtherProductLive');
require('dotenv').config();

async function migrateAllInventoryTypes() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/Pydah', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    const inventoryTypes = [
      { model: ChemicalLive, name: 'ChemicalLive' },
      { model: EquipmentLive, name: 'EquipmentLive' },
      { model: GlasswareLive, name: 'GlasswareLive' },
      { model: OtherProductLive, name: 'OtherProductLive' }
    ];

    let totalUpdated = 0;

    for (const inventoryType of inventoryTypes) {
      console.log(`\n--- Processing ${inventoryType.name} ---`);
      
      try {
        // Find documents with 'central-lab'
        const documentsToUpdate = await inventoryType.model.find({ labId: 'central-lab' });
        
        console.log(`Found ${documentsToUpdate.length} ${inventoryType.name} documents with labId 'central-lab'`);

        if (documentsToUpdate.length > 0) {
          // Display the documents that will be updated
          console.log(`Documents to be updated in ${inventoryType.name}:`);
          documentsToUpdate.forEach((doc, index) => {
            const itemName = doc.chemicalName || doc.equipmentName || doc.glasswareName || doc.productName || doc.name || 'Unknown';
            console.log(`  ${index + 1}. ${itemName} (ID: ${doc._id}) - Lab: ${doc.labId}`);
          });

          // Update documents
          const updateResult = await inventoryType.model.updateMany(
            { labId: 'central-lab' },
            { $set: { labId: 'central-store' } }
          );

          console.log(`${inventoryType.name} - Documents matched: ${updateResult.matchedCount}`);
          console.log(`${inventoryType.name} - Documents modified: ${updateResult.modifiedCount}`);
          
          totalUpdated += updateResult.modifiedCount;

          // Verify
          const remaining = await inventoryType.model.countDocuments({ labId: 'central-lab' });
          console.log(`${inventoryType.name} - Remaining 'central-lab' documents: ${remaining}`);
        }
      } catch (error) {
        console.error(`Error processing ${inventoryType.name}:`, error.message);
        // Continue with other inventory types even if one fails
      }
    }

    console.log(`\n=== Migration Summary ===`);
    console.log(`Total documents updated across all inventory types: ${totalUpdated}`);

    // Final verification across all types
    console.log(`\n=== Final Verification ===`);
    for (const inventoryType of inventoryTypes) {
      try {
        const centralLabCount = await inventoryType.model.countDocuments({ labId: 'central-lab' });
        const centralStoreCount = await inventoryType.model.countDocuments({ labId: 'central-store' });
        console.log(`${inventoryType.name} - 'central-lab': ${centralLabCount}, 'central-store': ${centralStoreCount}`);
      } catch (error) {
        console.error(`Error verifying ${inventoryType.name}:`, error.message);
      }
    }

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the migration
migrateAllInventoryTypes();
