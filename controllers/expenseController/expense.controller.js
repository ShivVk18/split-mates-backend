import { ApiError } from "../../utils/apiError.utils";
import { asyncHandler } from "../../utils/asyncHandler.utils";
import { ApiResponse } from "../../utils/apiHandler.utils";
import prisma from "../../config/prismaClient";
import { getFinalSplits } from "../../utils/splitHelper.utils";

const createExpense = asyncHandler(async (req, res) => {
  const {
    groupId,
    paidById,
    description,
    amount,
    currency,
    splitType,
    date,
    isSettled,
    notes,
    splits,
  } = req.body;

  const checkUser = await prisma.user.findUnique({
    where: {
      id: paidById,
    },
  });

  if (!checkUser) {
    throw new ApiError(404, "User not exist");
  }

  if (amount <= 0) {
    throw new ApiError(400, "Amount should be greater than 0");
  }

  const checkGroup = await prisma.group.findUnique({
    where: {
      id: groupId,
    },
    include: {
      members: true,
    },
  });

  if (!checkGroup) {
    throw new ApiError(404, "Group does not exist");
  }

  if (!checkGroup.isActive) {
    throw new ApiError(403, "Group is not active");
  }

  const groupMemberIds = checkGroup.members.map((member) => member.id);
  if (!groupMemberIds.includes(paidById)) {
    throw new ApiError(403, "Payer must be a member of the group");
  }

  if (!["EQUAL", "PERCENTAGE", "EXACT", "SHARES"].includes(splitType)) {
    throw new ApiError(400, "Invalid split types");
  }

  for (const split of splits) {
    if (!groupMemberIds.includes(split.userId)) {
      throw new ApiError(403, "One or more split users are not in the group");
    }
  }

  const finalSplits = getFinalSplits(splitType, amount, splits);

  const expense = await prisma.expense.create({
    data: {
      groupId: groupId,
      paidById: paidById,
      description: description,
      amount: amount,
      currency: currency,
      splitType: splitType,
      date: new Date(date),
      isSettled: isSettled || false,
      notes: notes,
      splits: {
        createMany: {
          data: finalSplits.map((s) => ({
            userId: s.userId,
            amount: s.amount,
          })),
        },
      },
    },
    include: {
      splits: true,
    },
  });  

  


  await prisma.activity.create({
    data:{
        type:"EXPENSE_CREATED",
        groupId:groupId || null,
        userId:paidById,
        expenseId:expense.id
    }
  }) 


  res.status(201).json(new ApiResponse(201,expense,"Expense created successfully"))
});
