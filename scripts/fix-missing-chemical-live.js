const mongoose = require('mongoose');
const ChemicalMaster = require('../models/ChemicalMaster');
const ChemicalLive = require('../models/ChemicalLive');
const { diagnoseMissingChemicalLive } = require('./diagnose-missing-chemical-live');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pharmacy-stocks', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function fixMissingChemicalLive() {
  try {
    console.log('🔧 Fixing missing ChemicalLive entries for central-store...\n');

    // First, run diagnosis to get missing entries
    const diagnosis = await diagnoseMissingChemicalLive();
    
    if (diagnosis.missingLives === 0) {
      console.log('✅ No missing ChemicalLive entries found. Nothing to fix!');
      return;
    }

    console.log(`\n🔨 Creating ${diagnosis.missingLives} missing ChemicalLive entries...\n`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const missingEntry of diagnosis.missingEntries) {
      try {
        console.log(`Creating ChemicalLive for: ${missingEntry.chemicalName}`);
        
        // Create the missing ChemicalLive entry
        const newLive = await ChemicalLive.create({
          chemicalMasterId: missingEntry.masterId,
          chemicalName: missingEntry.chemicalName,
          displayName: missingEntry.chemicalName.split(' - ')[0], // Clean name without suffix
          unit: missingEntry.unit,
          expiryDate: missingEntry.expiryDate,
          labId: 'central-store',
          quantity: missingEntry.quantity,
          originalQuantity: missingEntry.quantity,
          isAllocated: false
        });

        console.log(`✅ Created ChemicalLive ID: ${newLive._id}`);
        successCount++;

      } catch (error) {
        console.error(`❌ Failed to create ChemicalLive for ${missingEntry.chemicalName}:`, error.message);
        errors.push({
          chemicalName: missingEntry.chemicalName,
          masterId: missingEntry.masterId,
          error: error.message
        });
        errorCount++;
      }
    }

    // Clean up orphaned ChemicalLive entries
    if (diagnosis.orphanedLives.length > 0) {
      console.log(`\n🧹 Cleaning up ${diagnosis.orphanedLives.length} orphaned ChemicalLive entries...`);
      
      for (const orphaned of diagnosis.orphanedLives) {
        try {
          await ChemicalLive.findByIdAndDelete(orphaned.liveId);
          console.log(`🗑️ Deleted orphaned ChemicalLive: ${orphaned.chemicalName}`);
        } catch (error) {
          console.error(`❌ Failed to delete orphaned ChemicalLive ${orphaned.liveId}:`, error.message);
        }
      }
    }

    console.log('\n📊 FIX SUMMARY:');
    console.log(`✅ Successfully created: ${successCount} ChemicalLive entries`);
    console.log(`❌ Failed to create: ${errorCount} ChemicalLive entries`);
    console.log(`🗑️ Cleaned up: ${diagnosis.orphanedLives.length} orphaned entries`);

    if (errors.length > 0) {
      console.log('\n❌ ERRORS:');
      errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error.chemicalName}: ${error.error}`);
      });
    }

    // Verify the fix
    console.log('\n🔍 Verifying fix...');
    const verification = await diagnoseMissingChemicalLive();
    
    if (verification.missingLives === 0) {
      console.log('✅ SUCCESS: All ChemicalLive entries are now properly created!');
    } else {
      console.log(`⚠️ WARNING: ${verification.missingLives} ChemicalLive entries are still missing`);
    }

    return {
      successCount,
      errorCount,
      orphanedCleaned: diagnosis.orphanedLives.length,
      errors,
      verification
    };

  } catch (error) {
    console.error('❌ Error during fix:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

// Run the fix
if (require.main === module) {
  fixMissingChemicalLive()
    .then(result => {
      console.log('\n🎉 Fix completed!');
      if (result.errorCount > 0) {
        console.log(`⚠️ ${result.errorCount} entries failed to create. Check the errors above.`);
        process.exit(1);
      } else {
        console.log('✅ All missing ChemicalLive entries have been created successfully!');
        process.exit(0);
      }
    })
    .catch(error => {
      console.error('Fix failed:', error);
      process.exit(1);
    });
}

module.exports = { fixMissingChemicalLive };
