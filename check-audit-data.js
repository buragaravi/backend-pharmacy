const mongoose = require('mongoose');
const User = require('./models/User');
const AuditAssignment = require('./models/AuditAssignment');
const Lab = require('./models/Lab');

// Connect to database
mongoose.connect('mongodb://localhost:27017/Pydah-backend', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function checkAuditData() {
  try {
    // Check users
    const users = await User.find({}, 'name email role');
    console.log('\n=== USERS ===');
    console.log('Total users:', users.length);
    users.forEach(user => {
      console.log(`${user.name} (${user.email}) - Role: ${user.role} - ID: ${user._id}`);
    });

    // Check labs
    const labs = await Lab.find({}, 'labName');
    console.log('\n=== LABS ===');
    console.log('Total labs:', labs.length);
    labs.forEach(lab => {
      console.log(`${lab.labName} - ID: ${lab._id}`);
    });

    // Check audit assignments
    const assignments = await AuditAssignment.find({})
      .populate('assignedTo', 'name email')
      .populate('assignedBy', 'name email');
    
    console.log('\n=== AUDIT ASSIGNMENTS ===');
    console.log('Total assignments:', assignments.length);
    assignments.forEach(assignment => {
      console.log(`Title: ${assignment.title}`);
      console.log(`Assigned to: ${assignment.assignedTo?.name} (${assignment.assignedTo?._id})`);
      console.log(`Assigned by: ${assignment.assignedBy?.name}`);
      console.log(`Status: ${assignment.status}`);
      console.log(`Due: ${assignment.dueDate}`);
      console.log('---');
    });

    // Create a sample assignment if none exist
    if (assignments.length === 0) {
      const faculty = users.find(u => u.role === 'faculty');
      const admin = users.find(u => u.role === 'admin');
      
      if (faculty && admin && labs.length > 0) {
        console.log('\nCreating sample audit assignment...');
        const sampleAssignment = new AuditAssignment({
          title: 'Monthly Chemical Inventory Audit',
          description: 'Comprehensive audit of all chemical inventory in assigned labs',
          assignedBy: admin._id,
          assignedTo: faculty._id,
          labs: labs.slice(0, 2).map(lab => ({
            labId: lab._id.toString(),
            labName: lab.labName
          })),
          categories: ['chemical', 'equipment'],
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
          estimatedDuration: 4,
          priority: 'high',
          status: 'pending',
          auditTasks: [
            {
              category: 'chemical',
              specificItems: [],
              checklistItems: [
                { item: 'Check expiry dates', description: 'Verify all chemicals are within expiry date', required: true },
                { item: 'Verify storage conditions', description: 'Ensure proper temperature and humidity', required: true },
                { item: 'Check labeling', description: 'All chemicals must be properly labeled', required: true }
              ]
            },
            {
              category: 'equipment',
              specificItems: [],
              checklistItems: [
                { item: 'Check functionality', description: 'Test all equipment is working properly', required: true },
                { item: 'Verify calibration', description: 'Ensure equipment is properly calibrated', required: true }
              ]
            }
          ]
        });

        await sampleAssignment.save();
        console.log('Sample assignment created successfully!');
        console.log(`Assignment ID: ${sampleAssignment._id}`);
        console.log(`Assigned to: ${faculty.name} (${faculty._id})`);
      } else {
        console.log('Cannot create sample assignment - missing faculty, admin, or labs');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    mongoose.disconnect();
  }
}

checkAuditData();
