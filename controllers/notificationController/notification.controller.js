import prisma from "../../config/prismaClient";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { ApiResponse } from "../../utils/apiHandler.utils";
import { ApiError } from "../../utils/apiError.utils";
import { sendRealTimeNotification } from "../../utils/notificationSocket.utils";

const createNotification = asyncHandler(async (req, res) => {
  const {
    userId,
    type,
    title,
    message,
    data: {},
  } = req.body;

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      data: JSON.stringify(data),
      isRead: false,
    },
  });

  sendRealTimeNotification(userId, notification);

  res
    .status(201)
    .json(
      new ApiResponse(201, notification, "Notification created successfully")
    );
});

const getAllNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, type } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const whereClause = { userId };
  if (type) {
    whereClause.type = type;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take: parseInt(limit),
    }),
    prisma.notification.count({ where: whereClause }),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        notifications,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
      "Notifications fetched successfully"
    )
  );
});


const markAsRead = asyncHandler(async (req, res) => {
  const { notificationIds } = req.body;
  const userId = req.user.id;

  await prisma.notification.updateMany({
    where: {
      id: { in: notificationIds },
      userId,
    },
    data: { isRead: true },
  });

  
  await updateUnreadCount(userId);

  res
    .status(200)
    .json(new ApiResponse(200, null, "Notifications marked as read"));
});


const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const count = await prisma.notification.count({
    where: { userId, isRead: false },
  });

  res.status(200).json(new ApiResponse(200, { count }, "Unread count fetched"));
});

export { createNotification, getAllNotifications, markAsRead, getUnreadCount };
