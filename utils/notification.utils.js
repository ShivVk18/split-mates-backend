import { authenticateSocket } from "../middleware/authSocket.middleware"

export const initializeNotifications = (io) => {
       io.use(authenticateSocket)

       io.on('connection',(socket)=> {
        const userId = socket.userId
        console.log(`🔔 ${socket.user.name} connected for notifications`)


        socket.join(`notifications:${userId}`) 


        socket.on('notifications:mark_read',async(data) => {
            try {
                const {notificationIds} = data

                await prisma.notification.updateMany({
          where: {
            id: { in: notificationIds },
            userId
          },
          data: { isRead: true }
        })     
                   
        socket.emit('notification:marked_read',{
            success:true,
            notificationIds
        })
                
        const unreadCount = await getUnreadCount(userId)
        socket.emit('notifications:unread_count', { count: unreadCount })

            } catch (error) {
                socket.emit('notifications:error', { message: error.message })
            }
        })  

        socket.on('notifications:get_unread_count', async () => {
      try {
        const count = await getUnreadCount(userId)
        socket.emit('notifications:unread_count', { count })
      } catch (error) {
        socket.emit('notifications:error', { message: error.message })
      }
    })

    // Mark all as read
    socket.on('notifications:mark_all_read', async () => {
      try {
        await prisma.notification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true }
        })

        socket.emit('notifications:all_marked_read', { success: true })
        socket.emit('notifications:unread_count', { count: 0 })
      } catch (error) {
        socket.emit('notifications:error', { message: error.message })
      }
    })

  
    socket.on('disconnect', () => {
      console.log(`${socket.user.name} disconnected from notifications`)
    })
       })
}





const getUnreadCount = async (userId) => {
  return await prisma.notification.count({
    where: { userId, isRead: false }
  })
}  


