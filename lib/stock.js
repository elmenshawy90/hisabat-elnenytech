/**
 * Stock helper functions for checking stock availability and deducting stock on sales.
 */

/**
 * Check stock availability for an item in its base unit.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {number} itemId
 * @param {number} requestedQuantityBase
 * @returns {Promise<{ available: number, sufficient: boolean }>}
 */
async function checkStockAvailability(prisma, itemId, requestedQuantityBase) {
  const iId = Number(itemId);
  if (isNaN(iId)) {
    return { available: 0, sufficient: false };
  }

  const latestLog = await prisma.stockLog.findFirst({
    where: { itemId: iId },
    orderBy: [
      { id: 'desc' }
    ]
  });

  const available = latestLog ? (Number(latestLog.balanceAfter) || 0) : 0;
  const reqQty = Number(requestedQuantityBase) || 0;
  const sufficient = available >= reqQty;

  return {
    available,
    sufficient
  };
}

/**
 * Deduct stock for an item in base unit and record a 'sale' StockLog.
 * Allows negative balances if requested quantity exceeds current stock.
 * @param {import('@prisma/client').PrismaClient} dbClient
 * @param {number} itemId
 * @param {number} quantityBase - Positive number representing base quantity sold
 * @param {number|null} [invoiceId=null]
 * @param {string} [notes=""]
 * @returns {Promise<import('@prisma/client').StockLog>}
 */
async function deductStock(dbClient, itemId, quantityBase, invoiceId = null, notes = '') {
  const iId = Number(itemId);
  if (isNaN(iId)) {
    throw new Error('معرف الصنف غير صالح');
  }

  const qtyToDeduct = Math.abs(Number(quantityBase) || 0);

  const executeDeduct = async (tx) => {
    const latestLog = await tx.stockLog.findFirst({
      where: { itemId: iId },
      orderBy: [
        { id: 'desc' }
      ]
    });

    const currentBalance = latestLog ? (Number(latestLog.balanceAfter) || 0) : 0;
    const balanceAfter = currentBalance - qtyToDeduct;

    const newLog = await tx.stockLog.create({
      data: {
        itemId: iId,
        changeType: 'sale',
        quantityBase: -qtyToDeduct,
        balanceAfter,
        invoiceId: invoiceId ? Number(invoiceId) : null,
        notes: notes || ''
      }
    });

    return newLog;
  };

  if (typeof dbClient.$transaction === 'function') {
    return await dbClient.$transaction(executeDeduct);
  } else {
    return await executeDeduct(dbClient);
  }
}

module.exports = {
  checkStockAvailability,
  deductStock
};
