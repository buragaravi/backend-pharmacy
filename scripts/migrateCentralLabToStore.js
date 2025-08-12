// Migration script to update ChemicalLive documents from 'central-lab' to 'central-store'
const mongoose = require('mongoose');
const ChemicalLive = require('../models/ChemicalLive');
require('dotenv').config();

async function migrateCentralLabToStore() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/Pydah', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Find all ChemicalLive documents with labId = 'central-lab'
    const documentsToUpdate = await ChemicalLive.find({ labId: 'central-lab' });
    
    console.log(`Found ${documentsToUpdate.length} ChemicalLive documents with labId 'central-lab'`);

    if (documentsToUpdate.length === 0) {
      console.log('No documents found with labId "central-lab". Migration not needed.');
      await mongoose.connection.close();
      return;
    }

    // Display the documents that will be updated
    console.log('\nDocuments to be updated:');
    documentsToUpdate.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.chemicalName} (ID: ${doc._id}) - Lab: ${doc.labId}`);
    });

    // Ask for confirmation (in production, you might want to skip this)
    console.log('\nProceeding with migration...');

    // Update all documents from 'central-lab' to 'central-store'
    const updateResult = await ChemicalLive.updateMany(
      { labId: 'central-lab' },
      { $set: { labId: 'central-store' } }
    );

    console.log(`\nMigration completed!`);
    console.log(`Documents matched: ${updateResult.matchedCount}`);
    console.log(`Documents modified: ${updateResult.modifiedCount}`);

    // Verify the migration
    const remainingCentralLab = await ChemicalLive.countDocuments({ labId: 'central-lab' });
    const centralStoreCount = await ChemicalLive.countDocuments({ labId: 'central-store' });

    console.log(`\nVerification:`);
    console.log(`Remaining documents with 'central-lab': ${remainingCentralLab}`);
    console.log(`Total documents with 'central-store': ${centralStoreCount}`);

    if (remainingCentralLab === 0) {
      console.log('✅ Migration successful! All documents updated.');
    } else {
      console.log('❌ Some documents may not have been updated. Please check manually.');
    }

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

// Run the migration
migrateCentralLabToStore();
