const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Get user by ID (admin only)
exports.getUserById = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Update user (admin only)
exports.updateUser = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const { name, email, role, labId, labAssignments } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Update basic user fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (role) user.role = role;

    // Handle lab assignments for lab assistants
    if (role === 'lab_assistant') {
      if (labAssignments && Array.isArray(labAssignments) && labAssignments.length > 0) {
        // Use new lab assignments structure
        user.labAssignments = labAssignments.map(assignment => ({
          labId: assignment.labId,
          labName: assignment.labName,
          permission: assignment.permission || 'read',
          assignedBy: assignment.assignedBy || req.user._id, // Set to current admin user
          assignedAt: assignment.assignedAt || new Date(),
          isActive: assignment.isActive !== false // default to true
        }));
        
        // Clear legacy labId when using new structure
        user.labId = undefined;
      } else if (labId) {
        // Use legacy single lab assignment (fallback)
        // Check if lab is already assigned to another lab assistant
        const labAssigned = await User.findOne({ 
          role: 'lab_assistant', 
          labId, 
          _id: { $ne: user._id } 
        });
        if (labAssigned) {
          return res.status(400).json({ msg: `Lab ID ${labId} is already assigned to another lab assistant.` });
        }
        user.labId = labId;
        
        // Clear lab assignments when using legacy structure
        user.labAssignments = [];
      } else {
        // If neither labAssignments nor labId provided, clear both
        user.labAssignments = [];
        user.labId = undefined;
      }
    } else {
      // For non-lab assistants, clear lab assignments and labId
      user.labAssignments = [];
      user.labId = undefined;
    }

    await user.save();
    res.json({ 
      msg: 'User updated successfully', 
      user: await User.findById(user._id).select('-password') 
    });
  } catch (error) {
    console.error('User update error:', error.message);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};

// Reset user password (admin only)
exports.resetPassword = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ msg: 'New password is required' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update user's password
    user.password = hashedPassword;
    await user.save();

    res.json({ msg: 'Password reset successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Delete user (admin only)
exports.deleteUser = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    await User.deleteOne({ _id: req.params.id });
    res.json({ msg: 'User deleted successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Lab Assignment CRUD Operations

// Add lab assignment to user (admin only)
exports.addLabAssignment = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const { userId } = req.params;
    const { labId, permission = 'read' } = req.body;

    if (!labId) {
      return res.status(400).json({ msg: 'Lab ID is required' });
    }

    if (!['read', 'read_write'].includes(permission)) {
      return res.status(400).json({ msg: 'Invalid permission. Must be "read" or "read_write"' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    if (user.role !== 'lab_assistant') {
      return res.status(400).json({ msg: 'Lab assignments can only be added to lab assistants' });
    }

    // Validate lab exists
    const Lab = require('../models/Lab');
    const lab = await Lab.findOne({ labId, isActive: true });
    if (!lab) {
      return res.status(400).json({ msg: 'Lab not found or inactive' });
    }

    if (labId === 'central-store') {
      return res.status(400).json({ msg: 'Cannot assign central-store to lab assistants' });
    }

    try {
      user.addLabAssignment(labId, permission, req.user._id);
      await user.save();

      res.json({ 
        msg: 'Lab assignment added successfully', 
        assignment: {
          labId,
          labName: lab.labName,
          permission,
          assignedAt: new Date()
        }
      });
    } catch (error) {
      return res.status(400).json({ msg: error.message });
    }
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Update lab assignment (admin only)
exports.updateLabAssignment = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const { userId, labId } = req.params;
    const { permission } = req.body;

    if (!['read', 'read_write'].includes(permission)) {
      return res.status(400).json({ msg: 'Invalid permission. Must be "read" or "read_write"' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    try {
      user.updateLabAssignment(labId, { permission });
      await user.save();

      res.json({ 
        msg: 'Lab assignment updated successfully',
        assignment: {
          labId,
          permission
        }
      });
    } catch (error) {
      return res.status(400).json({ msg: error.message });
    }
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Remove lab assignment (admin only)
exports.removeLabAssignment = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const { userId, labId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    try {
      user.removeLabAssignment(labId);
      await user.save();

      res.json({ msg: 'Lab assignment removed successfully' });
    } catch (error) {
      return res.status(400).json({ msg: error.message });
    }
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Get user's lab assignments (admin only)
exports.getUserLabAssignments = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const { userId } = req.params;

    const user = await User.findById(userId).select('name email role labAssignments');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const activeAssignments = user.getActiveLabAssignments();

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      labAssignments: activeAssignments
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Get all lab assistants with their lab assignments (admin only)
exports.getAllLabAssistants = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Not authorized to access this resource' });
    }

    const labAssistants = await User.find({ role: 'lab_assistant' })
      .select('name email role labId labName labAssignments createdAt')
      .sort({ name: 1 });

    const assistantsWithAssignments = labAssistants.map(assistant => {
      const assistantObj = assistant.toObject();
      assistantObj.activeLabAssignments = assistant.getActiveLabAssignments();
      return assistantObj;
    });

    res.json({
      count: assistantsWithAssignments.length,
      labAssistants: assistantsWithAssignments
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};