const mongoose = require('mongoose');
const Experiment = require('../models/Experiment');
const Subject = require('../models/Subject');
const Course = require('../models/Course');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pharmacy-db');
    console.log('MongoDB connected for migration');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }
};

// Migration function
const migrateExperimentsToSubjects = async () => {
  try {
    console.log('Starting experiment migration...');
    
    // Get all experiments that don't have subjectId but have subject string
    const experimentsToMigrate = await Experiment.find({
      subjectId: { $exists: false },
      subject: { $exists: true, $ne: null, $ne: '' }
    });
    
    console.log(`Found ${experimentsToMigrate.length} experiments to migrate`);
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const experiment of experimentsToMigrate) {
      try {
        console.log(`Processing experiment: ${experiment.name} (Subject: ${experiment.subject})`);
        
        // Try to find matching subject by name (case-insensitive)
        let subjectMatch = await Subject.findOne({
          $or: [
            { name: new RegExp(experiment.subject, 'i') },
            { code: new RegExp(experiment.subject, 'i') }
          ]
        });
        
        if (!subjectMatch) {
          // If no exact match, try to create a default subject
          console.log(`No subject found for "${experiment.subject}". Creating default subject...`);
          
          // Get a default course (first available course)
          const defaultCourse = await Course.findOne({});
          if (!defaultCourse) {
            console.error('No courses available. Please create at least one course first.');
            errors++;
            continue;
          }
          
          // Create subject with experiment's subject name
          const subjectCode = experiment.subject.toUpperCase().replace(/\s+/g, '').substring(0, 10);
          
          subjectMatch = new Subject({
            name: experiment.subject,
            code: subjectCode,
            courseId: defaultCourse._id,
            description: `Auto-migrated from experiment: ${experiment.name}`,
            createdBy: experiment.createdBy,
            isActive: true
          });
          
          await subjectMatch.save();
          console.log(`Created new subject: ${subjectMatch.name} (${subjectMatch.code})`);
        }
        
        // Update experiment with subject reference
        await Experiment.findByIdAndUpdate(experiment._id, {
          $set: { subjectId: subjectMatch._id }
        });
        
        migrated++;
        console.log(`✓ Migrated experiment: ${experiment.name} → Subject: ${subjectMatch.name}`);
        
      } catch (error) {
        console.error(`Error migrating experiment ${experiment.name}:`, error.message);
        errors++;
      }
    }
    
    console.log('\n=== Migration Summary ===');
    console.log(`Total experiments processed: ${experimentsToMigrate.length}`);
    console.log(`Successfully migrated: ${migrated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    
    if (errors === 0) {
      console.log('\n✓ Migration completed successfully!');
    } else {
      console.log('\n⚠ Migration completed with some errors. Please review the logs above.');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
  }
};

// Rollback function (in case we need to revert)
const rollbackMigration = async () => {
  try {
    console.log('Rolling back experiment migration...');
    
    const result = await Experiment.updateMany(
      { subjectId: { $exists: true } },
      { $unset: { subjectId: 1 } }
    );
    
    console.log(`Rolled back ${result.modifiedCount} experiments`);
    
  } catch (error) {
    console.error('Rollback failed:', error);
  }
};

// Main execution
const main = async () => {
  await connectDB();
  
  const action = process.argv[2];
  
  if (action === 'rollback') {
    await rollbackMigration();
  } else {
    await migrateExperimentsToSubjects();
  }
  
  await mongoose.connection.close();
  console.log('Database connection closed');
};

// Run migration
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  migrateExperimentsToSubjects,
  rollbackMigration
};
