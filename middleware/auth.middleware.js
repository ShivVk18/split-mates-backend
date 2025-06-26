import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler.utils.js";
import { ApiError } from "../utils/apiError.utils";
import prisma from "../config/prismaClient.js";

const verifyToken = async (token) => {
  if (!token) {
    throw new ApiError(401, "Access token required");
  }

  try {
    return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    throw new ApiError(401, "Invalid or expired access token");
  }
};

const findUserById = async (userId) => {
  if (!userId) {
    throw new ApiError(401, "User id is required");
  }

  return await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      isOnline: true,
    },
  });
};

const authenticateUser = asyncHandler(async (req, res, next) => {
  const token =  req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");

  const decodedToken = await verifyToken(token);

  const user = await findUserById(decodedToken._id);

  if (!user) {
    throw new ApiError(401, "User not found")
  }
   
  req.user = user
  
  next()
});


