const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getDatabaseStatus } = require('../lib/db-status');

const logFilePath = path.join(__dirname, '..', 'deployment-log.json');

/**
 * Reads all deployment records from deployment-log.json
 * @returns {Array} List of deployment records sorted newest first
 */
function getDeploymentLogs() {
  if (fs.existsSync(logFilePath)) {
    try {
      const data = fs.readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed.slice().reverse();
      }
    } catch (e) {
      console.error('[status] Error reading deployment-log.json:', e.message);
    }
  }
  return [];
}

/**
 * Calculates overall system health
 * @param {Object} dbStatus Database status object
 * @param {Object|null} latestDeployment Latest deployment record
 * @returns {Object} { healthy: boolean, text: string, badgeText: string }
 */
function calculateSystemStatus(dbStatus, latestDeployment) {
  const isDbHealthy = Boolean(dbStatus && dbStatus.connected);
  const isDeployHealthy = !latestDeployment || latestDeployment.status === 'success';

  if (isDbHealthy && isDeployHealthy) {
    return {
      healthy: true,
      text: 'النظام يعمل بشكل طبيعي',
      badgeText: 'فعّال'
    };
  }

  return {
    healthy: false,
    text: 'يوجد مشكلة حالياً',
    badgeText: 'في مشكلة'
  };
}

// GET /status - Render status page (Protected page)
router.get('/', async (req, res) => {
  // Page level auth check: redirect to /login if not authenticated
  if (!req.user) {
    return res.redirect('/login');
  }

  try {
    const dbStatus = await getDatabaseStatus(prisma);
    const deployments = getDeploymentLogs();
    const latestDeployment = deployments.length > 0 ? deployments[0] : null;
    const systemStatus = calculateSystemStatus(dbStatus, latestDeployment);

    res.render('status', {
      systemStatus,
      dbStatus,
      deployments,
      latestDeployment,
      user: req.user
    });
  } catch (err) {
    console.error('[status] Error rendering status page:', err);
    const deployments = getDeploymentLogs();
    const latestDeployment = deployments.length > 0 ? deployments[0] : null;
    const dbStatus = { connected: false, latencyMs: 0, error: err.message || 'خطأ غير متوقع' };
    const systemStatus = { healthy: false, text: 'يوجد مشكلة حالياً', badgeText: 'في مشكلة' };

    res.render('status', {
      systemStatus,
      dbStatus,
      deployments,
      latestDeployment,
      user: req.user
    });
  }
});

// GET /status/data - API endpoint for fetching live status data (Protected API)
router.get('/data', requireAuth, async (req, res) => {
  try {
    const dbStatus = await getDatabaseStatus(prisma);
    const deployments = getDeploymentLogs();
    const latestDeployment = deployments.length > 0 ? deployments[0] : null;
    const systemStatus = calculateSystemStatus(dbStatus, latestDeployment);

    res.json({
      systemStatus,
      dbStatus,
      deployments,
      latestDeployment
    });
  } catch (err) {
    res.status(500).json({ error: 'فشل في جلب حالة النظام' });
  }
});

module.exports = router;
