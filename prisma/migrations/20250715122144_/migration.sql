/*
  Warnings:

  - A unique constraint covering the columns `[userName]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userName` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'GROUP_UPDATED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FRIEND_REQUEST_ACCEPTED';

-- AlterTable
ALTER TABLE "Group" ALTER COLUMN "currency" SET DEFAULT 'INR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOtpVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otp" TEXT,
ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpBlockedUntil" TIMESTAMP(3),
ADD COLUMN     "otpExpiry" TIMESTAMP(3),
ADD COLUMN     "userName" TEXT NOT NULL,
ALTER COLUMN "timezone" SET DEFAULT 'IST',
ALTER COLUMN "currency" SET DEFAULT 'INR';

-- CreateIndex
CREATE UNIQUE INDEX "User_userName_key" ON "User"("userName");
