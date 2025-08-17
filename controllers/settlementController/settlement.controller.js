import { ApiError } from "../../utils/apiError.utils";
import { ApiResponse } from "../../utils/apiHandler.utils";
import prisma from "../../config/prismaClient";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { calculateOutstandingBalance, calculateUserBalances, getGroupBalances, optimizeSettlements } from "../../utils/settlement.utils";

const createSettlement = asyncHandler(async (req, res) => {
  const { paidToId, groupId, amount, note, method } = req.body;

  const paidById = req.user.id;

  if (amount <= 0) {
    throw new ApiError(400, "Amount should be greater than 0");
  }

  if (paidToId === paidById) {
    throw new ApiError(400, "User can't pay themselves");
  }

  const outstandingBalance = await calculateOutstandingBalance(
    paidById,
    paidToId,
    groupId
  );

  if (outstandingBalance <= 0) {
    throw new ApiError(400, "No outstanding balance to settle with this user.");
  }

  if (amount > outstandingBalance) {
    throw new ApiError(
      400,
      `You are trying to settle ₹${amount}, but your outstanding balance is only ₹${outstandingBalance}.`
    );
  }
  const checkGroup = await prisma.group.findUnique({
    where: {
      id: groupId,
    },
    include: { members: true },
  });

  const groupMemberIds = checkGroup.members.map((member) => member.id);

  if (!groupMemberIds.includes(paidById)) {
    throw new ApiError(400, "User is not in this group");
  }

  if (!groupMemberIds.includes(paidToId)) {
    throw new ApiError(400, "User is not in this group");
  }

  const settlement = await prisma.$transaction(async (tx) => {
    const newSettlement = await tx.settlement.create({
      data: {
        paidById,
        paidToId,
        groupId: groupId || null,
        amount,

        description: note,

        method: method || "CASH",
        status: "PENDING",
      },
    });

    await tx.activity.create({
      data: {
        groupId: groupId || null,
        userId: paidById,
        settlementId: newSettlement.id,
        type: "SETTLEMENT_MADE",
        action: `{req.user.name} paid ${amount} to ${paidToUser.name}`,
        metadata: {
          note,
          amount,
          method,
        },
      },
    });

    return newSettlement;
  });

  //notification ->TODO

  return res
    .status(201)
    .json(new ApiResponse(201, settlement, "Settlement created successfully"));
});

const getSettlementHistory = asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    throw new ApiError(401, "Unauthorized: User not found");
  }

  const { groupId, page = 1, limit = 10 } = req.query;

  const pageNumber = Math.max(1, parseInt(page) || 1);
const pageSize = Math.max(1, parseInt(limit) || 10);

  const skip = (pageNumber - 1) * pageSize;

  const filter = {
    OR: [{ paidById: userId }, { paidToId: userId }],
    ...(groupId && { groupId }),
  };

  const totalSettlements = await prisma.settlement.count({ where: filter });

  const settlements = await prisma.settlement.findMany({
    where: filter,
    orderBy: {
      createdAt: "desc",
    },
    skip,
    take: pageSize,
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      description: true,
      createdAt: true,
      group: {
        select: {
          id: true,
          name: true,
        },
      },
      paidBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      paidTo: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        settlements,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalSettlements / pageSize),
        totalItems: totalSettlements,
      },
      "Settlement history fetched successfully"
    )
  );
});

const getPendingSettlement = asyncHandler(async (req, res) => {
  const loggedInUser = req.user.id;
  const { groupId, page = 1, limit = 10 } = req.query;

  const pageNumber = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.max(1, parseInt(limit) || 10);
  const skip = (pageNumber - 1) * pageSize;

  const filter = {
    AND: [
      { status: "PENDING" },
      { OR: [{ paidById: loggedInUser }, { paidToId: loggedInUser }] },
      ...(groupId ? [{ groupId }] : []),
    ],
  };

  const [totalSettlements, settlements, totalPendingAmount] = await Promise.all(
    [
      prisma.settlement.count({ where: filter }),
      prisma.settlement.findMany({
        where: filter,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          amount: true,
          method: true,
          status: true,
          description: true,
          createdAt: true,
          group: { select: { id: true, name: true } },
          paidBy: { select: { id: true, name: true, email: true } },
          paidTo: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.settlement.aggregate({
        _sum: { amount: true },
        where: filter,
      }),
    ]
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        settlements,
        currentPage: pageNumber,
        totalPages: Math.ceil(totalSettlements / pageSize),
        totalItems: totalSettlements,
        totalPendingAmount: totalPendingAmount._sum.amount || 0,
      },
      "Pending settlements fetched successfully"
    )
  );
});

