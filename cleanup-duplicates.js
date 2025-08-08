const mongoose = require('mongoose');
require('dotenv').config();

// Connect to database
async function connectDB() {
  try {
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/jits';
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
const AuditAssignment = require('./models/AuditAssignment');

async function cleanupDuplicateExecutions() {
  try {
    await connectDB();
    
    console.log('Starting cleanup of duplicate audit executions...');
    
    // Find all assignments
    const assignments = await AuditAssignment.find({});
    console.log(`Found ${assignments.length} assignments`);
    
    for (const assignment of assignments) {
      console.log(`\nProcessing assignment: ${assignment.assignmentId}`);
      
      // Find all executions for this assignment
      const executions = await AuditExecution.find({ assignmentId: assignment._id });
      console.log(`Found ${executions.length} executions for this assignment`);
      
      if (executions.length > 1) {
        // Group by lab and category
        const groups = {};
        executions.forEach(exec => {
          const key = `${exec.labId}-${exec.category}`;
          if (!groups[key]) {
            groups[key] = [];
          }
          groups[key].push(exec);
        });
        
        // For each group, keep only the latest completed one or the latest one if none completed
        for (const [key, groupExecutions] of Object.entries(groups)) {
          if (groupExecutions.length > 1) {
            console.log(`Found ${groupExecutions.length} executions for ${key}`);
            
            // Sort by completion status and date
            groupExecutions.sort((a, b) => {
              if (a.status === 'completed' && b.status !== 'completed') return -1;
              if (b.status === 'completed' && a.status !== 'completed') return 1;
              return new Date(b.createdAt) - new Date(a.createdAt);
            });
            
            // Keep the first one, delete the rest
            const toKeep = groupExecutions[0];
            const toDelete = groupExecutions.slice(1);
            
            console.log(`Keeping execution: ${toKeep.executionId} (${toKeep.status})`);
            
            for (const exec of toDelete) {
              console.log(`Deleting execution: ${exec.executionId} (${exec.status})`);
              await AuditExecution.findByIdAndDelete(exec._id);
            }
          }
        }
      }
    }
    
    console.log('\nCleanup completed successfully!');
    
    // Recalculate all assignment progress
    console.log('\nRecalculating assignment progress...');
    for (const assignment of assignments) {
      await assignment.calculateProgress();
      await assignment.save();
      console.log(`Assignment ${assignment.assignmentId}: ${assignment.progress}% - ${assignment.status}`);
    }
    
    console.log('\nAll done!');
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupDuplicateExecutions();
