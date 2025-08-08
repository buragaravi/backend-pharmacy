const asyncHandler = require('express-async-handler');
const AuditAssignment = require('../models/AuditAssignment');
const AuditExecution = require('../models/AuditExecution');
const User = require('../models/User');
const Lab = require('../models/Lab');
const ChemicalLive = require('../models/ChemicalLive');
const EquipmentLive = require('../models/EquipmentLive');
const GlasswareLive = require('../models/GlasswareLive');
const OtherProductLive = require('../models/OtherProductLive');
const Notification = require('../models/Notification');

// @desc    Create new audit assignment
// @route   POST /api/audit/assignments
// @access  Private (Admin only)
exports.createAuditAssignment = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin only.' });
  }

  const {
    title,
    description,
    assignedTo,
    labs,
    categories,
    dueDate,
    estimatedDuration,
    priority,
    isRecurring,
    recurringPattern,
    specificItems
  } = req.body;

  // Validate assigned faculty
  const faculty = await User.findById(assignedTo);
  if (!faculty || faculty.role !== 'faculty') {
    return res.status(400).json({ message: 'Invalid faculty assignment' });
  }

  // Build audit tasks based on categories and labs
  const auditTasks = [];
  
  for (const category of categories) {
    const task = {
      category,
      specificItems: specificItems?.[category] || [],
      checklistItems: await generateChecklistItems(category, labs)
    };
    auditTasks.push(task);
  }

  const assignment = await AuditAssignment.create({
    title,
    description,
    assignedBy: req.user._id,
    assignedTo,
    labs: labs.map(lab => ({
      labId: lab.labId,
      labName: lab.labName
    })),
    auditTasks,
    dueDate: new Date(dueDate),
    estimatedDuration,
    priority,
    isRecurring,
    recurringPattern
  });

  // Create notification for faculty
  await Notification.create({
    userId: assignedTo,
    message: `New audit assignment: ${title}`,
    type: 'audit',
    relatedAudit: assignment._id
  });

  await assignment.populate([
    { path: 'assignedBy', select: 'name email' },
    { path: 'assignedTo', select: 'name email' }
  ]);

  res.status(201).json({
    success: true,
    message: 'Audit assignment created successfully',
    data: assignment
  });
});

// Helper function to generate checklist items
async function generateChecklistItems(category, labs) {
  const checklistItems = [];
  
  for (const lab of labs) {
    let items = [];
    
    switch (category) {
      case 'chemical':
        items = await ChemicalLive.find({ labId: lab.labId })
          .select('_id chemicalName displayName quantity unit')
          .lean();
        break;
      case 'equipment':
        items = await EquipmentLive.find({ labId: lab.labId })
          .select('itemId name variant quantity location')
          .lean();
        break;
      case 'glassware':
        items = await GlasswareLive.find({ labId: lab.labId })
          .select('itemId name variant quantity condition')
          .lean();
        break;
      case 'others':
        items = await OtherProductLive.find({ labId: lab.labId })
          .select('itemId name variant quantity')
          .lean();
        break;
      case 'all':
        // Combine all categories
        const [chemicals, equipment, glassware, others] = await Promise.all([
          ChemicalLive.find({ labId: lab.labId }).select('_id chemicalName displayName quantity unit').lean(),
          EquipmentLive.find({ labId: lab.labId }).select('itemId name variant quantity location').lean(),
          GlasswareLive.find({ labId: lab.labId }).select('itemId name variant quantity condition').lean(),
          OtherProductLive.find({ labId: lab.labId }).select('itemId name variant quantity').lean()
        ]);
        items = [...chemicals, ...equipment, ...glassware, ...others];
        break;
    }
    
    // Convert to checklist format
    items.forEach(item => {
      checklistItems.push({
        item: `Verify ${item.displayName || item.name}`,
        description: `Check presence, quantity, and condition of ${item.displayName || item.name} in ${lab.labName}`,
        required: true
      });
    });
  }
  
  return checklistItems;
}

