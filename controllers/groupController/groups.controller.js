import { ApiError } from "../../utils/apiError.utils";
import { ApiResponse } from "../../utils/apiHandler.utils";
import prisma from "../../config/prismaClient";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { generateToken } from "../../utils/token.util";
import { sendEmail } from "../../utils/email.utils";

const createGroup = asyncHandler(async (req, res) => {
  const { name, description, category, currency } = req.body;

  if (!name) {
    throw new ApiError(400, "Group name is required");
  }

  const userId = req.user.id;
  const currentUserName = req.user.name;

  if (!userId) {
    throw new ApiError(400, "User id is required");
  }

  const group = await prisma.group.create({
    data: {
      name: name,
      description: description,
      category: category ? category?.toUpperCase() : "GENERAL",
      currency: currency,
      createdBy: userId,
    },
  });

  const groupMemberTable = await prisma.groupMember.create({
    data: {
      userId: userId,
      groupId: group.id,
      isActive: true,
    },
  });

  const activityLog = await prisma.activity.create({
    data: {
      userId: userId,
      groupId: group.id,
      type: "GROUP_CREATED",
      action: `Group created by ${currentUserName}`,
      metadata: { name: group.name },
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, { group }, "Group created successfully"));
});

const addGroupMember = asyncHandler(async (req, res) => {
  const { groupId, userEmail } = req.body;
  const requesterId = req.user.id;

  if (!groupId || !userEmail) {
    throw new ApiError(400, "Group ID and User Email are required");
  }

  const group = await prisma.group.findFirst({
    where: { id: groupId },
  });

  if (!group) {
    throw new ApiError(404, "Group does not exist");
  }

  if (!group.isActive) {
    throw new ApiError(403, "Group is not active");
  }

  if (group.createdBy !== requesterId) {
    throw new ApiError(403, "Only group admin can add members");
  }

  const user = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  if (!user || !user.isActive) {
    throw new ApiError(404, "User not found or inactive");
  }

  const userId = user.id;

  const existingMember = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId,
      },
    },
  });

  let memberAction = "";
  let statusCode = 200;

  if (existingMember) {
    await prisma.groupMember.update({
      where: {
        userId_groupId: {
          userId,
          groupId,
        },
      },
      data: {
        isActive: true,
      },
    });
    memberAction = "reactivated";
    statusCode = 200;
  } else {
    await prisma.groupMember.create({
      data: {
        userId,
        groupId,
        isActive: true,
      },
    });
    memberAction = "added";
    statusCode = 201;
  }

  await prisma.activity.create({
    data: {
      userId: requesterId,
      groupId: groupId,
      type: "MEMBER_ADDED",
      action: `User ${user.name} (${user.email}) ${memberAction} to group ${group.name}`,
      metadata: {
        addedUserId: userId,
        addedUserEmail: user.email,
        addedUserName: user.name,
      },
    },
  });

  return res
    .status(statusCode)
    .json(
      new ApiResponse(
        statusCode,
        {},
        `User successfully ${memberAction} to group`
      )
    );
});

const getAllGroups = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const findGroupMember = await prisma.groupMember.findMany({
    where: {
      userId,
      isActive: true,
    },
    skip,
    take: limit,
    include: {
      group: {
        include: {
          _count: {
            select: {
              members: true,
            },
          },
        },
      },
    },
    orderBy: {
      group: {
        createdAt: "desc",
      },
    },
  });

  if (!findGroupMember.length) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], "No groups found for this user"));
  }

  const formattedGroups = findGroupMember.map((member) => {
    const group = member.group;
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      currency: group.currency,
      category: group.category,
      totalMembers: group._count.members,
      createdAt: group.createdAt,
      createdBy: group.createdBy,
    };
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        currentPage: page,
        limit,
        groups: formattedGroups,
      },
      "Groups fetched successfully"
    )
  );
});

