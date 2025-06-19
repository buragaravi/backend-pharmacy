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
    // Validate request body
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId, name, email, password, role, labId } = req.body;

    // Check if email already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ msg: 'User already exists' });
    }

    // For lab assistants, ensure labId is provided and not already taken
    if (role === 'lab_assistant') {
      if (!labId) {
        return res.status(400).json({ msg: 'Lab ID is required for lab assistants.' });
      }

      const labAssigned = await User.findOne({ role: 'lab_assistant', labId });
      if (labAssigned) {
        return res.status(400).json({ msg: `Lab ID ${labId} is already assigned to another lab assistant.` });
      }
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({
      userId,
      name,
      email,
      password: hashedPassword,
      role,
      ...(role === 'lab_assistant' && { labId }) // only include labId if role is lab_assistant
    });

    await newUser.save();
    res.status(201).json({ msg: 'User registered successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server error');
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

// Get current logged-in user// Get current logged-in user
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
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