// @desc    Get all audit assignments
// @route   GET /api/audit/assignments
// @access  Private
exports.getAuditAssignments = asyncHandler(async (req, res) => {
  const { status, assignedTo, dueDate, priority } = req.query;
  
  let query = {};
  
  // Role-based filtering
  if (req.user.role === 'faculty') {
    query.assignedTo = req.user._id;
  } else if (req.user.role === 'admin') {
    // Admin can see all assignments
    if (assignedTo) query.assignedTo = assignedTo;
  } else {
    return res.status(403).json({ message: 'Access denied' });
  }
  
  // Apply filters
  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (dueDate) {
    const date = new Date(dueDate);
    query.dueDate = {
      $gte: date,
      $lt: new Date(date.getTime() + 24 * 60 * 60 * 1000)
    };
  }
  
  const assignments = await AuditAssignment.find(query)
    .populate('assignedBy', 'name email')
    .populate('assignedTo', 'name email')
    .sort({ createdAt: -1 });
  
  res.status(200).json({
    success: true,
    count: assignments.length,
    data: assignments
  });
});

// @desc    Get single audit assignment
// @route   GET /api/audit/assignments/:id
// @access  Private
exports.getAuditAssignment = asyncHandler(async (req, res) => {
  const assignment = await AuditAssignment.findById(req.params.id)
    .populate('assignedBy', 'name email')
    .populate('assignedTo', 'name email')
    .populate('comments.author', 'name email');
  
  if (!assignment) {
    return res.status(404).json({ message: 'Audit assignment not found' });
  }
  
  // Check permissions
  if (req.user.role === 'faculty' && assignment.assignedTo._id.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Access denied' });
  }
  
  res.status(200).json({
    success: true,
    data: assignment
  });
});

// @desc    Start audit assignment (change status to in_progress)
// @route   PATCH /api/audit/assignments/:id/start
// @access  Private (Faculty)
exports.startAuditAssignment = asyncHandler(async (req, res) => {
  const assignment = await AuditAssignment.findById(req.params.id);
  if (!assignment) {
    return res.status(404).json({ message: 'Audit assignment not found' });
  }
  
  // Check if user is assigned to this audit
  if (assignment.assignedTo.toString() !== req.user._id.toString()) {
    return res.status(403).json({ message: 'Not authorized for this audit' });
  }
  
  // Update status to in_progress
  assignment.status = 'in_progress';
  assignment.startedAt = new Date();
  await assignment.save();
  
  res.status(200).json({
    success: true,
    message: 'Audit started successfully',
    data: assignment
  });
});

// @desc    Start audit execution
// @route   POST /api/audit/assignments/:id/start
// @access  Private (Faculty)
exports.startAuditExecution = asyncHandler(async (req, res) => {
  const { labId, category } = req.body;
  
  console.log('startAuditExecution called with:', { labId, category });
  console.log('Assignment ID:', req.params.id);
  
  const assignment = await AuditAssignment.findById(req.params.id);
  if (!assignment) {
    console.log('Assignment not found');
    return res.status(404).json({ message: 'Audit assignment not found' });
  }
  
  console.log('Assignment found:', assignment.title);
  console.log('Assignment labs:', assignment.labs);
  
  // Check if user is assigned to this audit
  if (assignment.assignedTo.toString() !== req.user._id.toString()) {
    console.log('User not authorized for this audit');
    return res.status(403).json({ message: 'Not authorized for this audit' });
  }
  
  // Check if lab is included in assignment
  const assignedLab = assignment.labs.find(lab => lab.labId === labId);
  console.log('Looking for labId:', labId);
  console.log('Found lab:', assignedLab);
  
  if (!assignedLab) {
    console.log('Lab not found in assignment. Available labs:', assignment.labs.map(l => l.labId));
    return res.status(400).json({ 
      message: 'Lab not included in audit assignment',
      availableLabs: assignment.labs.map(l => ({ labId: l.labId, labName: l.labName })),
      requestedLab: labId
    });
  }
  
  // Generate checklist items for this specific execution
  const checklistItems = await generateExecutionChecklist(category, labId);
  
  // Check if there's already an execution for this assignment, lab, and category
  const existingExecution = await AuditExecution.findOne({
    assignmentId: assignment._id,
    labId,
    category,
    status: { $in: ['in_progress', 'completed'] }
  });
  
  if (existingExecution) {
    console.log('Found existing execution:', existingExecution.executionId);
    return res.status(200).json({
      success: true,
      message: 'Returning existing audit execution',
      data: existingExecution
    });
  }
  
  const execution = await AuditExecution.create({
    assignmentId: assignment._id,
    executedBy: req.user._id,
    labId,
    labName: assignedLab.labName,
    category,
    checklistItems,
    startedAt: new Date()
  });
  
  console.log('Created new execution:', execution.executionId);
  
  // Update assignment status
  if (assignment.status === 'assigned') {
    assignment.status = 'in_progress';
    assignment.startedAt = new Date();
    await assignment.save();
  }
  
  res.status(201).json({
    success: true,
    message: 'Audit execution started',
    data: execution
  });
});

