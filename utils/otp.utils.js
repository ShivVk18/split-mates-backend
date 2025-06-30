import otpGenerator from 'otp-generator'
import { sendEmail } from './email.utils'

const generateOTP = () => {
    return otpGenerator.generate(6,{
         upperCaseAlphabets: false, specialChars: false ,digits:true,
         lowerCaseAlphabets:false
    })
}

const generateOtpExpiry = () => {
    return new Date(Date.now() + 5*60*1000)
}

const isValidOTPFormat = (otp) => {
    return /^\d{6}$/.test(otp)
} 

const isOTPExpired = (otpExpiry) => {
    return new Date() > new Date(otpExpiry)
}

const sendOTPEmail = async(email,otp,userName) => {
    try {
        const data = {
            userName:userName,
            otp:otp
        }

        await sendEmail(email,"otpLogin",data)
        return { success: true, messageId: result.messageId };
    } catch (error) {
    console.error("Failed to send OTP email:", error);
    return { success: false, error: error.message };
    }
}

export {generateOTP,isValidOTPFormat,isOTPExpired,sendOTPEmail,generateOtpExpiry}

