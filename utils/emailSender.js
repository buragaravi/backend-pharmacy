// utils/emailSender.js
const SibApiV3Sdk = require('sib-api-v3-sdk');
const defaultClient = SibApiV3Sdk.ApiClient.instance;

// Configure API key authorization
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const sendOtpEmail = async (email, otp) => {
  try {
    const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    
    sendSmtpEmail.subject = "Your Password Reset OTP";
    sendSmtpEmail.htmlContent = `
      <p>Your OTP for password reset is: <strong>${otp}</strong></p>
      <p>This OTP is valid for 10 minutes.</p>
    `;
    sendSmtpEmail.sender = { 
      name: "Pydah Pharmacy stocks management system", 
      email: "ravi@pydahsoft.in" 
    };
    sendSmtpEmail.to = [{ email }];
    
    await apiInstance.sendTransacEmail(sendSmtpEmail);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send OTP email');
  }
};

module.exports = { sendOtpEmail };