const getGroupById = asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  const userId = req.user.id;

  const checkUser = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        groupId: groupId,
        userId: userId,
      },
    },
  });

  if (!checkUser) {
    throw new ApiError(403, "User is not a member of the group");
  }

  const fetchGroupData = await prisma.group.findUnique({
    where: {
      id: groupId,
    },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
        },
      },
      members: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
              isOnline: true,
            },
          },
        },
      },

      expenses: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          paidBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          splits: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!fetchGroupData) {
    return new ApiError(404, "Group not found");
  }

  const formattedMembers = fetchGroupData.members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    avatar: member.user.avatar,
    isOnline: member.user.isOnline,
    joinedAt: member.joinedAt,
  }));

  const formattedExpenses = fetchGroupData.expenses.map((expense) => ({
    id: expense.id,
    description: expense.description,
    amount: expense.amount,
    splitType: expense.splitType,
    date: expense.date,
    paidBy: expense.paidBy,
    splits: expense.splits.map((split) => ({
      user: split.user,
      amount: split.amount,
    })),
  }));

  const responseData = {
    id: fetchGroupData.id,
    name: fetchGroupData.name,
    description: fetchGroupData.description,
    currency: fetchGroupData.currency,
    category: fetchGroupData.category,
    createdAt: fetchGroupData.createdAt,
    createdBy: {
      id: fetchGroupData.creator.id,
      name: fetchGroupData.creator.name,
      email: fetchGroupData.creator.email,
      avatar: fetchGroupData.creator.avatar,
    },
    members: formattedMembers,
    recentExpenses: formattedExpenses,
  };

  return res
    .status(200)
    .json(new ApiResponse(200, responseData, "Group details fetched"));
});

const updateGroupInfo = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const currentUserName = req.user.name;

  const { groupId } = req.params;
  const { name, description, category, currency } = req.body;

  if (!groupId) {
    throw new ApiError(400, "Group ID is required");
  }

  const groupExists = await prisma.group.findUnique({
    where: { id: groupId },
  });

  if (!groupExists) {
    throw new ApiError(404, "Group not found");
  }

  if (groupExists.createdBy !== userId) {
    throw new ApiError(403, "Unauthorized access");
  }

  const updatedGroup = await prisma.group.update({
    where: { id: groupId },
    data: {
      name: name ?? groupExists.name,
      description: description ?? groupExists.description,
      category: category?.toUpperCase() ?? groupExists.category,
      currency: currency ?? groupExists.currency,
    },
  });

  await prisma.activity.create({
    data: {
      userId,
      groupId: groupId,
      type: "GROUP_UPDATED",
      action: `Group updated by ${currentUserName}`,
      metadata: {
        newName: name ?? "",
        newDescription: description ?? "",
        newCategory: category ?? "",
        newCurrency: currency ?? "",
        oldName: groupExists.name,
        oldDescription: groupExists.description,
        oldCategory: groupExists.category,
        oldCurrency: groupExists.currency,
      },
    },
  });

  return res
    .status(200)
    .json(
      new ApiResponse(200, updatedGroup, "Group info updated successfully")
    );
});

