import { ApiError } from "../../utils/apiError.utils.js";
import { asyncHandler } from "../../utils/asyncHandler.utils.js";
import { ApiResponse } from "../../utils/apiHandler.utils.js";
import prisma from "../../config/prismaClient.js";
import { getFinalSplits } from "../../utils/splitHelper.utils.js";

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
    tagIds = [],
  } = req.body;

  if (!paidById || !description || !amount || !splits) {
    throw new ApiError(
      400,
      "Required fields: paidById, description, amount, splits"
    );
  }

  if (amount <= 0) {
    throw new ApiError(400, "Amount should be greater than 0");
  }

  if (!["EQUAL", "PERCENTAGE", "EXACT", "SHARES"].includes(splitType)) {
    throw new ApiError(400, "Invalid split type");
  }

  const paidByUser = await prisma.user.findUnique({
    where: { id: paidById },
    select: { id: true, name: true, email: true, isActive: true },
  });

  if (!paidByUser || !paidByUser.isActive) {
    throw new ApiError(404, "Payer user not found or inactive");
  }

  let group = null;
  if (groupId) {
    group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { isActive: true },
          select: { userId: true },
        },
      },
    });

    if (!group || !group.isActive) {
      throw new ApiError(404, "Group not found or inactive");
    }

    const groupMemberIds = group.members.map((member) => member.userId);

    if (!groupMemberIds.includes(paidById)) {
      throw new ApiError(403, "Payer must be a member of the group");
    }

    for (const split of splits) {
      if (!groupMemberIds.includes(split.userId)) {
        throw new ApiError(
          403,
          `User ${split.userId} is not a member of the group`
        );
      }
    }
  }

  if (tagIds.length > 0) {
    const existingTags = await prisma.tag.findMany({
      where: { id: { in: tagIds } },
      select: { id: true },
    });

    if (existingTags.length !== tagIds.length) {
      throw new ApiError(400, "One or more tags not found");
    }
  }

  const finalSplits = getFinalSplits(splitType, amount, splits);

  
  const expense = await prisma.$transaction(async (tx) => {
    
    const newExpense = await tx.expense.create({
      data: {
        groupId: groupId || null,
        paidById: paidById,
        description: description,
        amount: amount,
        currency: currency || "USD",
        splitType: splitType,
        date: date ? new Date(date) : new Date(),
        isSettled: isSettled || false,
        notes: notes || null,
      },
    });

    
    await tx.split.createMany({
      data: finalSplits.map((split) => ({
        expenseId: newExpense.id,
        userId: split.userId,
        amount: split.amount,
        percentage: split.percentage || null,
      })),
    });

   
    if (tagIds.length > 0) {
      await tx.expenseTag.createMany({
        data: tagIds.map((tagId) => ({
          expenseId: newExpense.id,
          tagId: tagId,
        })),
      });
    }

    // Create activity log
    await tx.activity.create({
      data: {
        userId: paidById,
        groupId: groupId || null,
        expenseId: newExpense.id,
        type: "EXPENSE_CREATED",
        action: `${paidByUser.name} added expense "${description}" for ${currency || "USD"}${amount}`,
        metadata: {
          expenseAmount: amount,
          splitType: splitType,
          participantCount: splits.length,
          currency: currency || "USD",
          tagCount: tagIds.length,
        },
      },
    });

    return newExpense;
  });

 
  const completeExpense = await prisma.expense.findUnique({
    where: { id: expense.id },
    include: {
      paidBy: {
        select: { id: true, name: true, email: true },
      },
      splits: {
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      group: {
        select: { id: true, name: true },
      },
    },
  });

  res
    .status(201)
    .json(
      new ApiResponse(201, completeExpense, "Expense created successfully")
    );
});