// Helper function to generate detailed checklist for execution
async function generateExecutionChecklist(category, labId) {
  let items = [];
  
  switch (category) {
    case 'chemical':
      items = await ChemicalLive.find({ labId })
        .select('_id chemicalName displayName quantity unit location')
        .lean();
      return items.map(item => ({
        itemId: item._id.toString(),
        itemName: item.displayName || item.chemicalName,
        itemType: 'chemical',
        expectedLocation: item.location || labId,
        expectedQuantity: item.quantity,
        status: 'not_checked'
      }));
      
    case 'equipment':
      items = await EquipmentLive.find({ labId })
        .select('itemId name variant quantity location condition')
        .lean();
      return items.map(item => ({
        itemId: item.itemId,
        itemName: `${item.name} (${item.variant})`,
        itemType: 'equipment',
        expectedLocation: item.location,
        expectedQuantity: item.quantity || 1,
        status: 'not_checked'
      }));
      
    case 'glassware':
      items = await GlasswareLive.find({ labId })
        .select('_id name variant quantity condition location')
        .lean();
      return items.map(item => ({
        itemId: item._id.toString(), // Use _id since GlasswareLive doesn't have itemId
        itemName: `${item.name}${item.variant ? ` (${item.variant})` : ''}`,
        itemType: 'glassware',
        expectedLocation: item.location || labId,
        expectedQuantity: item.quantity || 1,
        status: 'not_checked'
      }));
      
    case 'others':
      items = await OtherProductLive.find({ labId })
        .select('_id name variant quantity location')
        .lean();
      return items.map(item => ({
        itemId: item._id.toString(), // Use _id since OtherProductLive doesn't have itemId
        itemName: `${item.name}${item.variant ? ` (${item.variant})` : ''}`,
        itemType: 'others',
        expectedLocation: item.location || labId,
        expectedQuantity: item.quantity || 1,
        status: 'not_checked'
      }));
      
    default:
      return [];
  }
}

// @desc    Update checklist item status
// @route   PUT /api/audit/executions/:id/items/:itemId
// @access  Private (Faculty)
exports.updateChecklistItem = asyncHandler(async (req, res) => {
  console.log('Updating checklist item:', req.params.itemId);
  console.log('Execution ID:', req.params.id);
  console.log('Request body:', req.body);
  
  const { status, actualQuantity, actualLocation, condition, remarks } = req.body;
  
  const execution = await AuditExecution.findById(req.params.id);
  if (!execution) {
    console.log('Execution not found');
    return res.status(404).json({ message: 'Audit execution not found' });
  }
  
  console.log('Found execution:', execution.executionId);
  
  // Check permissions
  if (execution.executedBy.toString() !== req.user._id.toString()) {
    console.log('Access denied - user mismatch');
    return res.status(403).json({ message: 'Access denied' });
  }
  
  // Find and update the item
  const item = execution.checklistItems.find(i => i.itemId === req.params.itemId);
  if (!item) {
    console.log('Checklist item not found');
    return res.status(404).json({ message: 'Checklist item not found' });
  }
  
  console.log('Found item, updating status from', item.status, 'to', status);
  
  item.status = status;
  item.actualQuantity = actualQuantity;
  item.actualLocation = actualLocation;
  item.condition = condition;
  item.remarks = remarks;
  item.checkedAt = new Date();
  
  // Update summary
  execution.updateSummary();
  await execution.save();
  
  console.log('Item updated successfully, new completion:', execution.getCompletionPercentage(), '%');
  
  res.status(200).json({
    success: true,
    message: 'Checklist item updated',
    data: item,
    completion: execution.getCompletionPercentage()
  });
});