const markSettlementComplete = asyncHandler(async (req, res) => {
  const { settlementId } = req.body;
  const userId = req.user.id;

   
  const settlement = await prisma.settlement.findFirst({
    where: {
      id: settlementId,
      OR: [{ paidById: userId }, { paidToId: userId }],
    },
  });
   

  
  if (!settlement) {
    throw new ApiError(404, "Settlement not found or you are not a participant");
  }

  if (settlement.status === "COMPLETED" || settlement.status === "CANCELLED") {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          null,
          `Settlement already ${settlement.status.toLowerCase()}`
        )
      );
  }


  const result = await prisma.$transaction(async (tx) => {
   
    const updatedSettlement = await tx.settlement.update({
      where: { id: settlementId },
      data: {
        status: "COMPLETED",
        settledAt: new Date(),
      },
    });

   
    await tx.expenseSplit.updateMany({
      where: {
        groupId: settlement.groupId,
        paidById: settlement.paidById,
        paidToId: settlement.paidToId,
        isSettled: false,
      },
      data: {
        isSettled: true,
        settledAt: new Date(),
      },
    });

    return updatedSettlement;
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      result,
      "Settlement marked as completed and related expenses settled successfully"
    )
  );
});

const getBalanceSummary = asyncHandler(async(req,res)=> {
    const userId = req.user.id;
    
    const {groupId} = req.query;

    const balanceData = await calculateUserBalances(userId, groupId);

    const summary = {
      totalOwed: balanceData.totalOwed,
      totalOwing: balanceData.totalOwing,
      netBalance: balanceData.totalOwed - balanceData.totalOwing,
      relationships: balanceData.relationships,
      recentSettlements:balanceData.recentSettlements
    };


    return res.status(200).json(new ApiResponse(200,summary,"Balance summary fetched successfully"));


}) 


const getGroupSettlements = asyncHandler(async (req, res) => {
  const {
    groupId,
    status,
    method,
    startDate,
    endDate,
    page = 1,
    limit = 10
  } = req.query;

  const userId = req.user.id;
  const pageNumber = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.max(1, parseInt(limit, 10) || 10);
  const skip = (pageNumber - 1) * pageSize;

  if (!groupId) {
    throw new ApiError(400, "Group ID is required");
  }

  // Check if group exists AND user is a member in one go
  const groupMember = await prisma.groupMember.findFirst({
    where: { groupId, userId },
    include: { group: { select: { id: true, name: true } } }
  });

  if (!groupMember) {
    throw new ApiError(403, "You are not a member of this group or group not found");
  }

  // Build filter dynamically
  const filter = { groupId };
  if (status) filter.status = status;
  if (method) filter.method = method;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.gte = new Date(startDate);
    if (endDate) filter.createdAt.lte = new Date(endDate);
  }

  // Fetch count + settlements concurrently
  const [totalSettlements, settlements] = await Promise.all([
    prisma.settlement.count({ where: filter }),
    prisma.settlement.findMany({
      where: filter,
      skip,
      take: pageSize,
      orderBy: { settledAt: "desc" },
      include: {
        paidBy: { select: { id: true, name: true, email: true } },
        paidTo: { select: { id: true, name: true, email: true } },
        group: { select: { id: true, name: true } }
      }
    })
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        pagination: {
          total: totalSettlements,
          page: pageNumber,
          limit: pageSize,
          totalPages: Math.ceil(totalSettlements / pageSize)
        },
        data: settlements
      },
      "Group settlements fetched successfully"
    )
  );
});


const calculateOptimalSettlement = asyncHandler(async(req,res)=> {
   const {groupId} = req.query;
   const userId = req.user.id;


   const groupBalances = await getGroupBalances(groupId)

   const optimizedTransactions = optimizeSettlements(groupBalances)

   return res.status(200).json(new ApiResponse(200,{
    originalTransactions:groupBalances.length,
    optimizedTransactions:optimizedTransactions.length,
    savings:groupBalances.length - optimizedTransactions.length,
    transactions:optimizedTransactions
   },"Optimized settlement transactions fetched successfully"))
})