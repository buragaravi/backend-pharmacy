const asyncHandler = require('express-async-handler');
const Experiment = require('../models/Experiment');
const Subject = require('../models/Subject');
const Request = require('../models/Request');

// Add new experiment
exports.addExperiment = asyncHandler(async (req, res) => {
  console.log('=== EXPERIMENT CREATION REQUEST ===');
  console.log('Request body:', req.body);
  console.log('User:', req.user);
  
  const { name, subjectId, description, defaultChemicals } = req.body;

  // Validate required fields
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Experiment name is required' });
  }

  if (!subjectId) {
    return res.status(400).json({ message: 'Subject ID is required' });
  }

  if (!defaultChemicals || !Array.isArray(defaultChemicals) || defaultChemicals.length === 0) {
    return res.status(400).json({ message: 'At least one default chemical is required' });
  }

  // Validate subject exists
  if (subjectId) {
    const subjectExists = await Subject.findById(subjectId);
    if (!subjectExists) {
      return res.status(400).json({ message: 'Invalid subject reference' });
    }
    console.log('Subject found:', subjectExists);
  }

  try {
    console.log('Creating experiment with data:', {
      name,
      subjectId,
      description,
      defaultChemicals,
      createdBy: req.userId || req.user?.id || req.user?._id || 'admin'
    });

    const experiment = await Experiment.create({
      name,
      subjectId,
      description,
      defaultChemicals,
      createdBy: req.userId || req.user?.id || req.user?._id || 'admin'
    });

    console.log('Experiment created successfully:', experiment);

    // Populate subject details in response
    await experiment.populate([
      { path: 'subjectId', populate: { path: 'courseId' } },
      { path: 'createdBy', select: 'name email' }
    ]);

    res.status(201).json({
      message: 'Experiment added successfully',
      experiment
    });
  } catch (error) {
    console.error('Error creating experiment:', error);
    res.status(400).json({ 
      message: 'Failed to create experiment', 
      error: error.message 
    });
  }
});

// Bulk add experiments
exports.bulkAddExperiments = asyncHandler(async (req, res) => {
  const { experiments } = req.body;

  if (!Array.isArray(experiments)) {
    return res.status(400).json({ message: 'Invalid experiments data' });
  }

  const experimentsWithCreator = experiments.map(exp => ({
    ...exp,
    createdBy: req.userId || req.user.id || req.user._id || 'admin'
  }));

  const savedExperiments = await Experiment.insertMany(experimentsWithCreator);

  res.status(201).json({
    message: `${savedExperiments.length} experiments added successfully`,
    experiments: savedExperiments
  });
});

// Get experiments by semester
exports.getExperimentsBySemester = asyncHandler(async (req, res) => {
  const { semester } = req.params;
  const experiments = await Experiment.find({ semester })
    .populate([
      { 
        path: 'subjectId', 
        populate: { 
          path: 'courseId', 
          select: 'courseName courseCode' 
        }
      }
    ])
    .select('name subject subjectId description defaultChemicals')
    .sort({ 'subjectId.name': 1, name: 1 });

  res.status(200).json(experiments);
});

// Get experiments by subject
exports.getExperimentsBySubject = asyncHandler(async (req, res) => {
  const { subjectId } = req.params;
  
  const filter = { subjectId };
  
  const experiments = await Experiment.find(filter)
    .populate([
      { 
        path: 'subjectId', 
        populate: { 
          path: 'courseId', 
          select: 'courseName courseCode' 
        }
      }
    ])
    .select('name description defaultChemicals')
    .sort({ name: 1 });

  res.status(200).json(experiments);
});

// Get experiments by course
exports.getExperimentsByCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  
  // First get subjects for this course
  const subjects = await Subject.find({ courseId, isActive: true });
  const subjectIds = subjects.map(s => s._id);
  
  const filter = { subjectId: { $in: subjectIds } };
  
  const experiments = await Experiment.find(filter)
    .populate([
      { 
        path: 'subjectId', 
        populate: { 
          path: 'courseId', 
          select: 'courseName courseCode' 
        }
      }
    ])
    .select('name description defaultChemicals')
    .sort({ 'subjectId.name': 1, name: 1 });

  res.status(200).json(experiments);
});

