const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getAllClientBalances } = require('../lib/balance');

// Apply auth middleware
router.use(requireAuth);

// GET /api/dashboard - Aggregated stats
router.get('/', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);

    const [allClients, balanceMap, todayTransactions, recentTransactions, recentInvoices] = await Promise.all([
      prisma.client.findMany(),
      getAllClientBalances(prisma),
      prisma.invoice.count({
        where: {
          date: { gte: startOfDay, lte: endOfDay }
        }
      }),
      prisma.invoice.findMany({
        orderBy: [
          { date: 'desc' },
          { createdAt: 'desc' }
        ],
        take: 5
      }),
      prisma.invoice.findMany({
        where: {
          date: { gte: sixWeeksAgo }
        }
      })
    ]);

    const totalClients = allClients.length;

    let outstandingBalance = 0;
    let lateClients = 0;

    const clientsWithBalance = allClients.map(c => {
      const balance = balanceMap.get(c.id) || 0;
      if (balance > 0) {
        outstandingBalance += balance;
      }
      if (balance > 10000) {
        lateClients++;
      }
      return {
        ...c,
        balance
      };
    });

    const topDebtors = clientsWithBalance
      .filter(c => c.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5);

    // Aggregate in memory to avoid BigInt serialization issues with $queryRaw
    const groups = {};
    for (const inv of recentInvoices) {
      const d = inv.date;
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const week = Math.ceil(d.getDate() / 7);
      const key = `${year}-${month}-${week}-${inv.type}`;
      
      if (!groups[key]) {
        groups[key] = {
          _id: { year, month, week, type: inv.type },
          total: 0
        };
      }
      groups[key].total += inv.amount;
    }

    const chartData = Object.values(groups).sort((a, b) => {
      if (a._id.year !== b._id.year) return a._id.year - b._id.year;
      if (a._id.month !== b._id.month) return a._id.month - b._id.month;
      return a._id.week - b._id.week;
    });

    res.json({
      totalClients,
      outstandingBalance,
      lateClients,
      todayTransactions,
      topDebtors: topDebtors.map(c => ({
        ...c,
        _id: c.id,
        initials: c.name.split(' ').slice(0, 2).map(w => w[0]).join(' ')
      })),
      recentTransactions: recentTransactions.map(inv => ({ ...inv, _id: inv.id })),
      chartData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب بيانات لوحة القيادة' });
  }
});

module.exports = router;
