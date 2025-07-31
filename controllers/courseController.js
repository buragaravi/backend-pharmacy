const asyncHandler = require('express-async-handler');
const Course = require('../models/Course');
const { validationResult } = require('express-validator');

// @desc    Get all courses with batches
// @route   GET /api/courses
// @access  Private (Admin/Faculty)
exports.getCourses = asyncHandler(async (req, res) => {
  const { academicYear, active } = req.query;
  
  const filter = {};
  if (active === 'true') filter.isActive = true;
  
  let courses = await Course.find(filter)
    .populate('createdBy', 'name')
    .populate('updatedBy', 'name')
    .sort({ courseName: 1 });
  
  // Filter by academic year if provided (at batch level)
  if (academicYear) {
    courses = courses.map(course => ({
      ...course.toObject(),
      batches: course.batches.filter(batch => batch.academicYear === academicYear)
    })).filter(course => course.batches.length > 0);
  }
  
  res.status(200).json({
    success: true,
    count: courses.length,
    data: courses
  });
});

// @desc    Get active courses with active batches only
// @route   GET /api/courses/active
// @access  Private (Faculty)
exports.getActiveCourses = asyncHandler(async (req, res) => {
  const { academicYear } = req.query;
  
  const filter = { isActive: true };
  
  let courses = await Course.find(filter)
    .select('courseName courseCode batches')
    .sort({ courseName: 1 });
  
  // Filter to show only active batches and optionally by academic year
  const coursesWithActiveBatches = courses.map(course => {
    let activeBatches = course.batches.filter(batch => batch.isActive);
    
    // Further filter by academic year if provided
    if (academicYear) {
      activeBatches = activeBatches.filter(batch => batch.academicYear === academicYear);
    }
    
    return {
      ...course.toObject(),
      batches: activeBatches
    };
  }).filter(course => course.batches.length > 0); // Only return courses with active batches
  
  res.status(200).json({
    success: true,
    data: coursesWithActiveBatches
  });
});

// @desc    Get single course by ID
// @route   GET /api/courses/:id
// @access  Private
exports.getCourseById = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id)
    .populate('createdBy', 'name')
    .populate('updatedBy', 'name');
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  res.status(200).json({
    success: true,
    data: course
  });
});

// @desc    Create new course with batches
// @route   POST /api/courses
// @access  Private (Admin)
exports.createCourse = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  
  const { courseName, courseCode, description, batches } = req.body;
  
  // Validate at least one batch
  if (!batches || batches.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Course must have at least one batch'
    });
  }
  
  // Validate that all batches have academic year
  const batchesWithoutYear = batches.filter(batch => !batch.academicYear);
  if (batchesWithoutYear.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'All batches must have an academic year'
    });
  }
  
  // Check if course code already exists
  const existingCourse = await Course.findOne({ courseCode });
  if (existingCourse) {
    return res.status(400).json({
      success: false,
      message: 'Course code already exists'
    });
  }
  
  const course = await Course.create({
    courseName,
    courseCode: courseCode.toUpperCase(),
    description,
    batches,
    createdBy: req.userId
  });
  
  await course.populate('createdBy', 'name');
  
  res.status(201).json({
    success: true,
    message: 'Course created successfully',
    data: course
  });
});

// @desc    Update course
// @route   PUT /api/courses/:id
// @access  Private (Admin)
exports.updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  const { courseName, courseCode, description, isActive, batches } = req.body;
  
  // Validate batches if provided
  if (batches) {
    if (batches.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Course must have at least one batch'
      });
    }
    
    // Validate that all batches have academic year
    const batchesWithoutYear = batches.filter(batch => !batch.academicYear);
    if (batchesWithoutYear.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'All batches must have an academic year'
      });
    }
  }
  
  // Check if course code is being changed and if it already exists
  if (courseCode && courseCode !== course.courseCode) {
    const existingCourse = await Course.findOne({ courseCode: courseCode.toUpperCase() });
    if (existingCourse) {
      return res.status(400).json({
        success: false,
        message: 'Course code already exists'
      });
    }
  }
  
  // Update course fields
  if (courseName) course.courseName = courseName;
  if (courseCode) course.courseCode = courseCode.toUpperCase();
  if (description !== undefined) course.description = description;
  if (isActive !== undefined) course.isActive = isActive;
  if (batches !== undefined) course.batches = batches;
  
  course.updatedBy = req.userId;
  await course.save();
  
  await course.populate('updatedBy', 'name');
  
  res.status(200).json({
    success: true,
    message: 'Course updated successfully',
    data: course
  });
});

// @desc    Delete course
// @route   DELETE /api/courses/:id
// @access  Private (Admin)
exports.deleteCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id);
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  await course.deleteOne();
  
  res.status(200).json({
    success: true,
    message: 'Course deleted successfully'
  });
});

