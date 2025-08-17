import app from "./app.js";
import dotenv from "dotenv"; 
import { Server } from 'socket.io'
import createServer from 'http'

import prisma from "./config/prismaClient.js";
import { initializeNotifications } from "./utils/notification.utils.js";

dotenv.config({
  path: "./.env",
});

const server = createServer(app)

//to do -> add cors origin
const io = new Server(server,{
   transports: ["websocket",'polling']
})


global.io = io

initializeNotifications(io)

const startServer = async () => {
  try {
    await prisma.$connect();
    console.log("Prisma connected to PostgreSQL");

    server.listen(process.env.PORT || 8000, () => {
      console.log(`Server is running at port : ${process.env.PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect Prisma:", error);
    process.exit(1);
  }
};

startServer();