// @desc    Complete audit execution
// @route   POST /api/audit/executions/:id/complete
// @access  Private (Faculty)
exports.completeAuditExecution = asyncHandler(async (req, res) => {
  console.log('Completing audit execution:', req.params.id);
  console.log('Request body:', req.body);
  console.log('User:', req.user._id);
  
  const { generalObservations, recommendations } = req.body;
  
  const execution = await AuditExecution.findById(req.params.id);
  if (!execution) {
    console.log('Execution not found');
    return res.status(404).json({ message: 'Audit execution not found' });
  }
  
  console.log('Found execution:', execution.executionId);
  console.log('Executed by:', execution.executedBy);
  
  // Check permissions
  if (execution.executedBy.toString() !== req.user._id.toString()) {
    console.log('Access denied - user mismatch');
    return res.status(403).json({ message: 'Access denied' });
  }
  
  execution.status = 'completed';
  execution.completedAt = new Date();
  execution.generalObservations = generalObservations;
  execution.recommendations = recommendations;
  
  await execution.save();
  console.log('Execution saved with status:', execution.status);
  
  // Update assignment progress
  const assignment = await AuditAssignment.findById(execution.assignmentId);
  if (assignment) {
    await assignment.calculateProgress();
    await assignment.save();
    console.log('Assignment progress updated to:', assignment.progress, '%, status:', assignment.status);
  }
  
  res.status(200).json({
    success: true,
    message: 'Audit execution completed',
    data: execution
  });
});

// @desc    Get audit dashboard stats
// @route   GET /api/audit/dashboard
// @access  Private
exports.getAuditDashboard = asyncHandler(async (req, res) => {
  let query = {};
  
  if (req.user.role === 'faculty') {
    query.assignedTo = req.user._id;
  }
  
  const [
    totalAssignments,
    activeAssignments,
    completedAssignments,
    overdueAssignments,
    totalExecutions,
    completedExecutions
  ] = await Promise.all([
    AuditAssignment.countDocuments(query),
    AuditAssignment.countDocuments({ ...query, status: 'in_progress' }),
    AuditAssignment.countDocuments({ ...query, status: 'completed' }),
    AuditAssignment.countDocuments({ 
      ...query, 
      status: { $ne: 'completed' },
      dueDate: { $lt: new Date() }
    }),
    AuditExecution.countDocuments(req.user.role === 'faculty' ? { executedBy: req.user._id } : {}),
    AuditExecution.countDocuments({ 
      ...(req.user.role === 'faculty' ? { executedBy: req.user._id } : {}),
      status: 'completed' 
    })
  ]);

  res.status(200).json({
    success: true,
    data: {
      assignments: {
        total: totalAssignments,
        active: activeAssignments,
        completed: completedAssignments,
        overdue: overdueAssignments
      },
      executions: {
        total: totalExecutions,
        completed: completedExecutions
      }
    }
  });
});

// @desc    Get all audit assignments (Admin)
// @route   GET /api/audit/assignments
// @access  Private (Admin)
exports.getAllAuditAssignments = asyncHandler(async (req, res) => {
  const assignments = await AuditAssignment.find()
    .populate('assignedTo', 'name email')
    .populate('assignedBy', 'name email')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: assignments
  });
});

// @desc    Get all audit executions (Admin)
// @route   GET /api/audit/executions
// @access  Private (Admin)
exports.getAllAuditExecutions = asyncHandler(async (req, res) => {
  const executions = await AuditExecution.find()
    .populate('executedBy', 'name email')
    .populate('assignmentId', 'title assignmentId')
    .sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: executions
  });
});

// @desc    Get execution by assignment ID
// @route   GET /api/audit/executions/assignment/:assignmentId
// @access  Private (Admin, Faculty)
exports.getExecutionByAssignment = asyncHandler(async (req, res) => {
  const { assignmentId } = req.params;
  
  const execution = await AuditExecution.findOne({ assignmentId })
    .populate('executedBy', 'name email')
    .populate('assignmentId', 'title assignmentId')
    .sort({ createdAt: -1 }); // Get the most recent execution

  if (!execution) {
    return res.status(404).json({
      success: false,
      message: 'No execution found for this assignment'
    });
  }

  res.status(200).json({
    success: true,
    data: execution
  });
});

