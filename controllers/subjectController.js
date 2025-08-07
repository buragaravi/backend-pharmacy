const Subject = require('../models/Subject');
const Course = require('../models/Course');
const Experiment = require('../models/Experiment');

// @desc    Get all subjects with filtering and pagination
// @route   GET /api/subjects
// @access  Private
const getSubjects = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      courseId,
      isActive = true,
      search
    } = req.query;

    const filter = {};
    
    if (courseId) filter.courseId = courseId;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const subjects = await Subject.find(filter)
      .populate('courseId', 'courseName courseCode description')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ courseId: 1, name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Subject.countDocuments(filter);

    res.json({
      success: true,
      data: subjects,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching subjects',
      error: error.message
    });
  }
};

// @desc    Get subject by ID
// @route   GET /api/subjects/:id
// @access  Private
const getSubjectById = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id)
      .populate('courseId', 'courseName courseCode description')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    res.json({
      success: true,
      data: subject
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching subject',
      error: error.message
    });
  }
};

// @desc    Create new subject
// @route   POST /api/subjects
// @access  Private (Admin only)
const createSubject = async (req, res) => {
  try {
    const { name, code, courseId, description } = req.body;

    // Validate required fields
    if (!name || !code || !courseId) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, and course are required'
      });
    }

    // Check if course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(400).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Check for duplicate subject code (global uniqueness)
    const existingSubject = await Subject.findOne({ code: code.toUpperCase() });
    if (existingSubject) {
      return res.status(400).json({
        success: false,
        message: 'Subject code already exists'
      });
    }

    const subject = new Subject({
      name,
      code: code.toUpperCase(),
      courseId,
      description,
      createdBy: req.user.id || req.user._id ||req.user.userId || req.userId,
    });

    await subject.save();

    const savedSubject = await Subject.findById(subject._id)
      .populate('courseId', 'courseName courseCode description')
      .populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      data: savedSubject,
      message: 'Subject created successfully'
    });
  } catch (error) {
    console.error('Error in createSubject:', error);
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        message: 'Subject code already exists'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Error creating subject',
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
};

// @desc    Update subject
// @route   PUT /api/subjects/:id
// @access  Private (Admin only)
const updateSubject = async (req, res) => {
  try {
    const { name, code, courseId, description, isActive } = req.body;

    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Check if course exists (if courseId is being updated)
    if (courseId && courseId !== subject.courseId.toString()) {
      const course = await Course.findById(courseId);
      if (!course) {
        return res.status(400).json({
          success: false,
          message: 'Course not found'
        });
      }
    }

    // Check for duplicate subject code (if code is being updated)
    if (code && code.toUpperCase() !== subject.code) {
      const existingSubject = await Subject.findOne({ 
        code: code.toUpperCase(),
        _id: { $ne: req.params.id }
      });
      if (existingSubject) {
        return res.status(400).json({
          success: false,
          message: 'Subject code already exists'
        });
      }
    }

    // Update fields
    if (name) subject.name = name;
    if (code) subject.code = code.toUpperCase();
    if (courseId) subject.courseId = courseId;
    if (description !== undefined) subject.description = description;
    if (isActive !== undefined) subject.isActive = isActive;
    subject.updatedBy = req.user.id || req.user._id || req.user.userId || req.userId;

    await subject.save();

    const updatedSubject = await Subject.findById(subject._id)
      .populate('courseId', 'courseName courseCode description')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    res.json({
      success: true,
      data: updatedSubject,
      message: 'Subject updated successfully'
    });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        message: 'Subject code already exists'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Error updating subject',
        error: error.message
      });
    }
  }
};

// @desc    Delete subject (soft delete)
// @route   DELETE /api/subjects/:id
// @access  Private (Admin only)
const deleteSubject = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }

    // Check if subject is referenced in experiments
    const experimentsCount = await Experiment.countDocuments({ subject: subject.name });
    if (experimentsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete subject. It is referenced in ${experimentsCount} experiment(s)`
      });
    }

    // Soft delete - set isActive to false
    subject.isActive = false;
    subject.updatedBy = req.user.id || req.user._id || req.user.userId || req.userId;
    await subject.save();

    res.json({
      success: true,
      message: 'Subject deactivated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting subject',
      error: error.message
    });
  }
};

// @desc    Get subjects by course
// @route   GET /api/subjects/course/:courseId
// @access  Private
const getSubjectsByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { isActive = true } = req.query;

    const filter = { courseId };
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const subjects = await Subject.find(filter)
      .populate('courseId', 'courseName courseCode description')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: subjects
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching subjects by course',
      error: error.message
    });
  }
};

// @desc    Get subject analytics
// @route   GET /api/subjects/analytics
// @access  Private (Admin only)
const getSubjectAnalytics = async (req, res) => {
  try {
    const totalSubjects = await Subject.countDocuments();
    const activeSubjects = await Subject.countDocuments({ isActive: true });
    const inactiveSubjects = totalSubjects - activeSubjects;

    // Subjects by course
    const subjectsByCourse = await Subject.aggregate([
      {
        $lookup: {
          from: 'courses',
          localField: 'courseId',
          foreignField: '_id',
          as: 'course'
        }
      },
      {
        $unwind: '$course'
      },
      {
        $group: {
          _id: '$courseId',
          courseName: { $first: '$course.courseName' },
          courseCode: { $first: '$course.courseCode' },
          totalSubjects: { $sum: 1 },
          activeSubjects: {
            $sum: { $cond: ['$isActive', 1, 0] }
          }
        }
      },
      {
        $sort: { courseName: 1 }
      }
    ]);

    res.json({
      success: true,
      data: {
        summary: {
          totalSubjects,
          activeSubjects,
          inactiveSubjects
        },
        subjectsByCourse
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching subject analytics',
      error: error.message
    });
  }
};

module.exports = {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject,
  getSubjectsByCourse,
  getSubjectAnalytics
};
