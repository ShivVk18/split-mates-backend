import bcrypt from 'bcrypt'
import { generateAccessToken,generateAccessToken, generateRefreshToken } from './jwt.utils'
import prisma from '../config/prismaClient'
import { ApiError } from './apiError.utils'


const generateTokens = async(userId) => {
    try {
          const accessToken = generateAccessToken(userId)
          const refreshToken = generateRefreshToken(userId)


          return {accessToken,refreshToken}
    } catch (error) {
          throw new ApiError(500,"Problem generating tokens")
    }
}  

const hashedPassword = async(password) => {
    return await bcrypt.hash(password,10)
}

const verifyPassword = async(plainPassword,hashedPassword) => {
    return await bcrypt.compare(plainPassword,hashedPassword)
}

const updateRefreshToken = async(userId,refreshToken) => {
    await prisma.user.update({
        where:{id:userId},
        data:{
            refreshToken:refreshToken
        }
    })
}

const clearRefreshToken = async(userId) => {
    return await updateRefreshToken(userId,null)
}

const getCookieOptions =  () => (
    {
        httpOnly:true,
        secure: process.env.NODE_ENV === 'production',
        sameSite:'strict',
        maxAge:7*24*60*60*1000 
    }
)


export {generateTokens,getCookieOptions,updateRefreshToken,hashedPassword,verifyPassword,clearRefreshToken}