const updateExpense = asyncHandler(async (req, res) => {
  const { expenseId } = req.params;
  const {
    description,
    amount,
    currency,
    splitType,
    date,
    isSettled,
    notes,
    splits,
    tagIds = [],
  } = req.body;

  const userId = req.user.id;

  const existingExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      group: {
        include: {
          members: {
            where: { isActive: true },
            select: { userId: true },
          },
        },
      },
      paidBy: {
        select: { id: true, name: true },
      },
      tags: {
        include: { tag: true },
      },
    },
  });

  if (!existingExpense) {
    throw new ApiError(404, "Expense not found");
  }

  const canUpdate =
    existingExpense.paidById === userId ||
    (existingExpense.group && existingExpense.group.createdBy === userId);

  if (!canUpdate) {
    throw new ApiError(403, "You don't have permission to update this expense");
  }

  if (amount && amount <= 0) {
    throw new ApiError(400, "Amount must be greater than 0");
  }

  if (
    splitType &&
    !["EQUAL", "EXACT", "PERCENTAGE", "SHARES"].includes(splitType)
  ) {
    throw new ApiError(400, "Invalid split type");
  }

  if (splits && existingExpense.group) {
    const groupMemberIds = existingExpense.group.members.map((m) => m.userId);
    for (const split of splits) {
      if (!groupMemberIds.includes(split.userId)) {
        throw new ApiError(403, "One or more split users are not in the group");
      }
    }
  }

  if (tagIds.length > 0) {
    const existingTags = await prisma.tag.findMany({
      where: { id: { in: tagIds } },
      select: { id: true },
    });

    if (existingTags.length !== tagIds.length) {
      throw new ApiError(400, "One or more tags not found");
    }
  }

  let finalSplits = null;
  if (splits) {
    finalSplits = getFinalSplits(
      splitType || existingExpense.splitType,
      amount || existingExpense.amount,
      splits
    );
  }

  const updatedExpense = await prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({
      where: { id: expenseId },
      data: {
        description: description || existingExpense.description,
        amount: amount || existingExpense.amount,
        currency: currency || existingExpense.currency,
        splitType: splitType || existingExpense.splitType,
        date: date ? new Date(date) : existingExpense.date,
        isSettled:
          isSettled !== undefined ? isSettled : existingExpense.isSettled,
        notes: notes !== undefined ? notes : existingExpense.notes,
      },
    });

    if (finalSplits) {
      await tx.split.deleteMany({
        where: { expenseId },
      });

      await tx.split.createMany({
        data: finalSplits.map((split) => ({
          expenseId: expenseId,
          userId: split.userId,
          amount: split.amount,
          percentage: split.percentage || null,
        })),
      });
    }

    if (tagIds.length >= 0) {
      await tx.expenseTag.deleteMany({
        where: { expenseId },
      });

      if (tagIds.length > 0) {
        await tx.expenseTag.createMany({
          data: tagIds.map((tagId) => ({
            expenseId: expenseId,
            tagId: tagId,
          })),
        });
      }
    }

    await tx.activity.create({
      data: {
        userId: userId,
        groupId: existingExpense.groupId,
        expenseId: expenseId,
        type: "EXPENSE_UPDATED",
        action: `${req.user.name} updated expense "${description || existingExpense.description}"`,
        metadata: {
          updatedFields: {
            description: description !== undefined,
            amount: amount !== undefined,
            currency: currency !== undefined,
            splitType: splitType !== undefined,
            splits: splits !== undefined,
            tags: tagIds.length >= 0,
          },
          newAmount: amount || existingExpense.amount,
          oldAmount: existingExpense.amount,
        },
      },
    });

    return updated;
  });

  const completeExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      paidBy: {
        select: { id: true, name: true, email: true },
      },
      splits: {
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      group: {
        select: { id: true, name: true },
      },
    },
  });

  res
    .status(200)
    .json(
      new ApiResponse(200, completeExpense, "Expense updated successfully")
    );
});

const deleteExpense = asyncHandler(async (req, res) => {
  const { expenseId } = req.params;
  const userId = req.user.id;

  const existingExpense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      group: {
        select: { createdBy: true },
      },
      paidBy: {
        select: { name: true },
      },
    },
  });

  if (!existingExpense) {
    throw new ApiError(404, "Expense not found");
  }

  const canDelete =
    existingExpense.paidById === userId ||
    (existingExpense.group && existingExpense.group.createdBy === userId);

  if (!canDelete) {
    throw new ApiError(403, "You don't have permission to delete this expense");
  }

  await prisma.$transaction(async (tx) => {
    await tx.expenseTag.deleteMany({
      where: { expenseId },
    });

    await tx.split.deleteMany({
      where: { expenseId },
    });

    await tx.receipt.deleteMany({
      where: { expenseId },
    });

    await tx.expense.delete({
      where: { id: expenseId },
    });

    await tx.activity.create({
      data: {
        userId: userId,
        groupId: existingExpense.groupId,
        expenseId: expenseId,
        type: "EXPENSE_DELETED",
        action: `${req.user.name} deleted expense "${existingExpense.description}"`,
        metadata: {
          deletedExpense: {
            description: existingExpense.description,
            amount: existingExpense.amount,
            currency: existingExpense.currency,
            paidBy: existingExpense.paidBy.name,
          },
        },
      },
    });
  });

  res
    .status(200)
    .json(new ApiResponse(200, null, "Expense deleted successfully"));
});

