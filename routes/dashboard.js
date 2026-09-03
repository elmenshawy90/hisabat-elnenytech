const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getAllClientBalances } = require('../lib/balance');

// Apply auth middleware
router.use(requireAuth);

// GET /api/dashboard/settings - Get settings
router.get('/settings', async (req, res) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'overdueThresholdDays' }
    });
    const overdueThresholdDays = setting && !isNaN(parseInt(setting.value)) ? parseInt(setting.value) : 7;
    res.json({ overdueThresholdDays });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب الإعدادات' });
  }
});

// PUT /api/dashboard/settings - Update settings
router.put('/settings', async (req, res) => {
  try {
    const days = parseInt(req.body.overdueThresholdDays);
    if (isNaN(days) || days < 1) {
      return res.status(400).json({ error: 'عدد الأيام يجب أن يكون رقمًا صحيحًا أكبر من أو يساوي 1' });
    }
    const updated = await prisma.setting.upsert({
      where: { key: 'overdueThresholdDays' },
      create: { key: 'overdueThresholdDays', value: String(days) },
      update: { value: String(days) }
    });
    res.json({
      overdueThresholdDays: parseInt(updated.value),
      message: 'تم تحديث عدد أيام التأخير بنجاح'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في تحديث الإعدادات' });
  }
});

// GET /api/dashboard - Aggregated stats
router.get('/', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);

    // Fetch setting for overdue threshold (default 7 days)
    const thresholdSetting = await prisma.setting.findUnique({
      where: { key: 'overdueThresholdDays' }
    });
    const overdueThresholdDays = thresholdSetting && !isNaN(parseInt(thresholdSetting.value)) 
      ? parseInt(thresholdSetting.value) 
      : 7;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - overdueThresholdDays);

    const [allClients, balanceMap, todayTransactions, recentTransactions, recentInvoices, maxInvoiceDates] = await Promise.all([
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
      }),
      prisma.invoice.groupBy({
        by: ['clientId'],
        _max: { date: true }
      })
    ]);

    const maxDateMap = new Map();
    for (const item of maxInvoiceDates) {
      if (item.clientId && item._max && item._max.date) {
        maxDateMap.set(item.clientId, item._max.date);
      }
    }

    const totalClients = allClients.length;

    let outstandingBalance = 0;
    const overdueClients = [];

    const clientsWithBalance = allClients.map(c => {
      const balance = balanceMap.get(c.id) || 0;
      const lastTxDate = maxDateMap.get(c.id) || c.createdAt;

      if (balance > 0) {
        outstandingBalance += balance;

        // If client has a positive balance (debt) and their latest transaction is older than cutoff date
        if (lastTxDate && new Date(lastTxDate) < cutoffDate) {
          const diffMs = Date.now() - new Date(lastTxDate).getTime();
          const daysInactive = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          overdueClients.push({
            ...c,
            _id: c.id,
            balance,
            lastTransactionDate: lastTxDate,
            daysInactive
          });
        }
      }

      return {
        ...c,
        balance,
        lastTransactionDate: lastTxDate
      };
    });

    // Sort overdue clients: longest inactive first
    overdueClients.sort((a, b) => new Date(a.lastTransactionDate) - new Date(b.lastTransactionDate));

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
      lateClients: overdueClients.length,
      overdueThresholdDays,
      overdueClients: overdueClients.map(c => ({
        ...c,
        _id: c.id,
        initials: c.name.split(' ').slice(0, 2).map(w => w[0]).join(' ')
      })),
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
