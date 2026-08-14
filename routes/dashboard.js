const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware
router.use(requireAuth);

// GET /api/dashboard - Aggregated stats
router.get('/', async (req, res) => {
  try {
    // Total Clients
    const totalClients = await prisma.client.count();
    
    // Outstanding Balance (Sum of all positive balances)
    const balanceAgg = await prisma.client.aggregate({
      where: { balance: { gt: 0 } },
      _sum: { balance: true }
    });
    const outstandingBalance = balanceAgg._sum.balance || 0;
    
    // Late Clients (Balance > 10000 for this demo context)
    const lateClients = await prisma.client.count({
      where: { balance: { gt: 10000 } }
    });

    // Today's transactions
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    const todayTransactions = await prisma.invoice.count({
      where: {
        date: { gte: startOfDay, lte: endOfDay }
      }
    });

    // Top Debtors
    const topDebtors = await prisma.client.findMany({
      where: { balance: { gt: 0 } },
      orderBy: { balance: 'desc' },
      take: 5
    });

    // Recent Transactions
    const recentTransactions = await prisma.invoice.findMany({
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' }
      ],
      take: 5
    });

    // Chart Data (Last 6 weeks revenue vs payments)
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
    
    const recentInvoices = await prisma.invoice.findMany({
      where: { date: { gte: sixWeeksAgo } }
    });

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