const getExpenseById = asyncHandler(async (req, res) => {
  const { expenseId } = req.params;
  const userId = req.user.id;

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      paidBy: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      splits: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
      tags: {
        include: {
          tag: true,
        },
      },
      group: {
        select: {
          id: true,
          name: true,
          members: {
            where: { isActive: true },
            select: { userId: true },
          },
        },
      },
      receipts: {
        select: {
          id: true,
          fileName: true,
          fileUrl: true,
          fileSize: true,
          mimeType: true,
          uploadedAt: true,
        },
      },
    },
  });

  if (!expense) {
    throw new ApiError(404, "Expense not found");
  }

  const hasAccess =
    expense.splits.some((split) => split.userId === userId) ||
    expense.paidById === userId ||
    (expense.group &&
      expense.group.members.some((member) => member.userId === userId));

  if (!hasAccess) {
    throw new ApiError(403, "You don't have access to this expense");
  }

  res
    .status(200)
    .json(new ApiResponse(200, expense, "Expense fetched successfully"));
});

const getAllExpenses = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    groupId,
    page = 1,
    limit = 10,
    sortBy = "createdAt",
    sortOrder = "desc",
    startDate,
    endDate,
    minAmount,
    maxAmount,
    splitType,
    isSettled,
    tagIds,
  } = req.query;

  const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit);

  let whereClause = {};

  if (groupId) {
    whereClause = {
      groupId,
      group: {
        members: {
          some: {
            userId: userId,
            isActive: true,
          },
        },
      },
    };
  } else {
    whereClause = {
      OR: [{ paidById: userId }, { splits: { some: { userId } } }],
    };
  }

  if (startDate || endDate) {
    whereClause.date = {};
    if (startDate) whereClause.date.gte = new Date(startDate);
    if (endDate) whereClause.date.lte = new Date(endDate);
  }

  if (minAmount || maxAmount) {
    whereClause.amount = {};
    if (minAmount) whereClause.amount.gte = Number.parseFloat(minAmount);
    if (maxAmount) whereClause.amount.lte = Number.parseFloat(maxAmount);
  }

  if (splitType) {
    whereClause.splitType = splitType;
  }

  if (isSettled !== undefined) {
    whereClause.isSettled = isSettled === "true";
  }

  if (tagIds) {
    const tagIdArray = Array.isArray(tagIds) ? tagIds : [tagIds];
    whereClause.tags = {
      some: {
        tagId: { in: tagIdArray },
      },
    };
  }

  const [total, expenses] = await prisma.$transaction([
    prisma.expense.count({ where: whereClause }),
    prisma.expense.findMany({
      where: whereClause,
      include: {
        paidBy: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        tags: {
          include: {
            tag: true,
          },
        },
        group: {
          select: { id: true, name: true },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: Number.parseInt(limit),
    }),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        expenses,
        pagination: {
          total,
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          pages: Math.ceil(total / Number.parseInt(limit)),
        },
      },
      "Expenses fetched successfully"
    )
  );
});

const addTagToExpense = asyncHandler(async (req, res) => {
  const { expenseId } = req.params;
  const { tagId } = req.body;
  const userId = req.user.id;

  if (!tagId) {
    throw new ApiError(400, "Tag ID is required");
  }

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      group: {
        select: {
          createdBy: true,
          members: {
            where: { isActive: true },
            select: { userId: true },
          },
        },
      },
    },
  });

  if (!expense) {
    throw new ApiError(404, "Expense not found");
  }

  const hasAccess =
    expense.paidById === userId ||
    (expense.group &&
      (expense.group.createdBy === userId ||
        expense.group.members.some((member) => member.userId === userId)));

  if (!hasAccess) {
    throw new ApiError(403, "You don't have permission to modify this expense");
  }

  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
  });

  if (!tag) {
    throw new ApiError(404, "Tag not found");
  }

  const existingTag = await prisma.expenseTag.findUnique({
    where: {
      expenseId_tagId: {
        expenseId,
        tagId,
      },
    },
  });

  if (existingTag) {
    throw new ApiError(400, "Tag already added to this expense");
  }

  await prisma.expenseTag.create({
    data: {
      expenseId,
      tagId,
    },
  });

  await prisma.activity.create({
    data: {
      userId: userId,
      groupId: expense.groupId,
      expenseId: expenseId,
      type: "EXPENSE_UPDATED",
      action: `${req.user.name} added tag "${tag.name}" to expense "${expense.description}"`,
      metadata: {
        action: "tag_added",
        tagName: tag.name,
        tagId: tagId,
      },
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, { tag }, "Tag added to expense successfully"));
});

