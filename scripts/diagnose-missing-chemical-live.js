const mongoose = require('mongoose');
const ChemicalMaster = require('../models/ChemicalMaster');
const ChemicalLive = require('../models/ChemicalLive');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pharmacy-stocks', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function diagnoseMissingChemicalLive() {
  try {
    console.log('🔍 Diagnosing missing ChemicalLive entries for central-store...\n');

    // Get all ChemicalMaster entries
    const allMasters = await ChemicalMaster.find({}).sort({ createdAt: -1 });
    console.log(`📊 Total ChemicalMaster entries: ${allMasters.length}`);

    // Get all ChemicalLive entries for central-store
    const allLives = await ChemicalLive.find({ labId: 'central-store' }).sort({ createdAt: -1 });
    console.log(`📊 Total ChemicalLive entries for central-store: ${allLives.length}`);

    // Find missing ChemicalLive entries
    const missingLives = [];
    const orphanedLives = [];

    for (const master of allMasters) {
      const live = await ChemicalLive.findOne({
        chemicalMasterId: master._id,
        labId: 'central-store'
      });

      if (!live) {
        missingLives.push({
          masterId: master._id,
          chemicalName: master.chemicalName,
          quantity: master.quantity,
          unit: master.unit,
          vendor: master.vendor,
          batchId: master.batchId,
          expiryDate: master.expiryDate,
          createdAt: master.createdAt
        });
      }
    }

    // Find orphaned ChemicalLive entries (exist in live but not in master)
    for (const live of allLives) {
      const master = await ChemicalMaster.findById(live.chemicalMasterId);
      if (!master) {
        orphanedLives.push({
          liveId: live._id,
          chemicalMasterId: live.chemicalMasterId,
          chemicalName: live.chemicalName,
          displayName: live.displayName,
          quantity: live.quantity,
          unit: live.unit,
          labId: live.labId,
          createdAt: live.createdAt
        });
      }
    }

    console.log('\n❌ MISSING ChemicalLive entries (exist in master but not in live):');
    console.log(`Count: ${missingLives.length}`);
    if (missingLives.length > 0) {
      console.log('\nMissing entries:');
      missingLives.forEach((entry, index) => {
        console.log(`${index + 1}. Master ID: ${entry.masterId}`);
        console.log(`   Chemical: ${entry.chemicalName}`);
        console.log(`   Quantity: ${entry.quantity} ${entry.unit}`);
        console.log(`   Vendor: ${entry.vendor}`);
        console.log(`   Batch: ${entry.batchId}`);
        console.log(`   Expiry: ${entry.expiryDate || 'No expiry'}`);
        console.log(`   Created: ${entry.createdAt}`);
        console.log('');
      });
    }

    console.log('\n⚠️ ORPHANED ChemicalLive entries (exist in live but not in master):');
    console.log(`Count: ${orphanedLives.length}`);
    if (orphanedLives.length > 0) {
      console.log('\nOrphaned entries:');
      orphanedLives.forEach((entry, index) => {
        console.log(`${index + 1}. Live ID: ${entry.liveId}`);
        console.log(`   Master ID: ${entry.chemicalMasterId}`);
        console.log(`   Chemical: ${entry.chemicalName}`);
        console.log(`   Display: ${entry.displayName}`);
        console.log(`   Quantity: ${entry.quantity} ${entry.unit}`);
        console.log(`   Lab: ${entry.labId}`);
        console.log(`   Created: ${entry.createdAt}`);
        console.log('');
      });
    }

    // Check for potential issues in the creation logic
    console.log('\n🔍 ANALYZING POTENTIAL ISSUES:');
    
    // Check for chemicals with same name but different cases
    const nameGroups = {};
    for (const master of allMasters) {
      const baseName = master.chemicalName.split(' - ')[0].toLowerCase();
      if (!nameGroups[baseName]) {
        nameGroups[baseName] = [];
      }
      nameGroups[baseName].push(master);
    }

    const caseIssues = Object.entries(nameGroups).filter(([name, masters]) => masters.length > 1);
    if (caseIssues.length > 0) {
      console.log('\n📝 Potential case sensitivity issues:');
      caseIssues.forEach(([name, masters]) => {
        console.log(`   "${name}": ${masters.length} variations`);
        masters.forEach(master => {
          console.log(`     - "${master.chemicalName}" (${master.quantity} ${master.unit})`);
        });
      });
    }

    // Check for recent entries (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentMasters = allMasters.filter(m => m.createdAt > sevenDaysAgo);
    const recentMissing = missingLives.filter(m => m.createdAt > sevenDaysAgo);

    console.log(`\n📅 Recent entries (last 7 days):`);
    console.log(`   New ChemicalMaster entries: ${recentMasters.length}`);
    console.log(`   Missing ChemicalLive entries: ${recentMissing.length}`);

    if (recentMissing.length > 0) {
      console.log('\n🚨 Recent missing entries:');
      recentMissing.forEach((entry, index) => {
        console.log(`${index + 1}. ${entry.chemicalName} - Created: ${entry.createdAt}`);
      });
    }

    console.log('\n✅ Diagnosis complete!');
    
    return {
      totalMasters: allMasters.length,
      totalLives: allLives.length,
      missingLives: missingLives.length,
      orphanedLives: orphanedLives.length,
      recentMissing: recentMissing.length,
      missingEntries: missingLives,
      orphanedEntries: orphanedLives
    };

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

// Run the diagnosis
if (require.main === module) {
  diagnoseMissingChemicalLive()
    .then(result => {
      console.log('\n📋 SUMMARY:');
      console.log(`Total ChemicalMaster: ${result.totalMasters}`);
      console.log(`Total ChemicalLive: ${result.totalLives}`);
      console.log(`Missing ChemicalLive: ${result.missingLives}`);
      console.log(`Orphaned ChemicalLive: ${result.orphanedLives}`);
      console.log(`Recent Missing: ${result.recentMissing}`);
      
      if (result.missingLives > 0) {
        console.log('\n🔧 RECOMMENDATION: Run the fix script to create missing ChemicalLive entries');
      }
    })
    .catch(error => {
      console.error('Diagnosis failed:', error);
      process.exit(1);
    });
}

module.exports = { diagnoseMissingChemicalLive };
