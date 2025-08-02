// Migration script to add Product references to existing ChemicalMaster documents
const mongoose = require('mongoose');
const { migrateExistingChemicals } = require('../utils/chemicalProductIntegration');

// Database connection (adjust the connection string as needed)
const connectDB = async () => {
  try {
    const conn = await mongoose.connect('mongodb+srv://ravi:RaPy2025@ravipydah.wnmy712.mongodb.net/Jits-StocksPharmacy?retryWrites=true&w=majority' || 'mongodb://localhost:27017/jits-db');
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

// Main migration function
const runMigration = async () => {
  try {
    console.log('🚀 Starting ChemicalMaster to Product migration...');
    
    await connectDB();
    
    const result = await migrateExistingChemicals();
    
    console.log('📊 Migration Results:');
    console.log(`   Total chemicals processed: ${result.total}`);
    console.log(`   Successfully migrated: ${result.migrated}`);
    console.log(`   Errors encountered: ${result.errors}`);
    
    if (result.errors === 0) {
      console.log('🎉 Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with some errors. Check logs above.');
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

// Run the migration if this script is executed directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
