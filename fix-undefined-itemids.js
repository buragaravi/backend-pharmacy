const mongoose = require('mongoose');
require('dotenv').config();

// Connect to database
async function connectDB() {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Pydah';
    console.log('Connecting to:', mongoURI);
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
}

const AuditExecution = require('./models/AuditExecution');
const ChemicalLive = require('./models/ChemicalLive');
const EquipmentLive = require('./models/EquipmentLive');
const GlasswareLive = require('./models/GlasswareLive');
const OtherProductLive = require('./models/OtherProductLive');

async function fixUndefinedItemIds() {
  try {
    await connectDB();
    
    console.log('Finding audit executions with undefined itemIds...');
    
    // Find executions that have items with undefined or missing itemIds
    const executions = await AuditExecution.find({
      'checklistItems.itemId': { $in: [null, undefined, 'undefined'] }
    });
    
    console.log(`Found ${executions.length} executions with undefined itemIds`);
    
    for (const execution of executions) {
      console.log(`\nProcessing execution: ${execution.executionId} (${execution.category})`);
      
      let updated = false;
      
      for (let i = 0; i < execution.checklistItems.length; i++) {
        const item = execution.checklistItems[i];
        
        if (!item.itemId || item.itemId === 'undefined') {
          console.log(`Fixing item: ${item.itemName}`);
          
          // Try to find the actual item in the database based on name and lab
          let actualItem = null;
          
          switch (execution.category) {
            case 'chemical':
              actualItem = await ChemicalLive.findOne({
                labId: execution.labId,
                $or: [
                  { chemicalName: { $regex: item.itemName.split(' ')[0], $options: 'i' } },
                  { displayName: { $regex: item.itemName.split(' ')[0], $options: 'i' } }
                ]
              });
              if (actualItem) {
                execution.checklistItems[i].itemId = actualItem._id.toString();
                updated = true;
              }
              break;
              
            case 'equipment':
              actualItem = await EquipmentLive.findOne({
                labId: execution.labId,
                name: { $regex: item.itemName.split(' ')[0], $options: 'i' }
              });
              if (actualItem) {
                execution.checklistItems[i].itemId = actualItem.itemId;
                updated = true;
              }
              break;
              
            case 'glassware':
              actualItem = await GlasswareLive.findOne({
                labId: execution.labId,
                name: { $regex: item.itemName.split(' ')[0], $options: 'i' }
              });
              if (actualItem) {
                execution.checklistItems[i].itemId = actualItem._id.toString();
                updated = true;
              }
              break;
              
            case 'others':
              actualItem = await OtherProductLive.findOne({
                labId: execution.labId,
                name: { $regex: item.itemName.split(' ')[0], $options: 'i' }
              });
              if (actualItem) {
                execution.checklistItems[i].itemId = actualItem._id.toString();
                updated = true;
              }
              break;
          }
          
          if (actualItem) {
            console.log(`  ✅ Fixed itemId: ${execution.checklistItems[i].itemId}`);
          } else {
            console.log(`  ❌ Could not find matching item for: ${item.itemName}`);
          }
        }
      }
      
      if (updated) {
        await execution.save();
        console.log(`Updated execution: ${execution.executionId}`);
      }
    }
    
    console.log('\nCompleted fixing undefined itemIds');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing itemIds:', error);
    process.exit(1);
  }
}

fixUndefinedItemIds();
