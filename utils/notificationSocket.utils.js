export const sendRealTimeNotification = (userId, notification) => {
  if (global.io) {
    global.io.to(`notifications:${userId}`).emit("notifications:new", {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data ? JSON.parse(notification.data) : {},
      createdAt: notification.createdAt,
      isRead: false,
    });
  }
};

export const sendBulkRealtimeNotifications = (notifications) => {
  if (global.io) {
    notifications.forEach((notification) => {
      global.io
        .to(`notifications:${notification.userId}`)
        .emit("notifications:new", {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          data: notification.data ? JSON.parse(notification.data) : {},
          createdAt: notification.createdAt,
          isRead: false,
        });
    });
  }
};

export const updateUnreadCount = async (userId) => {
  if (global.io) {
    try {
      const count = await prisma.notification.count({
        where: { userId, isRead: false },
      });

      global.io
        .to(`notifications:${userId}`)
        .emit("notifications:unread_count", {
          count,
        });
    } catch (error) {
      console.error("Error updating unread count:", error);
    }
  }
};

export const isUserConnectedToNotifications = (userId) => {
  if (!global.io) return false;

  const room = global.io.sockets.adapter.rooms.get(`notifications:${userId}`);
  return room && room.size > 0;
};

export const getConnectedNotificationUsers = () => {
  if (!global.io) return 0;
  return global.io.sockets.sockets.size;
};