const removeTagFromExpense = asyncHandler(async (req, res) => {
  const { expenseId, tagId } = req.params;
  const userId = req.user.id;

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      group: {
        select: {
          createdBy: true,
          members: {
            where: { isActive: true },
            select: { userId: true },
          },
        },
      },
    },
  });

  if (!expense) {
    throw new ApiError(404, "Expense not found");
  }

  const hasAccess =
    expense.paidById === userId ||
    (expense.group &&
      (expense.group.createdBy === userId ||
        expense.group.members.some((member) => member.userId === userId)));

  if (!hasAccess) {
    throw new ApiError(403, "You don't have permission to modify this expense");
  }

  const expenseTag = await prisma.expenseTag.findUnique({
    where: {
      expenseId_tagId: {
        expenseId,
        tagId,
      },
    },
    include: {
      tag: true,
    },
  });

  if (!expenseTag) {
    throw new ApiError(404, "Tag not found on this expense");
  }

  await prisma.expenseTag.delete({
    where: {
      expenseId_tagId: {
        expenseId,
        tagId,
      },
    },
  });

  await prisma.activity.create({
    data: {
      userId: userId,
      groupId: expense.groupId,
      expenseId: expenseId,
      type: "EXPENSE_UPDATED",
      action: `${req.user.name} removed tag "${expenseTag.tag.name}" from expense "${expense.description}"`,
      metadata: {
        action: "tag_removed",
        tagName: expenseTag.tag.name,
        tagId: tagId,
      },
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, null, "Tag removed from expense successfully"));
});

