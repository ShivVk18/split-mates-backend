import prisma from "../../config/prismaClient";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { ApiError } from "../../utils/apiError.utils";
import { ApiResponse } from "../../utils/apiHandler.utils";

const sendFriendRequest = asyncHandler(async (req, res) => {
  const { friendEmail } = req.body;
  const userId = req.user?.id;

  if (!friendEmail) {
    throw new ApiError(400, "Email is required to send friend request");
  }

  const friend = await prisma.user.findUnique({
    where: { email: friendEmail },
  });

  if (!friend || !friend.isActive) {
    throw new ApiError(404, "No active user found with this email");
  }

  if (friend.id === userId) {
    throw new ApiError(400, "You cannot send friend request to yourself");
  }

  const existingFriendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { userId, friendId: friend.id },
        { userId: friend.id, friendId: userId },
      ],
    },
  });

  if (existingFriendship) {
    if (existingFriendship.status === "PENDING") {
      throw new ApiError(400, "Friend request already sent");
    }
    if (existingFriendship.status === "ACCEPTED") {
      throw new ApiError(400, "You are already friends");
    }
  }

  const newFriendRequest = await prisma.friendship.create({
    data: {
      userId,
      friendId: friend.id,
      status: "PENDING",
    },
    include: {
      user: { select: { id: true, name: true, email: true, isonline: true } },
      friend: { select: { id: true, name: true, email: true, isonline: true } },
    },
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, newFriendRequest, "Friend request successfully sent")
    );
});

const getPendingFriendRequests = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const pendingRequests = await prisma.friendship.findMany({
    where: {
      friendId: userId,
      status: "PENDING",
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isOnline: true,
        },
      },
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        count: pendingRequests.length,
        requests: pendingRequests,
      },
      "Pending friend requests fetched successfully"
    )
  );
});

const acceptFriendRequest = asyncHandler(async (req, res) => {
  const { friendId } = req.body;
  const userId = req.user.id;

  if (!friendId) {
    throw new ApiError(400, "Friend ID is required to accept the request");
  }

  const existingRequest = await prisma.friendship.findUnique({
    where: {
      userId_friendId: {
        userId: friendId,
        friendId: userId,
      },
    },
  });

  if (!existingRequest || existingRequest.status !== "PENDING") {
    throw new ApiError(400, "No pending friend request found from this user");
  }

  await prisma.friendship.update({
    where: {
      userId_friendId: {
        userId: friendId,
        friendId: userId,
      },
    },
    data: {
      status: "ACCEPTED",
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Friend request accepted successfully"));
});

const declineFriendRequest = asyncHandler(async (req, res) => {
  const { friendId } = req.body;
  const userId = req.user.id;

  if (!friendId) {
    throw new ApiError(400, "Friend ID is required to decline the request");
  }

  const existingRequest = await prisma.friendship.findUnique({
    where: {
      userId_friendId: {
        userId: friendId,
        friendId: userId,
      },
    },
  });

  if (!existingRequest || existingRequest.status !== "PENDING") {
    throw new ApiError(400, "No pending friend request found from this user");
  }

  await prisma.friendship.delete({
    where: {
      userId_friendId: {
        userId: friendId,
        friendId: userId,
      },
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Friend request declined successfully"));
});

const getAllFriends = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const [totalCount, friendships] = await prisma.$transaction([
    prisma.friendship.count({
      where: {
        OR: [
          { userId: userId, status: "ACCEPTED" },
          { friendId: userId, status: "ACCEPTED" },
        ],
      },
    }),

    prisma.friendship.findMany({
      where: {
        OR: [
          { userId: userId, status: "ACCEPTED" },
          { friendId: userId, status: "ACCEPTED" },
        ],
      },
      skip,
      take: limit,
      include: {
        friend: { select: { id: true, name: true, email: true, isOnline: true } },
        user: { select: { id: true, name: true, email: true, isOnline: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const formattedFriends = friendships.map((friendship) => {
    if (friendship.userId === userId) return friendship.friend;
    return friendship.user;
  });

  return res.status(200).json(
    new ApiResponse(200, {
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      friends: formattedFriends,
    }, "Friends fetched successfully")
  );
});



const removeFriend = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { friendId } = req.body;

  const getFriend = await prisma.friendship.findFirst({
    where: {
      OR: [
        { userId: userId, friendId: friendId },
        { friendId: userId, userId: friendId },
      ],
    },
    include: {
      friend: {
        select: { name: true, id: true, email: true, isonline: true },
      },
      user: {
        select: {
          name: true,
          id: true,
          email: true,
          isonline: true,
        },
      },
    },
  });

  if (!getFriend || getFriend.status !== "ACCEPTED") {
    throw new ApiError(400, "No active friendship found to remove");
  }

  await prisma.friendship.delete({
    where: {
      id: getFriend.id
    }
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Friend removed successfully"));
});

export {sendFriendRequest,getPendingFriendRequests,acceptFriendRequest,declineFriendRequest,getAllFriends,removeFriend}

