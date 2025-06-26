import jwt from "jsonwebtoken";

const generateAccessToken = (userId) => {
  return  jwt.sign(
    {
      _id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      isOnline: user.isOnline,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );
};

const generateRefreshToken = (userId) => {
  return jwt.sign(
    {
      _id: user.id,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    }
  );
};


export {
    generateAccessToken,
    generateRefreshToken
}