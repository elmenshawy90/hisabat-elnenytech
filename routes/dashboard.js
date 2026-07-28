const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware
router.use(requireAuth);

// GET /api/dashboard - Aggregated stats
router.get('/', async (req, res) => {
  try {
    // Total Clients
    const totalClients = await Client.countDocuments();
    
    // Outstanding Balance (Sum of all positive balances)
    const result = await Client.aggregate([
      { $match: { balance: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);
    const outstandingBalance = result.length > 0 ? result[0].total : 0;
    
    // Late Clients (Balance > 10000 for this demo context)
    const lateClients = await Client.countDocuments({ balance: { $gt: 10000 } });

    // Today's transactions
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    const todayTransactions = await Invoice.countDocuments({
      date: { $gte: startOfDay, $lte: endOfDay }
    });

    // Top Debtors
    const topDebtors = await Client.find({ balance: { $gt: 0 } })
      .sort({ balance: -1 })
      .limit(5);

    // Recent Transactions
    const recentTransactions = await Invoice.find()
      .sort({ date: -1, createdAt: -1 })
      .limit(5);

    // Chart Data (Last 6 weeks revenue vs payments)
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
    
    const chartData = await Invoice.aggregate([
      { $match: { date: { $gte: sixWeeksAgo } } },
      { 
        $group: {
          _id: { 
            year: { $year: "$date" }, 
            month: { $month: "$date" },
            week: { $ceil: { $divide: [ { $dayOfMonth: "$date" }, 7 ] } },
            type: "$type"
          },
          total: { $sum: "$amount" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.week": 1 } }
    ]);

    res.json({
      totalClients,
      outstandingBalance,
      lateClients,
      todayTransactions,
      topDebtors,
      recentTransactions,
      chartData
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب بيانات لوحة القيادة' });
  }
});

module.exports = router;
