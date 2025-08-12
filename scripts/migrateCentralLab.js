#!/usr/bin/env node

// Simple migration script to run from command line
// Usage: node migrateCentralLab.js

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrateCentralLabToStore() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/Pydah';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Load models
    const ChemicalLive = require('../models/ChemicalLive');
    const EquipmentLive = require('../models/EquipmentLive');
    const GlasswareLive = require('../models/GlasswareLive');
    const OtherProductLive = require('../models/OtherProductLive');

    const inventoryTypes = [
      { model: ChemicalLive, name: 'ChemicalLive' },
      { model: EquipmentLive, name: 'EquipmentLive' },
      { model: GlasswareLive, name: 'GlasswareLive' },
      { model: OtherProductLive, name: 'OtherProductLive' }
    ];

    let totalUpdated = 0;

    console.log('\n🔍 Scanning for documents with labId "central-lab"...\n');

    for (const inventoryType of inventoryTypes) {
      try {
        // Find documents with 'central-lab'
        const documentsToUpdate = await inventoryType.model.find({ labId: 'central-lab' });
        
        console.log(`📋 ${inventoryType.name}: Found ${documentsToUpdate.length} documents`);

        if (documentsToUpdate.length > 0) {
          // Show some examples
          console.log(`   Examples:`);
          documentsToUpdate.slice(0, 3).forEach((doc, index) => {
            const itemName = doc.chemicalName || doc.equipmentName || doc.glasswareName || doc.productName || doc.name || 'Unknown';
            console.log(`   - ${itemName} (${doc._id})`);
          });
          if (documentsToUpdate.length > 3) {
            console.log(`   ... and ${documentsToUpdate.length - 3} more`);
          }

          // Update documents
          const updateResult = await inventoryType.model.updateMany(
            { labId: 'central-lab' },
            { $set: { labId: 'central-store' } }
          );

          console.log(`   ✅ Updated: ${updateResult.modifiedCount}/${updateResult.matchedCount} documents\n`);
          totalUpdated += updateResult.modifiedCount;
        } else {
          console.log(`   ✨ No documents to update\n`);
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${inventoryType.name}:`, error.message);
      }
    }

    console.log(`🎉 Migration Summary:`);
    console.log(`   Total documents updated: ${totalUpdated}`);

    // Final verification
    console.log(`\n🔍 Verification:`);
    for (const inventoryType of inventoryTypes) {
      try {
        const centralLabCount = await inventoryType.model.countDocuments({ labId: 'central-lab' });
        const centralStoreCount = await inventoryType.model.countDocuments({ labId: 'central-store' });
        console.log(`   ${inventoryType.name}: central-lab(${centralLabCount}) → central-store(${centralStoreCount})`);
      } catch (error) {
        console.error(`   ❌ Error verifying ${inventoryType.name}:`, error.message);
      }
    }

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run only if called directly (not imported)
if (require.main === module) {
  migrateCentralLabToStore()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = migrateCentralLabToStore;
