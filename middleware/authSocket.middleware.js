import jwt from 'jsonwebtoken';
import prisma from '../config/prismaClient.js'


export const authenticateSocket = async (socket, next) => {
    try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

        if(!token) {
            return next(new Error("Authentication error"));
        }

        const decoded = jwt.verify(token,process.env.JWT_SECRET);

        const user = await prisma.user.findUnique({
            where:{id:decoded.id},
            select:{
                id: true, name: true, email: true, isActive: true
            }
        })


        if(!user || !user.isActive) {   
               return next(new Error("User not found or inactive"));

         }


         socket.userId = user.id;
         socket.user = user

         next()
    } catch (error) {
        next (new Error('Invalid Token'))
    }
}

