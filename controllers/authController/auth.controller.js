import prisma from "../../config/prismaClient.js";

import { ApiError } from "../../utils/apiError.utils.js";
import { ApiResponse } from "../../utils/apiHandler.utils.js";
import { asyncHandler } from "../../utils/asyncHandler.utils.js";
import { clearRefreshToken, getCookieOptions, hashedPassword, verifyPassword } from "../../utils/auth.utils.js";
import { uploadOnCloudinary } from "../../utils/cloudinary.utils.js";

const userSignUp = asyncHandler(async (req, res) => {
  const { name, userName, email, password, phone, timezone, currency } =
    req.body;

  const requiredFields = [name, email, password, phone];

  if (requiredFields.some((field) => !field?.trim())) {
    throw new ApiError(400, "All fields are required");
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be 8 characters long");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    throw new ApiError(400, "Invalid email format");
  }

  const mobileRegex = /^[0-9]{10}$/;
  if (!mobileRegex.test(phone)) {
    throw new ApiError(400, "Mobile number must be 10 digits");
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ userName: userName }, { email: email }],
    },
  });

  if (existingUser) {
    throw new ApiError(400, "User already found");
  }

  const avatarPicPath = req.files?.avatar?.[0]?.path;

  if (!avatarPicPath) {
    throw new ApiError(400, "Avatar is required");
  }

  const avatarPicUrl = await uploadOnCloudinary(avatarPicPath);

  if (!avatarPicUrl) {
    throw new ApiError(400, "Unable to upload avatar");
  }
  const encryptedPassword = await hashedPassword(password);

  const user = await prisma.user.create({
    data: {
      name: name,
      userName: userName,
      email: email,
      phone: phone,
      password: encryptedPassword,
      avatar: avatarPicUrl?.url,
      isOnline: false,
      isActive: true,
      timezone: timezone || "IST",
      currency: currency || "INR",
    },
    select: {
      id: true,
      name: true,
      userName: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, user, "User has been created successfully"));
});
const userLogin = asyncHandler(async (req, res) => {
  const { userNameorEmail, password } = req.body;

  if (!userNameorEmail || !password) {
    throw new ApiError(400, "Email/Username and password are required");
  }

  const isEmail = userNameorEmail.includes("@");
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (isEmail && !emailRegex.test(userNameorEmail)) {
    throw new ApiError(400, "Invalid email format");
  }

  const searchField = isEmail ? "email" : "userName";

  const user = await prisma.user.findUnique({
    where: {
      [searchField]: userNameorEmail,
    },
    select: {
      id: true,
      password: true,
      userName: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
      isActive: true,
    },
  });

  if (!user) {
    throw new ApiError(400, "Invalid username or email");
  }

  if (!user.isActive) {
    throw new ApiError(
      400,
      "Your account is inactive. Please contact support."
    );
  }

  const validatePassword = await verifyPassword(password, user.password);

  if (!validatePassword) {
    throw new ApiError(400, "Password is incorrect");
  }

  const { password: _, ...userWithoutPassword } = user;

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        user: userWithoutPassword,
        requiresOTP: true,
      },
      "Credentials verified. Please verify OTP to complete login."
    )
  );
});


const logout = asyncHandler(async(req,res) => { 
     const userId = req.user?.id

     await clearRefreshToken(userId)

     const options = getCookieOptions()
      
     return res.clearCookie('accessToken',options).clearCookie("refreshToken",options).json(
        new ApiResponse(200,{},"User logged out successfully")
     )
} )

const getProfile = asyncHandler(async(req,res)=> {
  const userId = req.user.id

  if(!userId){
    throw new ApiError(400,"User id not found")
  }
   
  const userProfile = await prisma.user.findUnique({
    where:{
      id:userId
    },
    select:{
      id: true,
      name: true,
      userName: true,
      email: true,
      phone: true,
      avatar: true,
      isOnline: true,
      timezone: true,
      currency: true,
      
    },
    
  })

  if(!userProfile){
    throw new ApiError(404,"User not found")
  }

  return res.status(200).json(
    new ApiResponse(200,userProfile,"User Profile fetched successfully")
  )
    
})

