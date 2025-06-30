import prisma from "../../config/prismaClient.js";
import { ApiError } from "../../utils/apiError.utils.js";
import { ApiResponse } from "../../utils/apiHandler.utils.js";
import { asyncHandler } from "../../utils/asyncHandler.utils.js";
import { generateTokens, updateRefreshToken } from "../../utils/auth.utils.js";
import { generateOTP, generateOtpExpiry, isOTPExpired, isValidOTPFormat, sendOTPEmail } from "../../utils/otp.utils.js";
import { cookieOptions } from "../../utils/cookieOptions.utils.js"; // Assuming this exists

const sendLoginOTP = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    throw new ApiError(400, "userId is required");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      userName: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
      isActive: true,
      otp: true,
      otpAttempts: true,
      otpExpiry: true,
      otpBlockedUntil: true,
    },
  });

  if (!user) {
    throw new ApiError(400, "No user found");
  }

  if (!user.isActive) {
    throw new ApiError(400, "User found but is not active");
  }

  if (user.otpBlockedUntil && new Date() < new Date(user.otpBlockedUntil)) {
    throw new ApiError(429, "Too many OTP requests. Please try again after 1 hour.");
  }

  if (user.otpBlockedUntil && new Date() >= new Date(user.otpBlockedUntil)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpAttempts: 0, otpBlockedUntil: null },
    });
  }

  const otp = generateOTP();
  const otpExpiry = generateOtpExpiry();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      otp: otp,
      otpAttempts: user.otpAttempts + 1,
      otpExpiry: otpExpiry,
      isOtpVerified: false,
    },
  });

  const emailResult = await sendOTPEmail(user.email, otp, user.userName);
  if (!emailResult.success) {
    throw new ApiError(400, "Unable to send OTP email");
  }

  return res.status(200).json(
    new ApiResponse(200, {
      userId: user.id,
      otpSent: true,
      expiresIn: "5min",
    }, "OTP sent successfully")
  );
});

const verifyOtp = asyncHandler(async (req, res) => {
  const { userId, otp } = req.body;

  if (!userId) {
    throw new ApiError(400, "userId is required");
  }
  if (!otp) {
    throw new ApiError(400, "otp is required");
  }

  const validOtp = isValidOTPFormat(otp);
  if (!validOtp) {
    throw new ApiError(400, "Otp format is not valid");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      userName: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
      isActive: true,
      otp: true,
      otpAttempts: true,
      otpExpiry: true,
      otpBlockedUntil: true,
    },
  });

  if (!user) {
    throw new ApiError(400, "User not available");
  }

  if (user.otpBlockedUntil && new Date() < new Date(user.otpBlockedUntil)) {
    throw new ApiError(429, "Too many failed attempts. Please try again after 1 hour.");
  }

  if (!user.otp || !user.otpExpiry) {
    throw new ApiError(400, "No OTP found. Please request a new OTP.");
  }

  if (isOTPExpired(user.otpExpiry)) {
    throw new ApiError(400, "OTP has expired. Please request a new OTP.");
  }

  if (user.otp !== otp) {
    const updateData = { otpAttempts: user.otpAttempts + 1 };

    if (updateData.otpAttempts >= 5) {
      updateData.otpBlockedUntil = new Date(Date.now() + 60 * 60 * 1000);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    throw new ApiError(400, "Invalid OTP");
  }

  const { accessToken, refreshToken } = generateTokens(user.id);
  await updateRefreshToken(user.id, refreshToken);

  const verifiedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      otp: null,
      otpExpiry: null,
      isOnline: true,
      isOtpVerified: true,
      otpAttempts: 0,
      otpBlockedUntil: null,
    },
    select: {
      id: true,
      userName: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
      isActive: true,
      groups: {
        select: {
          group: { select: { name: true } },
        },
      },
    },
  });

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(new ApiResponse(200, verifiedUser, "User login and verified successfully"));
});

const resendOtp = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    throw new ApiError(400, "userId is required");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      userName: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
      isActive: true,
      otp: true,
      otpAttempts: true,
      otpExpiry: true,
      otpBlockedUntil: true,
    },
  });

  if (!user) {
    throw new ApiError(400, "No user found");
  }

  if (!user.isActive) {
    throw new ApiError(400, "User found but is not active");
  }

  if (user.otpBlockedUntil && new Date() < new Date(user.otpBlockedUntil)) {
    throw new ApiError(429, "Too many OTP requests. Please try again after 1 hour.");
  }

  if (user.otpBlockedUntil && new Date() >= new Date(user.otpBlockedUntil)) {
    await prisma.user.update({
      where: { id: user.id },
      data: { otpAttempts: 0, otpBlockedUntil: null },
    });
  }

  const otp = generateOTP();
  const otpExpiry = generateOtpExpiry();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      otp: otp,
      otpAttempts: user.otpAttempts + 1,
      otpExpiry: otpExpiry,
      isOtpVerified: false,
    },
  });

  const emailResult = await sendOTPEmail(user.email, otp, user.userName);
  if (!emailResult.success) {
    throw new ApiError(400, "Unable to send OTP email");
  }

  return res.status(200).json(
    new ApiResponse(200, {
      userId: user.id,
      otpSent: true,
      expiresIn: "5min",
    }, "New OTP sent successfully")
  );
});

export { sendLoginOTP, resendOtp, verifyOtp };
