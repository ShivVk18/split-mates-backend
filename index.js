import app from "./app.js";
import dotenv from "dotenv";

import prisma from "./config/prismaClient.js";

dotenv.config({
  path: "./.env",
});

const startServer = async () => {
  try {
    await prisma.$connect();
    console.log("Prisma connected to PostgreSQL");

    app.listen(process.env.PORT || 8000, () => {
      console.log(`Server is running at port : ${process.env.PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect Prisma:", error);
    process.exit(1);
  }
};

startServer();