// @desc    Get audit analytics data
// @route   GET /api/audit/analytics
// @access  Private (Admin/Faculty)
exports.getAuditAnalytics = asyncHandler(async (req, res) => {
  let query = {};
  
  if (req.user.role === 'faculty') {
    query.assignedTo = req.user._id;
  }
  
  const [
    totalAssignments,
    activeAssignments,
    completedAssignments,
    overdueAssignments,
    totalExecutions,
    completedExecutions,
    assignments,
    executions
  ] = await Promise.all([
    AuditAssignment.countDocuments(query),
    AuditAssignment.countDocuments({ ...query, status: { $in: ['assigned', 'in_progress'] } }),
    AuditAssignment.countDocuments({ ...query, status: 'completed' }),
    AuditAssignment.countDocuments({ ...query, status: 'overdue' }),
    AuditExecution.countDocuments(),
    AuditExecution.countDocuments({ status: 'completed' }),
    AuditAssignment.find(query).populate('assignedTo', 'name').populate('labs', 'labName'),
    AuditExecution.find().populate('assignmentId', 'title').populate('executedBy', 'name')
  ]);

  // Calculate additional metrics
  const avgCompletionTime = executions.filter(e => e.completedAt && e.startedAt)
    .reduce((acc, e) => acc + (new Date(e.completedAt) - new Date(e.startedAt)), 0) / 
    Math.max(completedExecutions, 1) / (1000 * 60 * 60); // Convert to hours

  const complianceRate = totalAssignments > 0 ? (completedAssignments / totalAssignments) * 100 : 0;

  // Generate trend data (last 7 days)
  const trendData = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const dayExecutions = executions.filter(e => 
      new Date(e.createdAt).toISOString().split('T')[0] === dateStr
    ).length;
    
    trendData.push({
      date: dateStr,
      audits: dayExecutions,
      completed: executions.filter(e => 
        e.status === 'completed' && 
        new Date(e.completedAt).toISOString().split('T')[0] === dateStr
      ).length
    });
  }

  // Category performance data
  const categoryData = [
    { name: 'Chemical', value: executions.filter(e => e.category === 'chemical').length },
    { name: 'Equipment', value: executions.filter(e => e.category === 'equipment').length },
    { name: 'Glassware', value: executions.filter(e => e.category === 'glassware').length },
    { name: 'Others', value: executions.filter(e => e.category === 'others').length }
  ];

  // Lab performance data
  const labGroups = {};
  executions.forEach(e => {
    if (e.labName) {
      if (!labGroups[e.labName]) {
        labGroups[e.labName] = { completed: 0, total: 0 };
      }
      labGroups[e.labName].total++;
      if (e.status === 'completed') {
        labGroups[e.labName].completed++;
      }
    }
  });

  const labPerformance = Object.entries(labGroups).map(([name, data]) => ({
    lab: name,
    completed: data.completed,
    total: data.total,
    percentage: data.total > 0 ? (data.completed / data.total) * 100 : 0
  }));

  // Faculty performance data
  const facultyGroups = {};
  assignments.forEach(a => {
    if (a.assignedTo) {
      const facultyName = a.assignedTo.name;
      if (!facultyGroups[facultyName]) {
        facultyGroups[facultyName] = { completed: 0, total: 0 };
      }
      facultyGroups[facultyName].total++;
      if (a.status === 'completed') {
        facultyGroups[facultyName].completed++;
      }
    }
  });

  const facultyPerformance = Object.entries(facultyGroups).map(([name, data]) => ({
    faculty: name,
    completed: data.completed,
    pending: data.total - data.completed,
    total: data.total
  }));

  res.status(200).json({
    success: true,
    data: {
      overview: {
        totalAudits: totalAssignments,
        completedAudits: completedAssignments,
        pendingAudits: activeAssignments,
        overdue: overdueAssignments,
        avgCompletionTime: Math.round(avgCompletionTime * 100) / 100,
        complianceRate: Math.round(complianceRate * 100) / 100
      },
      trendData,
      categoryData,
      labPerformance,
      facultyPerformance,
      complianceHistory: trendData.map(d => ({
        date: d.date,
        compliance: d.audits > 0 ? (d.completed / d.audits) * 100 : 0
      }))
    }
  });
});

