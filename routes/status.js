const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getDatabaseStatus } = require('../lib/db-status');
const { getRolePermissions } = require('../lib/roles');
const backup = require('../lib/backup');

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

// Backup management requires settings permission (admin + editor).
// Viewers get read-only system status with no backup controls.
async function requireBackupAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'غير مصرح، يرجى تسجيل الدخول' });
  }
  try {
    const perms = await getRolePermissions(req.user.role);
    if (perms && perms.manageSettings) {
      req.permissions = perms;
      return next();
    }
    return res.status(403).json({ error: 'ممنوع، مطلوب صلاحيات إدارة الإعدادات' });
  } catch (err) {
    console.error('[status] requireBackupAccess error:', err);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
}

async function canManageBackups(role) {
  try {
    const perms = await getRolePermissions(role);
    return Boolean(perms && perms.manageSettings);
  } catch (err) {
    return false;
  }
}

function backupFilename(job) {
  const d = job && job.createdAt ? new Date(job.createdAt) : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `backup-${stamp}-id${(job && job.id) || '0'}.json`;
}

// GET /status - Render status page (Protected page)
router.get('/', async (req, res) => {
  // Page level auth check: redirect to /login if not authenticated
  if (!req.user) {
    return res.redirect('/login');
  }

  const activeTab = req.query.tab === 'backup' ? 'backup' : 'system';

  try {
    const dbStatus = await getDatabaseStatus(prisma);
    const deployments = getDeploymentLogs();
    const latestDeployment = deployments.length > 0 ? deployments[0] : null;
    const systemStatus = calculateSystemStatus(dbStatus, latestDeployment);
    const [backupJobs, backupSchedule] = await Promise.all([
      backup.getBackupJobs(prisma, 20).catch(() => []),
      backup.getSchedule(prisma)
    ]);
    const canManage = await canManageBackups(req.user.role);

    res.render('status', {
      systemStatus,
      dbStatus,
      deployments,
      latestDeployment,
      backupJobs,
      backupSchedule,
      canManageBackups: canManage,
      activeTab,
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
      backupJobs: [],
      backupSchedule: backup.DEFAULT_SCHEDULE,
      canManageBackups: false,
      activeTab,
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

// ─── Backup jobs sub-tab ─────────────────────────────────────────

// GET /status/backup - List backup jobs + current schedule (managers only)
router.get('/backup', requireAuth, requireBackupAccess, async (req, res) => {
  try {
    const [jobs, schedule] = await Promise.all([
      backup.getBackupJobs(prisma, 20),
      backup.getSchedule(prisma)
    ]);
    res.json({ jobs, schedule });
  } catch (err) {
    console.error('[status] Failed to list backups:', err.message);
    res.status(500).json({ error: 'فشل في جلب سجل النسخ الاحتياطي' });
  }
});

// POST /status/backup/run - Trigger a manual backup now (managers only)
router.post('/backup/run', requireAuth, requireBackupAccess, async (req, res) => {
  try {
    const by = req.user.username || req.user.displayName || `#${req.user.userId}`;
    const job = await backup.runBackup(prisma, { trigger: 'manual', createdBy: by });
    res.json({ job });
  } catch (err) {
    console.error('[status] Manual backup failed:', err.message);
    res.status(500).json({ error: err.message || 'فشل النسخ الاحتياطي', job: err.job || null });
  }
});

// PUT /status/backup/schedule - Save the backup schedule (managers only)
router.put('/backup/schedule', requireAuth, requireBackupAccess, async (req, res) => {
  try {
    const schedule = await backup.saveSchedule(prisma, req.body || {});
    res.json({ schedule });
  } catch (err) {
    res.status(400).json({ error: err.message || 'بيانات الجدولة غير صالحة' });
  }
});

// GET /status/backup/:id/download - Download a backup payload (managers only)
router.get('/backup/:id/download', requireAuth, requireBackupAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'معرف النسخة غير صالح' });
  }
  try {
    const job = await prisma.backupJob.findUnique({ where: { id } });
    if (!job || job.status !== 'success' || !job.payload) {
      return res.status(404).json({ error: 'النسخة غير متوفرة للتنزيل' });
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${backupFilename(job)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(job.payload);
  } catch (err) {
    console.error('[status] Backup download failed:', err.message);
    res.status(500).json({ error: 'فشل تنزيل النسخة الاحتياطية' });
  }
});

// DELETE /status/backup/:id - Delete a single backup record (managers only)
router.delete('/backup/:id', requireAuth, requireBackupAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'معرف النسخة غير صالح' });
  }
  try {
    await prisma.backupJob.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: 'النسخة غير موجودة' });
  }
});

// POST /status/backup/run-due - Scheduler entry point (Vercel Cron + in-process timer).
// Only ever runs when a schedule is actually due, so it is safe to expose.
// When CRON_SECRET is configured, external callers must present it.
router.post('/backup/run-due', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const presented = req.query.key || req.headers['x-cron-key'];
    if (presented !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'غير مصرح' });
    }
  }
  try {
    const job = await backup.checkAndRunDueBackup(prisma, new Date());
    res.json({ ran: Boolean(job), job });
  } catch (err) {
    console.error('[status] Scheduled backup failed:', err.message);
    res.status(500).json({ ran: false, error: err.message || 'فشل النسخ المجدول' });
  }
});

// Vercel Cron issues GET requests — accept it as an alias of the POST handler.
router.get('/backup/run-due', async (req, res) => {
  if (process.env.CRON_SECRET) {
    const presented = req.query.key || req.headers['x-cron-key'];
    if (presented !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'غير مصرح' });
    }
  }
  try {
    const job = await backup.checkAndRunDueBackup(prisma, new Date());
    res.json({ ran: Boolean(job), job });
  } catch (err) {
    console.error('[status] Scheduled backup failed:', err.message);
    res.status(500).json({ ran: false, error: err.message || 'فشل النسخ المجدول' });
  }
});

module.exports = router;
