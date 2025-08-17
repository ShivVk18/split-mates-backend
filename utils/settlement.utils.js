import prisma from "../config/prismaClient"

const calculateOutstandingBalance = async(paidById,paidToId,groupId) => {
    const whereClause = {
        OR:[
            {paidById:paidById,splits:{
                some:{userId:paidToId}
            }},

            {
                paidById:paidToId,
                splits:{
                    some:{userId:paidById}
                }
            }
        ]
    }


    if(groupId){
        whereClause.groupId = groupId
    }

    const expenses = await prisma.expense.findMany({
        where:whereClause,
        include:{
            splits:{
                where:{
                    userId:{in:[paidById,paidToId]},
                    isSettled:false
                }
            }
        }
    })


    let user1Owes = 0
    let user2Owes =0

    expenses.forEach(expense =>{
        if(expense.paidById === paidById){
            const user2Split = expense.splits.find(s=>s.userId === paidToId)
            if(user2Split){
                user2Owes += user2Split.amount
            }
        }else if(expense.paidById === paidToId){
            const user1Split = expense.splits.find(s=>s.userId=== paidById)
            if(user1Split){
                user1Owes += user1Split.amount
            }
        }
    })

    return user2Owes - user1Owes
}  

const calculateUserBalances = async (userId, groupId = null) => {
  const whereClause = {
    OR: [
      { paidById: userId },
      { splits: { some: { userId } } }
    ]
  }

  if (groupId) {
    whereClause.groupId = groupId
  }

  const expenses = await prisma.expense.findMany({
    where: whereClause,
    include: {
      paidBy: { select: { id: true, name: true, email: true, avatar: true } },
      splits: {
        where: { isSettled: false },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true } }
        }
      }
    }
  })

  const balanceMap = new Map()
  let totalOwed = 0
  let totalOwing = 0

  expenses.forEach(expense => {
    if (expense.paidById === userId) {
      // User paid - calculate what others owe
      expense.splits.forEach(split => {
        if (split.userId !== userId) {
          const otherUserId = split.userId
          if (!balanceMap.has(otherUserId)) {
            balanceMap.set(otherUserId, {
              user: split.user,
              owedToMe: 0,
              iOwe: 0,
              netBalance: 0
            })
          }
          balanceMap.get(otherUserId).owedToMe += split.amount
          totalOwed += split.amount
        }
      })
    } else {
      // User owes money
      const userSplit = expense.splits.find(s => s.userId === userId)
      if (userSplit) {
        const payerId = expense.paidById
        if (!balanceMap.has(payerId)) {
          balanceMap.set(payerId, {
            user: expense.paidBy,
            owedToMe: 0,
            iOwe: 0,
            netBalance: 0
          })
        }
        balanceMap.get(payerId).iOwe += userSplit.amount
        totalOwing += userSplit.amount
      }
    }
  })

  // Calculate net balances
  const relationships = Array.from(balanceMap.values()).map(balance => ({
    ...balance,
    netBalance: balance.owedToMe - balance.iOwe
  }))

  // Get recent settlements
  const recentSettlements = await prisma.settlement.findMany({
    where: {
      OR: [
        { paidById: userId },
        { paidToId: userId }
      ]
    },
    include: {
      paidBy: { select: { name: true } },
      paidTo: { select: { name: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  })

  return {
    totalOwed,
    totalOwing,
    netBalance: totalOwed - totalOwing,
    relationships,
    recentSettlements
  }
}

const optimizeSettlements = (balances) => {
  // Convert balances to array with net amounts
  const creditors = [] // People who are owed money (positive balance)
  const debtors = []   // People who owe money (negative balance)

  balances.forEach(balance => {
    if (balance.netBalance > 0) {
      creditors.push({ ...balance, amount: balance.netBalance })
    } else if (balance.netBalance < 0) {
      debtors.push({ ...balance, amount: Math.abs(balance.netBalance) })
    }
  })

  const optimizedTransactions = []

  // Sort creditors and debtors by amount (descending)
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  let i = 0, j = 0

  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i]
    const debtor = debtors[j]

    const settleAmount = Math.min(creditor.amount, debtor.amount)

    optimizedTransactions.push({
      from: debtor.user,
      to: creditor.user,
      amount: settleAmount
    })

    creditor.amount -= settleAmount
    debtor.amount -= settleAmount

    if (creditor.amount === 0) i++
    if (debtor.amount === 0) j++
  }

  return optimizedTransactions
} 

const getGroupBalances = async (groupId) => {
  const groupMembers = await prisma.groupMember.findMany({
    where: { groupId, isActive: true },
    include: { user: { select: { id: true, name: true, email: true } } }
  })

  const memberBalances = []

  for (const member of groupMembers) {
    const balance = await calculateUserBalances(member.userId, groupId)
    memberBalances.push({
      user: member.user,
      netBalance: balance.netBalance
    })
  }

  return memberBalances.filter(b => b.netBalance !== 0)
}


const calculateSettlementSuggestions = async (userId) => {
  const balances = await calculateUserBalances(userId)
  
  const suggestions = balances.relationships
    .filter(rel => Math.abs(rel.netBalance) > 10) // Only suggest if amount > ₹10
    .map(rel => ({
      user: rel.user,
      amount: Math.abs(rel.netBalance),
      type: rel.netBalance > 0 ? 'COLLECT' : 'PAY',
      priority: calculatePriority(rel.netBalance, rel.user.id),
      suggestedMethod: suggestPaymentMethod(Math.abs(rel.netBalance))
    }))
    .sort((a, b) => b.priority - a.priority)

  return suggestions
}

const calculatePriority = (amount, userId) => {
  
  return Math.abs(amount) * 0.1
}

const suggestPaymentMethod = (amount) => {
  if (amount < 100) return 'CASH'
  if (amount < 1000) return 'UPI'
  return 'BANK_TRANSFER'
}

export {calculateOutstandingBalance, calculateUserBalances, optimizeSettlements, getGroupBalances, calculateSettlementSuggestions}