// @desc    Get faculty-specific audit assignments
// @route   GET /api/audit/assignments/faculty/:facultyId
// @access  Private (Faculty only)
exports.getFacultyAuditAssignments = asyncHandler(async (req, res) => {
  const { facultyId } = req.params;
  
  console.log('Faculty ID from params:', facultyId);
  console.log('Request user ID:', req.user._id.toString());
  console.log('Request user role:', req.user.role);
  
  // Ensure faculty can only access their own assignments
  if (req.user._id.toString() !== facultyId && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. You can only view your own assignments.' });
  }

  const assignments = await AuditAssignment.find({ 
    assignedTo: facultyId 
  })
  .populate('assignedTo', 'name email')
  .populate('labs', 'labName')
  .populate('assignedBy', 'name')
  .sort({ createdAt: -1 });

  console.log('Found assignments:', assignments.length);
  console.log('Assignments:', assignments);

  res.status(200).json({
    success: true,
    data: assignments
  });
});

// @desc    Get faculty-specific audit statistics
// @route   GET /api/audit/faculty-stats/:facultyId
// @access  Private (Faculty only)
exports.getFacultyAuditStats = asyncHandler(async (req, res) => {
  const { facultyId } = req.params;
  
  // Ensure faculty can only access their own stats
  if (req.user._id.toString() !== facultyId && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied. You can only view your own statistics.' });
  }

  const now = new Date();
  
  // Get assignment statistics
  const totalAssigned = await AuditAssignment.countDocuments({ assignedTo: facultyId });
  const completed = await AuditAssignment.countDocuments({ assignedTo: facultyId, status: 'completed' });
  const inProgress = await AuditAssignment.countDocuments({ assignedTo: facultyId, status: 'in_progress' });
  const pending = await AuditAssignment.countDocuments({ assignedTo: facultyId, status: { $in: ['pending', 'assigned'] } });
  
  // Get overdue assignments
  const overdue = await AuditAssignment.countDocuments({ 
    assignedTo: facultyId, 
    dueDate: { $lt: now },
    status: { $ne: 'completed' }
  });

  // Calculate average completion time
  const completedAssignments = await AuditAssignment.find({ 
    assignedTo: facultyId, 
    status: 'completed',
    completedAt: { $exists: true }
  }).select('createdAt completedAt estimatedDuration');

  let avgCompletionTime = null;
  if (completedAssignments.length > 0) {
    const totalTime = completedAssignments.reduce((sum, assignment) => {
      const timeTaken = (assignment.completedAt - assignment.createdAt) / (1000 * 60 * 60); // in hours
      return sum + timeTaken;
    }, 0);
    avgCompletionTime = Math.round((totalTime / completedAssignments.length) * 10) / 10;
  }

  // Get unread notifications count
  const unreadNotifications = await Notification.countDocuments({ 
    recipient: facultyId, 
    read: false 
  });

  // Get recent performance trends
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentCompletion = await AuditAssignment.countDocuments({ 
    assignedTo: facultyId,
    status: 'completed',
    completedAt: { $gte: last30Days }
  });

  const recentTotal = await AuditAssignment.countDocuments({ 
    assignedTo: facultyId,
    createdAt: { $gte: last30Days }
  });

  const recentCompletionRate = recentTotal > 0 ? Math.round((recentCompletion / recentTotal) * 100) : 0;

  res.status(200).json({
    success: true,
    data: {
      totalAssigned,
      completed,
      inProgress,
      pending,
      overdue,
      avgCompletionTime,
      unreadNotifications,
      completionRate: totalAssigned > 0 ? Math.round((completed / totalAssigned) * 100) : 0,
      recentCompletionRate,
      performanceGrade: getPerformanceGrade(completed, totalAssigned, overdue)
    }
  });
});

// Helper function to calculate performance grade
function getPerformanceGrade(completed, total, overdue) {
  if (total === 0) return 'N/A';
  
  const completionRate = (completed / total) * 100;
  const overdueRate = (overdue / total) * 100;
  
  if (completionRate >= 90 && overdueRate <= 5) return 'A+';
  if (completionRate >= 80 && overdueRate <= 10) return 'A';
  if (completionRate >= 70 && overdueRate <= 15) return 'B+';
  if (completionRate >= 60 && overdueRate <= 20) return 'B';
  if (completionRate >= 50) return 'C';
  return 'D';
}

// Functions are already exported individually as exports.functionName above
// No need for module.exports since all functions are defined as exports.functionName
