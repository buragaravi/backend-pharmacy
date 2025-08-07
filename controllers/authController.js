// Controller: Authentication 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const SibApiV3Sdk = require('sib-api-v3-sdk');

// Register a new user
exports.register = async (req, res) => {
  try {
    // Log the request body for debugging
    console.log('Register request body:', JSON.stringify(req.body, null, 2));
    
    // Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, role, labId, labAssignments } = req.body;

    // Check if email already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    // For lab assistants, handle both new labAssignments and legacy labId
    if (role === 'lab_assistant') {
      // Prefer labAssignments over labId
      if (labAssignments && Array.isArray(labAssignments) && labAssignments.length > 0) {
        // Validate lab assignments structure
        for (const assignment of labAssignments) {
          if (!assignment.labId || !assignment.labName) {
            return res.status(400).json({ msg: 'Invalid lab assignment structure. Each assignment must have labId and labName.' });
          }
          if (!['read', 'read_write'].includes(assignment.permission)) {
            return res.status(400).json({ msg: 'Invalid permission. Must be "read" or "read_write".' });
          }
        }
      } else if (labId) {
        // Legacy single lab assignment - check if already taken
        const labAssigned = await User.findOne({ role: 'lab_assistant', labId });
        if (labAssigned) {
          return res.status(400).json({ msg: `Lab ID ${labId} is already assigned to another lab assistant.` });
        }
      } else {
        return res.status(400).json({ msg: 'Lab assignment is required for lab assistants. Provide either labAssignments array or labId.' });
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user data object
    const userData = {
      name,
      email,
      password: hashedPassword,
      role
    };

    // Add lab assignment data based on what's provided
    if (role === 'lab_assistant') {
      if (labAssignments && Array.isArray(labAssignments) && labAssignments.length > 0) {
        // Use new lab assignments structure
        userData.labAssignments = labAssignments.map(assignment => ({
          ...assignment,
          assignedBy: null, // System assignment during registration
          assignedAt: new Date(),
          isActive: assignment.isActive !== false // default to true
        }));
      } else if (labId) {
        // Use legacy single lab assignment
        userData.labId = labId;
      }
    }

    // Create new user
    const newUser = new User(userData);

    console.log('About to save user with data:', JSON.stringify(userData, null, 2));
    
    try {
      await newUser.save();
      console.log('User saved successfully');
    } catch (saveError) {
      console.error('Error saving user:', saveError);
      if (saveError.name === 'ValidationError') {
        const validationErrors = Object.values(saveError.errors).map(err => err.message);
        return res.status(400).json({ 
          msg: 'Validation failed', 
          errors: validationErrors,
          details: saveError.errors 
        });
      }
      throw saveError; // Re-throw if it's not a validation error
    }

    // Send welcome email with credentials
    try {
      const emailData = {
        to: [{ email, name }],
        subject: 'Welcome to Jits Pharmacy - Your Account Details',
        htmlContent: `
          <div style="font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; min-height: 100vh;">
            <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);">
              
              <!-- Header Section -->
              <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 30px; text-align: center; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%); animation: pulse 4s ease-in-out infinite;"></div>
                <div style="position: relative; z-index: 2;">
                  <div style="display: inline-block; background: rgba(255, 255, 255, 0.2); padding: 16px; border-radius: 50%; margin-bottom: 20px; backdrop-filter: blur(10px);">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      <path d="M12 14C8.13401 14 5 17.134 5 21H19C19 17.134 15.866 14 12 14Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                  <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; margin: 0; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">Welcome to Pydah Pharmacy!</h1>
                  <p style="color: rgba(255, 255, 255, 0.9); font-size: 18px; margin: 10px 0 0 0; font-weight: 300;">Your account has been created successfully</p>
                </div>
              </div>

              <!-- Main Content -->
              <div style="padding: 40px 30px;">
                <div style="text-align: center; margin-bottom: 40px;">
                  <h2 style="color: #1f2937; font-size: 24px; font-weight: 600; margin: 0 0 10px 0;">Hello ${name}! 👋</h2>
                  <p style="color: #6b7280; font-size: 16px; line-height: 1.6; margin: 0;">Your pharmacy management account is ready to use. Here are your login credentials:</p>
                </div>

                <!-- Credentials Card -->
                <div style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 16px; padding: 30px; margin: 30px 0; border: 1px solid #e5e7eb; position: relative; overflow: hidden;">
                  <div style="position: absolute; top: -10px; right: -10px; width: 60px; height: 60px; background: linear-gradient(135deg, #4f46e5, #7c3aed); border-radius: 50%; opacity: 0.1;"></div>
                  <div style="position: relative; z-index: 2;">
                    <h3 style="color: #374151; font-size: 18px; font-weight: 600; margin: 0 0 20px 0; text-align: center;">Your Login Credentials</h3>
                    
                    <div style="background: #ffffff; border-radius: 12px; padding: 20px; margin-bottom: 15px; border-left: 4px solid #4f46e5; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                      <div style="color: #6b7280; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Email Address</div>
                      <div style="color: #1f2937; font-size: 16px; font-weight: 600; font-family: 'Monaco', 'Menlo', monospace;">${email}</div>
                    </div>
                    
                    <div style="background: #ffffff; border-radius: 12px; padding: 20px; margin-bottom: 15px; border-left: 4px solid #7c3aed; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                      <div style="color: #6b7280; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Temporary Password</div>
                      <div style="color: #1f2937; font-size: 16px; font-weight: 600; font-family: 'Monaco', 'Menlo', monospace;">${password}</div>
                    </div>
                    
                    <div style="background: #ffffff; border-radius: 12px; padding: 20px; border-left: 4px solid #059669; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                      <div style="color: #6b7280; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px;">Role</div>
                      <div style="color: #1f2937; font-size: 16px; font-weight: 600; text-transform: capitalize;">${role.replace('_', ' ')}</div>
                    </div>
                  </div>
                </div>

                <!-- Security Notice -->
                <div style="background: linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%); border-radius: 12px; padding: 20px; margin: 30px 0; border-left: 4px solid #f59e0b;">
                  <div style="display: flex; align-items: flex-start;">
                    <div style="margin-right: 12px; margin-top: 2px;">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <h4 style="color: #92400e; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">Important Security Notice</h4>
                      <p style="color: #92400e; font-size: 14px; line-height: 1.5; margin: 0;">Please change your password after your first login for security purposes. Keep your credentials confidential and never share them with unauthorized personnel.</p>
                    </div>
                  </div>
                </div>

                <!-- Action Button -->
                <div style="text-align: center; margin: 40px 0;">
                  <a href="${process.env.FRONTEND_URL || 'https://jits-pharmacy-labs.vercel.app'}/login" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 50px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(79, 70, 229, 0.4); transition: all 0.3s ease;">
                    Access Your Account →
                  </a>
                </div>

                <!-- Support Info -->
                <div style="background: #f8fafc; border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #e5e7eb;">
                  <h4 style="color: #374151; font-size: 16px; font-weight: 600; margin: 0 0 10px 0;">Need Help?</h4>
                  <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0 0 15px 0;">If you have any questions or need assistance, our support team is here to help.</p>
                  <div style="color: #4f46e5; font-size: 14px; font-weight: 500;">
                    📧 ravi@pydahsoft.in | 📞 +91-90104 62357
                  </div>
                </div>
              </div>

              <!-- Footer -->
              <div style="background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                <div style="margin-bottom: 15px;">
                  <img src="https://i.ibb.co/3gWr97t/pydahsoft-logo.jpg" alt="PydahSoft Logo" style="height: 32px; opacity: 0.8;">
                </div>
                <p style="color: #6b7280; font-size: 12px; line-height: 1.5; margin: 0;">
                  © ${new Date().getFullYear()} PydahSoft. All rights reserved.<br>
                  This email contains confidential information. Please do not forward or share.
                </p>
              </div>
            </div>
          </div>
        `,
        sender: { 
          email: process.env.BREVO_SENDER_EMAIL || 'ravi@pydahsoft.in',
          name: process.env.BREVO_SENDER_NAME || 'Jits Pharmacy System'
        }
      };

      await apiInstance.sendTransacEmail(emailData);
      console.log('Welcome email sent to:', email);
      
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the registration if email fails
    }

    res.status(201).json({ 
      msg: 'User registered successfully. Login credentials have been sent to the provided email address.',
      user: {
        userId: newUser.userId,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (error) {
    console.error('Register function error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      errors: error.errors
    });
    
    // Handle specific error types
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        msg: 'Validation failed', 
        errors: validationErrors,
        details: error.errors 
      });
    }
    
    if (error.code === 11000) {
      return res.status(400).json({ msg: 'User with this email already exists' });
    }
    
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
};


// Login a user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid credentials' });
    }
    // Update last login time
    user.lastLogin = Date.now();
    await user.save();
    console.log(user.userId, user.role)
    // Create JWT payload and send token
    const payload = {
      user: {
        id: user._id,
        userId: user.userId,
        role: user.role,
        labId: user.labId
      }
    };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
      if (err) throw err;
      res.json({ token, user: { userId: user.userId, role: user.role } });
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Get current logged-in user with lab assignments for lab assistants
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // For lab assistants, include active lab assignments
    if (user.role === 'lab_assistant') {
      const userWithAssignments = user.toObject();
      userWithAssignments.activeLabAssignments = user.getActiveLabAssignments();
      return res.json(userWithAssignments);
    }
    
    res.json(user);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};



// Initialize Brevo client
const apiKey = process.env.BREVO_API_KEY;
const defaultClient = SibApiV3Sdk.ApiClient.instance;
defaultClient.authentications['api-key'].apiKey = apiKey;
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// In-memory OTP storage
const otpStorage = new Map();

// Request password reset (step 1: send OTP via Brevo)
exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'No user found with this email' });

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 min expiry

    // Store OTP in memory
    otpStorage.set(email, {
      otp,
      expiry: otpExpiry,
      verified: false
    });

    // Prepare email content using your style approach
    const emailData = {
      to: [{ email }],
      subject: 'Your Password Reset OTP',
      htmlContent: `
        <div style="font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #0f172a; padding: 30px; border-radius: 12px; color: #ffffff; max-width: 600px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); border: 1px solid #1e293b;">
    <!-- Header with logo -->
    <div style="text-align: center; margin-bottom: 25px; border-bottom: 1px solid #1e293b; padding-bottom: 20px;">
        <div style="display: inline-block; background: #1e40af; padding: 12px; border-radius: 50%; margin-bottom: 15px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 15V17M6 21H18C19.1046 21 20 20.1046 20 19V13C20 11.8954 19.1046 11 18 11H6C4.89543 11 4 11.8954 4 13V19C4 20.1046 4.89543 21 6 21ZM16 11V7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7V11H16Z" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <h1 style="color: #e2e8f0; font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 0.5px;">PASSWORD RESET REQUEST</h1>
    </div>
    
    <!-- Greeting -->
    <p style="color: #94a3b8; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Hello ${user.name || 'User'},</p>
    
    <!-- Main content -->
    <p style="color: #94a3b8; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">You've requested to reset your password. Use the following verification code to proceed:</p>
    
    <!-- OTP Box -->
    <div style="background: #1e293b; border-radius: 8px; padding: 25px; text-align: center; margin: 30px 0; border: 1px solid #334155; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);">
        <div style="color: #64748b; font-size: 14px; margin-bottom: 8px; letter-spacing: 1px;">YOUR VERIFICATION CODE</div>
        <div style="color: #38bdf8; font-size: 36px; letter-spacing: 8px; font-weight: 700; font-family: 'Courier New', monospace; margin: 15px 0;">${otp}</div>
        <div style="color: #64748b; font-size: 13px; letter-spacing: 0.5px;">Valid for 10 minutes</div>
    </div>
    
    <!-- Security notice -->
    <div style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #ef4444; padding: 15px; margin: 30px 0; border-radius: 0 4px 4px 0;">
        <p style="color: #fecaca; font-size: 14px; margin: 0; line-height: 1.5;">
            <strong style="color: #f87171;">Security tip:</strong> Never share this code with anyone, including our support team. This code gives access to your account.
        </p>
    </div>
    
    <!-- Footer -->
    <div style="border-top: 1px solid #1e293b; padding-top: 20px; margin-top: 25px; text-align: center;">
        <p style="color: #64748b; font-size: 13px; margin-bottom: 5px;">If you didn't request this, please secure your account.</p>
        <p style="color: #64748b; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} PydahSoft. All rights reserved.</p>
    </div>
</div>
      `,
      sender: { 
        email: process.env.BREVO_SENDER_EMAIL || 'no-reply@yourapp.com',
        name: process.env.BREVO_SENDER_NAME || 'Pydah Pharmacy Stocks Management System'
      }
    };
    console.log(email);

    // Send email via Brevo
    await apiInstance.sendTransacEmail(emailData);
    console.log('OTP sent to:', email);
    console.log('OTP:', otp); // For debugging, remove in production

    res.json({ msg: 'OTP sent to your registered email address' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ 
      msg: 'Failed to send OTP',
      error: error.response?.body || error.message 
    });
  }
};

// Keep your existing verifyOtp and resetPassword functions
// Verify OTP (step 2: verify the OTP)
exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ msg: 'Email and OTP are required' });

    const storedOtpData = otpStorage.get(email);
    if (!storedOtpData) return res.status(400).json({ msg: 'OTP expired or not found' });

    // Check if OTP matches and is not expired
    if (storedOtpData.otp !== otp) {
      return res.status(400).json({ msg: 'Invalid OTP' });
    }

    if (Date.now() > storedOtpData.expiry) {
      otpStorage.delete(email);
      return res.status(400).json({ msg: 'OTP has expired' });
    }

    // Mark OTP as verified
    otpStorage.set(email, { ...storedOtpData, verified: true });

    res.json({ msg: 'OTP verified successfully', token: 'temp_token_for_reset' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};

// Reset password (step 3: update password after OTP verification)
exports.resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ msg: 'Email and new password are required' });

    const storedOtpData = otpStorage.get(email);
    if (!storedOtpData || !storedOtpData.verified) {
      return res.status(400).json({ msg: 'OTP not verified or session expired' });
    }

    // Find user and update password
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    // Clear OTP from storage
    otpStorage.delete(email);

    res.json({ msg: 'Password updated successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
  }
};