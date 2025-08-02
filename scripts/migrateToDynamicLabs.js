#!/usr/bin/env node

// Migration script to create Lab documents and update existing data
const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrateToDynamicLabs() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/jits';
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Load models
    const Lab = require('../models/Lab');
    const ChemicalLive = require('../models/ChemicalLive');
    const EquipmentLive = require('../models/EquipmentLive');
    const GlasswareLive = require('../models/GlasswareLive');
    const OtherProductLive = require('../models/OtherProductLive');
    const User = require('../models/User');

    console.log('\n🏗️  Step 1: Creating Lab documents...');

    // Define labs to create
    const labsToCreate = [
      {
        labId: 'central-store',
        labName: 'Central Store',
        description: 'Main inventory storage facility',
        isSystem: true,
        isActive: true
      },
      {
        labId: 'LAB01',
        labName: 'Physics Laboratory',
        description: 'Physics experiments and research',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB02',
        labName: 'Chemistry Laboratory',
        description: 'Chemistry experiments and analysis',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB03',
        labName: 'Biology Laboratory',
        description: 'Biology and life sciences research',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB04',
        labName: 'Computer Science Laboratory',
        description: 'Programming and computer science projects',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB05',
        labName: 'Electronics Laboratory',
        description: 'Electronics and circuit design',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB06',
        labName: 'Mechanical Laboratory',
        description: 'Mechanical engineering experiments',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB07',
        labName: 'Materials Science Laboratory',
        description: 'Materials testing and analysis',
        isSystem: false,
        isActive: true
      },
      {
        labId: 'LAB08',
        labName: 'Research Laboratory',
        description: 'General research and development',
        isSystem: false,
        isActive: true
      }
    ];

    let createdCount = 0;
    let updatedCount = 0;

    for (const labData of labsToCreate) {
      try {
        const existingLab = await Lab.findOne({ labId: labData.labId });
        
        if (existingLab) {
          // Update existing lab
          const updated = await Lab.findOneAndUpdate(
            { labId: labData.labId },
            { 
              labName: labData.labName,
              description: labData.description,
              isSystem: labData.isSystem,
              isActive: labData.isActive
            },
            { new: true }
          );
          console.log(`   ✅ Updated: ${labData.labId} - ${labData.labName}`);
          updatedCount++;
        } else {
          // Create new lab
          await Lab.create(labData);
          console.log(`   ✨ Created: ${labData.labId} - ${labData.labName}`);
          createdCount++;
        }
      } catch (error) {
        console.error(`   ❌ Error with ${labData.labId}:`, error.message);
      }
    }

    console.log(`\n📊 Lab Creation Summary:`);
    console.log(`   Created: ${createdCount} labs`);
    console.log(`   Updated: ${updatedCount} labs`);

    console.log('\n🔄 Step 2: Updating inventory documents with labName...');

    const inventoryModels = [
      { model: ChemicalLive, name: 'ChemicalLive' },
      { model: EquipmentLive, name: 'EquipmentLive' },
      { model: GlasswareLive, name: 'GlasswareLive' },
      { model: OtherProductLive, name: 'OtherProductLive' }
    ];

    let totalInventoryUpdated = 0;

    for (const inventoryType of inventoryModels) {
      try {
        // Get all documents that need labName populated
        const documents = await inventoryType.model.find({ 
          $or: [
            { labName: { $exists: false } },
            { labName: null },
            { labName: '' }
          ]
        });

        console.log(`   📋 ${inventoryType.name}: Found ${documents.length} documents to update`);

        let updated = 0;
        for (const doc of documents) {
          try {
            if (doc.labId === 'central-store') {
              doc.labName = 'Central Store';
            } else {
              const lab = await Lab.findOne({ labId: doc.labId, isActive: true });
              if (lab) {
                doc.labName = lab.labName;
              } else {
                console.log(`   ⚠️  Lab not found for ${doc.labId} in ${inventoryType.name} document`);
                continue;
              }
            }
            
            await doc.save();
            updated++;
          } catch (error) {
            console.error(`   ❌ Error updating ${inventoryType.name} document:`, error.message);
          }
        }

        console.log(`   ✅ Updated ${updated}/${documents.length} ${inventoryType.name} documents`);
        totalInventoryUpdated += updated;

      } catch (error) {
        console.error(`   ❌ Error processing ${inventoryType.name}:`, error.message);
      }
    }

    console.log('\n👥 Step 3: Updating user documents with labName...');

    try {
      const users = await User.find({ 
        labId: { $exists: true, $ne: null },
        $or: [
          { labName: { $exists: false } },
          { labName: null },
          { labName: '' }
        ]
      });

      console.log(`   👤 Found ${users.length} users to update`);

      let updatedUsers = 0;
      for (const user of users) {
        try {
          if (user.labId === 'central-store') {
            user.labName = 'Central Store';
          } else {
            const lab = await Lab.findOne({ labId: user.labId, isActive: true });
            if (lab) {
              user.labName = lab.labName;
            } else {
              console.log(`   ⚠️  Lab not found for user ${user.email} with labId ${user.labId}`);
              continue;
            }
          }
          
          await user.save();
          updatedUsers++;
        } catch (error) {
          console.error(`   ❌ Error updating user ${user.email}:`, error.message);
        }
      }

      console.log(`   ✅ Updated ${updatedUsers}/${users.length} users`);

    } catch (error) {
      console.error('   ❌ Error updating users:', error.message);
    }

    console.log('\n🔍 Step 4: Verification...');

    // Verify labs were created
    const totalLabs = await Lab.countDocuments();
    const activeLabs = await Lab.countDocuments({ isActive: true });
    const systemLabs = await Lab.countDocuments({ isSystem: true });

    console.log(`   📊 Lab Statistics:`);
    console.log(`      Total labs: ${totalLabs}`);
    console.log(`      Active labs: ${activeLabs}`);
    console.log(`      System labs: ${systemLabs}`);

    // Check for any orphaned lab references
    console.log(`\n   🔍 Checking for orphaned lab references...`);
    
    const allLabIds = await Lab.find({ isActive: true }).distinct('labId');
    
    for (const inventoryType of inventoryModels) {
      const distinctLabIds = await inventoryType.model.distinct('labId');
      const orphaned = distinctLabIds.filter(labId => !allLabIds.includes(labId));
      
      if (orphaned.length > 0) {
        console.log(`   ⚠️  ${inventoryType.name} has orphaned labIds: ${orphaned.join(', ')}`);
      } else {
        console.log(`   ✅ ${inventoryType.name} - all labIds are valid`);
      }
    }

    console.log('\n🎉 Migration Summary:');
    console.log(`   ✅ Labs created/updated: ${createdCount + updatedCount}`);
    console.log(`   ✅ Inventory documents updated: ${totalInventoryUpdated}`);
    console.log(`   ✅ System now supports dynamic lab management`);
    console.log(`   📝 Admins can now create/manage labs via /api/labs endpoints`);

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
  migrateToDynamicLabs()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = migrateToDynamicLabs;