// Get experiment details with usage statistics
exports.getExperimentDetails = asyncHandler(async (req, res) => {
  const { experimentId } = req.params;

  const experiment = await Experiment.findById(experimentId);
  if (!experiment) {
    return res.status(404).json({ message: 'Experiment not found' });
  }

  // Get historical usage data
  const historicalRequests = await Request.find({
    'experiments.experimentName': experiment.name
  }).select('experiments.chemicals');

  // Calculate average usage
  const chemicalUsage = {};
  historicalRequests.forEach(request => {
    request.experiments.forEach(exp => {
      if (exp.experimentName === experiment.name) {
        exp.chemicals.forEach(chem => {
          if (!chemicalUsage[chem.chemicalName]) {
            chemicalUsage[chem.chemicalName] = {
              total: 0,
              count: 0,
              unit: chem.unit
            };
          }
          chemicalUsage[chem.chemicalName].total += chem.quantity;
          chemicalUsage[chem.chemicalName].count += 1;
        });
      }
    });
  });

  // Calculate averages
  const averageUsage = Object.entries(chemicalUsage).map(([name, data]) => ({
    chemicalName: name,
    averageQuantity: data.total / data.count,
    unit: data.unit,
    lastUpdated: new Date()
  }));

  // Update experiment with new averages
  experiment.averageUsage = averageUsage;
  experiment.updatedBy = req.userId ||req.user.id || req.user._id ||'admin';
  await experiment.save();

  res.status(200).json({
    experiment,
    historicalData: {
      totalRequests: historicalRequests.length,
      averageUsage
    }
  });
});

// Update experiment
exports.updateExperiment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  console.log('Update experiment - ID:', id);
  console.log('Update experiment - updates:', updates);

  const experiment = await Experiment.findById(id);
  if (!experiment) {
    console.log('Experiment not found with ID:', id);
    return res.status(404).json({ message: 'Experiment not found' });
  }

  console.log('Found experiment:', experiment.name);

  // Update fields
  Object.keys(updates).forEach(key => {
    if (key !== 'createdBy' && key !== '_id') {
      experiment[key] = updates[key];
    }
  });

  experiment.updatedBy = req.userId ||req.user.id || req.user._id ||'admin';
  await experiment.save();

  console.log('Experiment updated successfully');

  res.status(200).json({
    message: 'Experiment updated successfully',
    experiment
  });
});

// Get suggested chemicals for experiment
exports.getSuggestedChemicals = asyncHandler(async (req, res) => {
  const { experimentId } = req.params;

  const experiment = await Experiment.findById(experimentId);
  if (!experiment) {
    return res.status(404).json({ message: 'Experiment not found' });
  }

  // Combine default chemicals with average usage
  const suggestedChemicals = experiment.defaultChemicals.map(defaultChem => {
    const averageUsage = experiment.averageUsage.find(
      avg => avg.chemicalName === defaultChem.chemicalName
    );

    return {
      ...defaultChem,
      suggestedQuantity: averageUsage ? averageUsage.averageQuantity : defaultChem.quantity
    };
  });

  res.status(200).json({
    defaultChemicals: experiment.defaultChemicals,
    averageUsage: experiment.averageUsage,
    suggestedChemicals
  });
});

// Get all experiments
exports.getExperiments = asyncHandler(async (req, res) => {
  const experiments = await Experiment.find()
    .populate([
      { 
        path: 'subjectId', 
        populate: { 
          path: 'courseId', 
          select: 'courseName courseCode' 
        }
      }
    ])
    .select('name description defaultChemicals subjectId subject')
    .sort({ 'subjectId.name': 1, name: 1 });
  res.status(200).json(experiments);
});

// Get experiment by ID
exports.getExperimentById = asyncHandler(async (req, res) => {
  const experiment = await Experiment.findById(req.params.id);
  if (!experiment) {
    return res.status(404).json({ message: 'Experiment not found' });
  }
  res.status(200).json(experiment);
});


// Delete experiment
exports.deleteExperiment = asyncHandler(async (req, res) => {
  const experiment = await Experiment.findById(req.params.id);
  if (!experiment) {
    return res.status(404).json({ message: 'Experiment not found' });
  }

  await experiment.deleteOne();
  res.status(200).json({ message: 'Experiment deleted successfully' });
}); 