// @desc    Add batch to course
// @route   POST /api/courses/:courseId/batches
// @access  Private (Admin)
exports.addBatch = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId);
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  const { batchName, batchCode, numberOfStudents } = req.body;
  
  // Check if batch code already exists in this course
  const existingBatch = course.batches.find(batch => batch.batchCode === batchCode);
  if (existingBatch) {
    return res.status(400).json({
      success: false,
      message: 'Batch code already exists in this course'
    });
  }
  
  course.batches.push({
    batchName,
    batchCode,
    numberOfStudents: numberOfStudents || undefined,
    createdAt: new Date()
  });
  
  course.updatedBy = req.userId;
  await course.save();
  
  res.status(200).json({
    success: true,
    message: 'Batch added successfully',
    data: course
  });
});

// @desc    Update batch in course
// @route   PUT /api/courses/:courseId/batches/:batchId
// @access  Private (Admin)
exports.updateBatch = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId);
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  const batch = course.batches.id(req.params.batchId);
  if (!batch) {
    return res.status(404).json({
      success: false,
      message: 'Batch not found'
    });
  }
  
  const { batchName, batchCode, numberOfStudents, isActive } = req.body;
  
  // Check if batch code is being changed and if it already exists
  if (batchCode && batchCode !== batch.batchCode) {
    const existingBatch = course.batches.find(b => b.batchCode === batchCode && b._id.toString() !== batch._id.toString());
    if (existingBatch) {
      return res.status(400).json({
        success: false,
        message: 'Batch code already exists in this course'
      });
    }
  }
  
  // Update batch fields
  if (batchName) batch.batchName = batchName;
  if (batchCode) batch.batchCode = batchCode;
  if (numberOfStudents !== undefined) batch.numberOfStudents = numberOfStudents || undefined;
  if (isActive !== undefined) batch.isActive = isActive;
  
  course.updatedBy = req.userId;
  await course.save();
  
  res.status(200).json({
    success: true,
    message: 'Batch updated successfully',
    data: course
  });
});

// @desc    Delete batch from course
// @route   DELETE /api/courses/:courseId/batches/:batchId
// @access  Private (Admin)
exports.deleteBatch = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.courseId);
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  // Check if this is the last batch
  if (course.batches.length === 1) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete the last batch. Course must have at least one batch.'
    });
  }
  
  const batch = course.batches.id(req.params.batchId);
  if (!batch) {
    return res.status(404).json({
      success: false,
      message: 'Batch not found'
    });
  }
  
  batch.deleteOne();
  course.updatedBy = req.userId;
  await course.save();
  
  res.status(200).json({
    success: true,
    message: 'Batch deleted successfully',
    data: course
  });
});

// @desc    Get batches for a specific course
// @route   GET /api/courses/:courseId/batches
// @access  Private
exports.getCourseBatches = asyncHandler(async (req, res) => {
  const { active } = req.query;
  
  const course = await Course.findById(req.params.courseId)
    .select('courseName courseCode batches');
  
  if (!course) {
    return res.status(404).json({
      success: false,
      message: 'Course not found'
    });
  }
  
  let batches = course.batches;
  if (active === 'true') {
    batches = batches.filter(batch => batch.isActive);
  }
  
  res.status(200).json({
    success: true,
    data: {
      courseInfo: {
        _id: course._id,
        courseName: course.courseName,
        courseCode: course.courseCode
      },
      batches
    }
  });
});

// @desc    Get course statistics
// @route   GET /api/courses/stats
// @access  Private (Admin)
exports.getCourseStats = asyncHandler(async (req, res) => {
  const stats = await Course.aggregate([
    {
      $group: {
        _id: null,
        totalCourses: { $sum: 1 },
        activeCourses: { $sum: { $cond: ['$isActive', 1, 0] } },
        totalBatches: { $sum: { $size: '$batches' } },
        activeBatches: {
          $sum: {
            $size: {
              $filter: {
                input: '$batches',
                as: 'batch',
                cond: { $eq: ['$$batch.isActive', true] }
              }
            }
          }
        }
      }
    }
  ]);
  
  const academicYearStats = await Course.aggregate([
    { $match: { isActive: true } },
    { $unwind: '$batches' },
    {
      $group: {
        _id: '$batches.academicYear',
        courseCount: { $addToSet: '$_id' },
        batchCount: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 1,
        courseCount: { $size: '$courseCount' },
        batchCount: 1
      }
    },
    { $sort: { _id: -1 } }
  ]);
  
  res.status(200).json({
    success: true,
    data: {
      overview: stats[0] || {
        totalCourses: 0,
        activeCourses: 0,
        totalBatches: 0,
        activeBatches: 0
      },
      byAcademicYear: academicYearStats
    }
  });
});

module.exports = exports;
