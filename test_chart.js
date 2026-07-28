const mongoose = require('mongoose');
require('dotenv').config();
const Invoice = require('./models/Invoice');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const sixWeeksAgo = new Date();
    sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
    
    try {
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
        console.log("CHART DATA:", JSON.stringify(chartData, null, 2));
    } catch(err) {
        console.error("ERROR:", err);
    }
    process.exit(0);
});
