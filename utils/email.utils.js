import nodemailer from 'nodemailer'


const createTransport = () => {
    return nodemailer.createTransport({
        service:'gmail',
       auth: {
             user:process.env.EMAIL_USER,
             pass:process.env.EMAIL_PASS
        }
})
}


const transporter = createTransport()


const emailTemplates = () => (
    { 
    otpLogin: (data) => ({
    subject: "Your Login OTP - EmpTrack",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; text-align: center;">EmpTrack Login Verification</h2>
        <p>Dear ${data.userName},</p>
        <p>Your One-Time Password (OTP) for login verification is:</p>
        <div style="background: #f8f9fa; border: 2px solid #007bff; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
          <h1 style="color: #007bff; font-size: 32px; margin: 0; letter-spacing: 5px;">${data.otp}</h1>
        </div>
        <p><strong>Important:</strong></p>
        <ul>
          <li>This OTP is valid for <strong>5 minutes</strong> only</li>
          <li>Do not share this OTP with anyone</li>
          <li>If you didn't request this login, please contact your administrator</li>
        </ul>
        <p>Best regards,<br>EmpTrack Security Team</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 12px; color: #666; text-align: center;">
          This is an automated message. Please do not reply to this email.
        </p>
      </div>
    `
  }) ,

  welcomeAfterSignup: (userName) => ({
  subject: `Welcome to SplitMates - Account Created Successfully`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #f9f9f9;">
      <h2 style="color: #4A90E2; text-align: center;">Welcome to SplitMates!</h2>
      <p>Hi ${userName},</p>
      <p>Your account has been created successfully. We're excited to have you .</p>
      <p>Start exploring SplitMates and simplify your expense sharing!</p>
      <p>Best regards,<br>The SplitMates Team</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="font-size: 12px; color: #999; text-align: center;">
        This is an automated message from SplitMates. Please do not reply.
      </p>
    </div>
  `,
}),

groupInvite: (data) => ({
  subject: `You're invited to join the group "${data.groupName}" on SplitMates`,
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4A90E2; text-align: center;">You're Invited to Join ${data.groupName}</h2>
      <p>Hi there,</p>
      <p>You have been invited to join the group <strong>${data.groupName}</strong> on <strong>SplitMates</strong>.</p>
      <p>Click the button below to accept or decline the invitation:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${data.inviteLink}" style="background-color: #4A90E2; color: #fff; padding: 12px 20px; text-decoration: none; border-radius: 5px;">Accept Invite</a>
      </div>
      <p>If you did not expect this invitation, you can safely ignore this email.</p>
      <p>Note: This invite will expire in 24 hours.</p>
      <br>
      <p>Best regards,<br>SplitMates Team</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      <p style="font-size: 12px; color: #666; text-align: center;">
        This is an automated message. Please do not reply to this email.
      </p>
    </div>
  `,
}),
}
)

const sendEmail = async(to,templateName,templateData) => {
 try {
    const template = emailTemplates[templateName](templateData)
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || "noreply@SplitMates.com",
      to,
      subject: template.subject,
      html: template.html,
    }

    const result = await transporter.sendMail(mailOptions)
    console.log("Email sent successfully:", result.messageId)
    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error("Email sending failed:", error)
    return { success: false, error: error.message }
  }
}

export {sendEmail,emailTemplates}