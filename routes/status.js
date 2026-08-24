const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getLatestDeployment } = require('../lib/vercel-status');
const { getDatabaseStatus } = require('../lib/db-status');

// GET /status - Render status page (Protected page)
router.get('/', async (req, res) => {
  // Page level auth check: redirect to /login if not authenticated
  if (!req.user) {
    return res.redirect('/login');
  }

  try {
    const [deployment, dbStatus] = await Promise.all([
      getLatestDeployment(),
      getDatabaseStatus(prisma)
    ]);

    res.render('status', {
      deployment,
      dbStatus,
      user: req.user
    });
  } catch (err) {
    console.error('[status] Error rendering status page:', err);
    res.render('status', {
      deployment: { error: 'تعذر جلب بيانات النشر', details: err.message },
      dbStatus: { connected: false, error: 'حدث خطأ في استعلام قاعدة البيانات' },
      user: req.user
    });
  }
});

// GET /status/data - API endpoint for fetching live status data (Protected API)
router.get('/data', requireAuth, async (req, res) => {
  try {
    const [deployment, dbStatus] = await Promise.all([
      getLatestDeployment(),
      getDatabaseStatus(prisma)
    ]);
    res.json({ deployment, dbStatus });
  } catch (err) {
    res.status(500).json({ error: 'فشل في جلب حالة النظام' });
  }
});

module.exports = router;