const getExpensesByTag = asyncHandler(async (req, res) => {
  const { tagId } = req.params;
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit);

  const tag = await prisma.tag.findUnique({
    where: { id: tagId },
  });

  if (!tag) {
    throw new ApiError(404, "Tag not found");
  }

  const [total, expenses] = await prisma.$transaction([
    prisma.expense.count({
      where: {
        tags: {
          some: { tagId },
        },
        OR: [
          { paidById: userId },
          { splits: { some: { userId } } },
          {
            group: {
              members: {
                some: {
                  userId: userId,
                  isActive: true,
                },
              },
            },
          },
        ],
      },
    }),
    prisma.expense.findMany({
      where: {
        tags: {
          some: { tagId },
        },
        OR: [
          { paidById: userId },
          { splits: { some: { userId } } },
          {
            group: {
              members: {
                some: {
                  userId: userId,
                  isActive: true,
                },
              },
            },
          },
        ],
      },
      include: {
        paidBy: {
          select: { id: true, name: true, email: true },
        },
        splits: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        group: {
          select: { id: true, name: true },
        },
        tags: {
          include: {
            tag: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: Number.parseInt(limit),
    }),
  ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        tag,
        expenses,
        pagination: {
          total,
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          pages: Math.ceil(total / Number.parseInt(limit)),
        },
      },
      "Expenses by tag fetched successfully"
    )
  );
});

const getExpenseStatistics = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { groupId, startDate, endDate } = req.query;

  const whereClause = {
    OR: [{ paidById: userId }, { splits: { some: { userId } } }],
  };

  if (groupId) {
    whereClause.groupId = groupId;
  }

  if (startDate || endDate) {
    whereClause.date = {};
    if (startDate) whereClause.date.gte = new Date(startDate);
    if (endDate) whereClause.date.lte = new Date(endDate);
  }

  const [
    totalExpenses,
    totalAmount,
    avgAmount,
    maxExpense,
    minExpense,
    settledCount,
    unsettledCount,
    expensesByType,
  ] = await prisma.$transaction([
    prisma.expense.count({ where: whereClause }),
    prisma.expense.aggregate({
      where: whereClause,
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: whereClause,
      _avg: { amount: true },
    }),
    prisma.expense.findFirst({
      where: whereClause,
      orderBy: { amount: "desc" },
      select: { id: true, description: true, amount: true, date: true },
    }),
    prisma.expense.findFirst({
      where: whereClause,
      orderBy: { amount: "asc" },
      select: { id: true, description: true, amount: true, date: true },
    }),
    prisma.expense.count({ where: { ...whereClause, isSettled: true } }),
    prisma.expense.count({ where: { ...whereClause, isSettled: false } }),
    prisma.expense.groupBy({
      by: ["splitType"],
      where: whereClause,
      _count: { splitType: true },
      _sum: { amount: true },
    }),
  ]);

  const statistics = {
    totalExpenses,
    totalAmount: totalAmount._sum.amount || 0,
    averageAmount: avgAmount._avg.amount || 0,
    highestExpense: maxExpense,
    lowestExpense: minExpense,
    settledExpenses: settledCount,
    unsettledExpenses: unsettledCount,
    expensesByType: expensesByType.map((item) => ({
      splitType: item.splitType,
      count: item._count.splitType,
      totalAmount: item._sum.amount,
    })),
  };

  res
    .status(200)
    .json(new ApiResponse(200, statistics, "Expense statistics fetched"));
});
const markExpenseAsSettled = asyncHandler(async (req, res) => {
  const { expenseId } = req.params;
  const { splitIds } = req.body; // Optional: specific splits to settle
  const userId = req.user.id;

  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      splits: true,
      group: { select: { createdBy: true } },
    },
  });

  if (!expense) {
    throw new ApiError(404, "Expense not found");
  }

  // Check permissions
  const canSettle =
    expense.paidById === userId ||
    (expense.group && expense.group.createdBy === userId);

  if (!canSettle) {
    throw new ApiError(403, "Permission denied to settle this expense");
  }

  await prisma.$transaction(async (tx) => {
    if (splitIds && splitIds.length > 0) {
      // Settle specific splits
      await tx.split.updateMany({
        where: {
          id: { in: splitIds },
          expenseId: expenseId,
        },
        data: { isSettled: true },
      });
    } else {
      // Settle all splits
      await tx.split.updateMany({
        where: { expenseId: expenseId },
        data: { isSettled: true },
      });
    }

    // Check if all splits are settled
    const remainingUnsettled = await tx.split.count({
      where: { expenseId: expenseId, isSettled: false },
    });

    if (remainingUnsettled === 0) {
      await tx.expense.update({
        where: { id: expenseId },
        data: { isSettled: true },
      });
    }

    // Activity log
    await tx.activity.create({
      data: {
        userId: userId,
        groupId: expense.groupId,
        expenseId: expenseId,
        type: "EXPENSE_UPDATED",
        action: `Marked expense "${expense.description}" as settled`,
        metadata: {
          settledSplits: splitIds || "all",
          settledBy: req.user.name,
        },
      },
    });
  });

  res.status(200).json(new ApiResponse(200, null, "Expense marked as settled"));
});

const exportExpensesToCSV = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { groupId, startDate, endDate } = req.query;

  const whereClause = {
    OR: [{ paidById: userId }, { splits: { some: { userId } } }],
  };

  if (groupId) whereClause.groupId = groupId;
  if (startDate || endDate) {
    whereClause.date = {};
    if (startDate) whereClause.date.gte = new Date(startDate);
    if (endDate) whereClause.date.lte = new Date(endDate);
  }

  const expenses = await prisma.expense.findMany({
    where: whereClause,
    include: {
      paidBy: { select: { name: true, email: true } },
      splits: { include: { user: { select: { name: true } } } },
      group: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
    orderBy: { date: "desc" },
  });

  const csvData = expenses.map((expense) => ({
    Date: expense.date.toISOString().split("T")[0],
    Description: expense.description,
    Amount: expense.amount,
    Currency: expense.currency,
    "Paid By": expense.paidBy.name,
    "Split Type": expense.splitType,
    Group: expense.group?.name || "Personal",
    Tags: expense.tags.map((t) => t.tag.name).join(", "),
    Participants: expense.splits.map((s) => s.user.name).join(", "),
    Settled: expense.isSettled ? "Yes" : "No",
    Notes: expense.notes || "",
  }));

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { csvData, totalRecords: csvData.length },
        "Expenses exported to CSV format"
      )
    );
});
export {
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseById,
  getAllExpenses,
  addTagToExpense,
  removeTagFromExpense,
  getExpensesByTag,
  getExpenseStatistics,
  markExpenseAsSettled,
  exportExpensesToCSV,
};
