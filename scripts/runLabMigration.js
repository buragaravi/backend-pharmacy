#!/usr/bin/env node

// Simple script runner to migrate to dynamic labs
const { exec } = require('child_process');
const path = require('path');

console.log('🚀 Starting Lab Migration to Dynamic System...\n');

// Run the migration script
const migrationScript = path.join(__dirname, 'migrateToDynamicLabs.js');

exec(`node "${migrationScript}"`, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Migration failed:', error);
    return;
  }
  
  if (stderr) {
    console.error('⚠️ Migration warnings:', stderr);
  }
  
  console.log(stdout);
  console.log('\n✅ Migration completed! You can now use dynamic lab management.');
  console.log('\n📋 Next steps:');
  console.log('1. Access Admin Dashboard');
  console.log('2. Go to Administration > Lab Management');
  console.log('3. Create, edit, or manage labs dynamically');
  console.log('\n🎯 Features available:');
  console.log('• Create custom labs with any ID (except central-store)');
  console.log('• Edit lab names and descriptions');
  console.log('• Deactivate/activate labs');
  console.log('• View lab statistics and inventory counts');
  console.log('• Automatic synchronization across all documents');
});
