/**
 * Helper to compute live balances for clients from invoice history.
 */

/**
 * Compute the live balance for a single client (Total Purchases - Total Payments)
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} clientId
 * @returns {Promise<number>}
 */
async function getClientBalance(prisma, clientId) {
  const cId = Number(clientId);
  if (isNaN(cId)) return 0;

  const [purchasesAgg, paymentsAgg] = await Promise.all([
    prisma.invoice.aggregate({
      where: { clientId: cId, type: 'purchase' },
      _sum: { amount: true }
    }),
    prisma.invoice.aggregate({
      where: { clientId: cId, type: 'payment' },
      _sum: { amount: true }
    })
  ]);

  const totalPurchases = purchasesAgg._sum.amount || 0;
  const totalPayments = paymentsAgg._sum.amount || 0;

  return totalPurchases - totalPayments;
}

/**
 * Compute live balances for all clients efficiently using groupBy
 * @param {import('@prisma/client').PrismaClient} prisma
 * @returns {Promise<Map<number, number>>} Map of clientId -> calculated balance
 */
async function getAllClientBalances(prisma) {
  const [purchaseGroups, paymentGroups] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['clientId'],
      where: { type: 'purchase' },
      _sum: { amount: true }
    }),
    prisma.invoice.groupBy({
      by: ['clientId'],
      where: { type: 'payment' },
      _sum: { amount: true }
    })
  ]);

  const balanceMap = new Map();

  for (const p of purchaseGroups) {
    const amount = p._sum.amount || 0;
    balanceMap.set(p.clientId, (balanceMap.get(p.clientId) || 0) + amount);
  }

  for (const p of paymentGroups) {
    const amount = p._sum.amount || 0;
    balanceMap.set(p.clientId, (balanceMap.get(p.clientId) || 0) - amount);
  }

  return balanceMap;
}

module.exports = {
  getClientBalance,
  getAllClientBalances
};
