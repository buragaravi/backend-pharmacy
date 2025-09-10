const mongoose = require('mongoose');
const ChemicalLive = require('./models/ChemicalLive');
const ChemicalMaster = require('./models/ChemicalMaster');

async function debugChemicals() {
  try {
    await mongoose.connect('mongodb://localhost:27017/pharmacy-stocks');
    console.log('Connected to MongoDB');

    // Check ChemicalLive count
    const liveCount = await ChemicalLive.countDocuments();
    console.log('📊 Total ChemicalLive entries:', liveCount);

    // Check ChemicalMaster count
    const masterCount = await ChemicalMaster.countDocuments();
    console.log('📊 Total ChemicalMaster entries:', masterCount);

    if (liveCount > 0) {
      // Get sample ChemicalLive entries
      const sampleLive = await ChemicalLive.find()
        .limit(3)
        .select('displayName chemicalName labId quantity unit expiryDate chemicalMasterId')
        .populate('chemicalMasterId', 'batchId vendor');
      
      console.log('\n🔍 Sample ChemicalLive entries:');
      console.log(JSON.stringify(sampleLive, null, 2));

      // Check what labs exist
      const labs = await ChemicalLive.distinct('labId');
      console.log('\n🏢 Labs with chemicals:', labs);

      // Check central-store specifically
      const centralStore = await ChemicalLive.find({ labId: 'central-store' }).limit(3);
      console.log('\n🏪 Central store chemicals:', centralStore.length);
      if (centralStore.length > 0) {
        console.log('Sample central store:', JSON.stringify(centralStore[0], null, 2));
      }
    }

    // Test the query from our endpoint
    console.log('\n🧪 Testing endpoint query...');
    const testQuery = {};
    const chemicals = await ChemicalLive.find(testQuery)
      .select('displayName chemicalName quantity unit expiryDate labId chemicalMasterId originalQuantity')
      .populate('chemicalMasterId', 'batchId vendor pricePerUnit department')
      .sort({ displayName: 1, labId: 1 })
      .limit(5);

    console.log('Query results:', chemicals.length);
    if (chemicals.length > 0) {
      console.log('Sample result:', JSON.stringify(chemicals[0], null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

debugChemicals();
