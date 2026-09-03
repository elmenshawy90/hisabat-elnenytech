/**
 * Helper to compute live balances for clients from invoice history.
 * Supports all invoice types ('purchase', 'payment', 'opening_balance', 'adjustment')
 * based on balanceEffect ('increase' vs 'decrease').
 */

/**
 * Compute the live balance for a single client
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} clientId
 * @returns {Promise<number>}
 */
async function getClientBalance(prisma, clientId) {
  const cId = Number(clientId);
  if (isNaN(cId)) return 0;

  const [increaseAgg, decreaseAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: { clientId: cId, balanceEffect: 'increase' },
      _sum: { amount: true }
    }),
    prisma.invoice.aggregate({
      where: { clientId: cId, balanceEffect: 'decrease' },
      _sum: { amount: true }
    })
  ]);

  const totalIncrease = increaseAgg._sum.amount || 0;
  const totalDecrease = decreaseAgg._sum.amount || 0;

  return totalIncrease - totalDecrease;
}

/**
 * Compute live balances for all clients efficiently using groupBy
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<Map<number, number>>} Map of clientId -> calculated balance
 */
async function getAllClientBalances(prisma) {
  const [increaseGroups, decreaseGroups] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['clientId'],
      where: { balanceEffect: 'increase' },
      _sum: { amount: true }
    }),
    prisma.invoice.groupBy({
      by: ['clientId'],
      where: { balanceEffect: 'decrease' },
      _sum: { amount: true }
    })
  ]);

  const balanceMap = new Map();

  for (const p of increaseGroups) {
    const amount = p._sum.amount || 0;
    balanceMap.set(p.clientId, (balanceMap.get(p.clientId) || 0) + amount);
  }

  for (const p of decreaseGroups) {
    const amount = p._sum.amount || 0;
    balanceMap.set(p.clientId, (balanceMap.get(p.clientId) || 0) - amount);
  }

  return balanceMap;
}

module.exports = {
  getClientBalance,
  getAllClientBalances
};