const removeMemberFromGroup = asyncHandler(async (req, res) => {
  const { groupId } = req.params;

  const { memberId } = req.body;

  const userId = req.user.id;

  const groupExists = await prisma.group.findUnique({
    where: { id: groupId },
  });

  if (!groupExists) {
    throw new ApiError(404, "Group not found");
  }

  if (groupExists.createdBy !== userId) {
    throw new ApiError(403, "Unauthorized access");
  }

  const checkMember = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: memberId,
        groupId: groupId,
      },
    },
  });

  if (!checkMember || !checkMember.isActive) {
    throw new ApiError(400, "Member is already removed or not in the group");
  }

  if (memberId === userId) {
    throw new ApiError(400, "Admin cannot remove themselves from the group");
  }

  const removedUser = await prisma.groupMember.update({
    where: {
      userId_groupId: {
        userId: memberId,
        groupId: groupId,
      },
    },
    data: {
      isActive: false,
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
      group: {
        select: {
          name: true,
        },
      },
    },
  });

  await prisma.activity.create({
    data: {
      userId: userId,
      groupId: groupId,
      type: "MEMBER_REMOVED",
      action: `User ${removedUser.user.name} removed from group ${removedUser.group.name}`,
      metadata: {
        removedUserId: removedUser.user.id,
        removedUserEmail: removedUser.user.email,
        removedBy: req.user.email,
      },
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Member removed from group successfully"));
});

const deleteGroup = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { groupId } = req.params;

  const groupExists = await prisma.group.findUnique({
    where: { id: groupId },
  });

  if (!groupExists) {
    throw new ApiError(404, "Group not found");
  }

  if (groupExists.createdBy !== userId) {
    throw new ApiError(403, "Unauthorized access");
  }

  await prisma.group.update({
    where: { id: groupId },
    data: { isActive: false },
  });

  await prisma.groupMember.updateMany({
    where: { groupId },
    data: { isActive: false },
  });

  await prisma.activity.create({
    data: {
      userId: userId,
      groupId: groupId,
      type: "GROUP_DELETED",
      action: `Group "${groupExists.name}" has been deleted`,
      metadata: {
        groupName: groupExists.name,
        deletedBy: req.user.email,
      },
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Group deleted successfully"));
});

const searchAndInviteUser = asyncHandler(async (req, res) => {
  const { groupId, userEmail } = req.body;
  const userId = req.user.id;

  if (!groupId || !userEmail) {
    throw new ApiError(400, "Group ID and user email are required");
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
  });

  if (!group) {
    throw new ApiError(404, "Group does not exist");
  }

  if (!group.isActive) {
    throw new ApiError(403, "Group is not active");
  }

  if (group.createdBy !== userId) {
    throw new ApiError(403, "Only group admin can send invites");
  }

  const existingInvite = await prisma.groupInvite.findFirst({
    where: {
      groupId,
      email: userEmail,
      status: "PENDING",
    },
  });

  if (existingInvite && existingInvite.expiresAt > new Date()) {
    throw new ApiError(400, "An active invite already exists for this user");
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  if (existingUser) {
    const isMember = await prisma.groupMember.findUnique({
      where: {
        userId_groupId: {
          userId: existingUser.id,
          groupId,
        },
      },
    });

    if (isMember?.isActive) {
      throw new ApiError(400, "User is already a member of the group");
    }
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

  const invite = await prisma.groupInvite.create({
    data: {
      groupId,
      email: userEmail,
      token,
      expiresAt,
      status: "PENDING",
    },
  });

  await sendEmail(userEmail, "groupInvite", {
    groupName: group.name,
    inviteLink: `${process.env.CLIENT_URL}/group-invite/${token}`,
  });

  await prisma.activity.create({
    data: {
      userId,
      groupId,
      type: "GROUP_INVITE",
      action: `Invite sent to ${userEmail} for group ${group.name}`,
      metadata: {
        invitedEmail: userEmail,
        groupName: group.name,
        token,
      },
    },
  });

  return res
    .status(201)
    .json(new ApiResponse(201, { invite }, "User invited successfully"));
});

const acceptOrDeclineGroupInvite = asyncHandler(async (req, res) => {
  const { token, action } = req.body;
  const userId = req.user.id;

  if (!token || !action) {
    throw new ApiError(400, "Token and action is required");
  }

  if (!["ACCEPT", "DECLINE"].includes(action.toUpperCase())) {
    throw new ApiError(400, "Invalid action type");
  }

  const invite = await prisma.groupInvite.findUnique({
    where: {
      token: token,
    },

    include: {
      group: {
        select: {
          id: true,
          name: true,
          createdBy: true,
        },
      },
    },
  });

  if (!invite) {
    throw new ApiError(404, "Invalid or expired invite token");
  }

  if (invite.status !== "PENDING") {
    throw new ApiError(
      400,
      `This invite has already been ${invite.status.toLowerCase()}`
    );
  }

  if (new Date() > invite.expiresAt) {
    await prisma.groupInvite.update({
      where: {
        token: token,
      },
      data: { status: "EXPIRED" },
    });

    throw new ApiError(410, "Invite link has expired");
  }
  if (action === "DECLINE") {
    await prisma.groupInvite.update({
      where: { token },
      data: { status: "DECLINED" },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Group invite declined"));
  }

  const existingMemmber = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId: invite.groupId,
      },
    },
  });

  if (existingMemmber) {
    await prisma.groupInvite.update({
      where: {
        token: token,
      },
      data: {
        status: "ACCEPTED",
      },
    });

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "You are already a member of the group"));
  }

  await prisma.groupMember.create({
    data: {
      userId,
      groupId: invite.groupId,
      isActive: true,
    },
  });

  await prisma.groupInvite.update({
    where: { token },
    data: { status: "ACCEPTED" },
  });

  await prisma.activity.create({
    data: {
      userId,
      groupId: invite.groupId,
      type: "GROUP_JOINED",
      action: `User joined the group via invite`,
      metadata: {
        inviteToken: token,
        joinedByEmail: req.user.email,
      },
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Group invite accepted successfully"));
});

const leaveGroup = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { groupId } = req.params;

  const group = await prisma.group.findUnique({
    where: { id: groupId },
  });

  if (!group) {
    throw new ApiError(404, "Group not found");
  }

  if (group.createdBy === userId) {
    throw new ApiError(
      400,
      "Group creator cannot leave the group. Transfer ownership first."
    );
  }

  const member = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!member || !member.isActive) {
    throw new ApiError(400, "User has already left the group");
  }

  await prisma.groupMember.update({
    where: {
      userId_groupId: {
        userId,
        groupId,
      },
    },
    data: {
      isActive: false,
    },
  });

  await prisma.activity.create({
    data: {
      userId,
      groupId,
      type: "MEMBER_LEFT",
      action: `User ${req.user.name} left the group`,
      metadata: {
        userEmail: req.user.email,
        userName: req.user.name,
      },
    },
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "User successfully left the group"));
});

const transferGroupOwnership = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { groupId } = req.params;
  const { newOwnerId, kickSelf } = req.body;

  if (!groupId || !newOwnerId) {
    throw new ApiError(400, "Group ID and New Owner ID are required");
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
  });

  if (!group) {
    throw new ApiError(404, "Group not found");
  }

  if (group.createdBy !== userId) {
    throw new ApiError(403, "Only the group creator can transfer ownership");
  }

  const newOwnerMember = await prisma.groupMember.findUnique({
    where: {
      userId_groupId: {
        userId: newOwnerId,
        groupId: groupId,
      },
    },
  });

  if (!newOwnerMember || !newOwnerMember.isActive) {
    throw new ApiError(400, "New owner must be an active group member");
  }

  const updatedGroup = await prisma.group.update({
    where: { id: groupId },
    data: { createdBy: newOwnerId },
  });

  if (kickSelf === true) {
    await prisma.groupMember.update({
      where: {
        userId_groupId: {
          userId,
          groupId,
        },
      },
      data: { isActive: false },
    });
  }

  await prisma.activity.create({
    data: {
      userId,
      groupId,
      type: "OWNERSHIP_TRANSFERRED",
      action: `Ownership transferred to userId ${newOwnerId}`,
      metadata: {
        oldOwnerId: userId,
        newOwnerId,
        removedOldOwner: !!kickSelf,
      },
    },
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { group: updatedGroup },
        `Ownership successfully transferred to userId ${newOwnerId}`
      )
    );
});

export {
  createGroup,
  addGroupMember,
  getAllGroups,
  getGroupById,
  updateGroupInfo,
  removeMemberFromGroup,
  deleteGroup,
  searchAndInviteUser,
  acceptOrDeclineGroupInvite,
  leaveGroup,
  transferGroupOwnership,
};
