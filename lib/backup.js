/**
 * Database backup engine: logical JSON dump of all business tables,
 * stored as BackupJob rows (payload kept in the DB so downloads survive
 * ephemeral serverless disks), plus a persisted schedule in Setting.
 *
 * Times are evaluated against the Africa/Cairo wall clock.
 */

const SCHEDULE_KEY = 'backup.schedule';
const CAIRO_TZ = 'Africa/Cairo';

// Prisma delegates dumped into every backup (Session rows are transient → excluded).
const BACKUP_TABLES = [
  'user',
  'client',
  'endClient',
  'invoice',
  'invoiceItem',
  'invoiceService',
  'item',
  'itemUnit',
  'unit',
  'stockLog',
  'supplier',
  'supplierTransaction',
  'counter',
  'role',
  'setting'
];

const DEFAULT_SCHEDULE = {
  enabled: false,
  frequency: 'daily', // 'daily' | 'weekly'
  time: '03:00', // HH:MM (24h, Cairo time)
  weekday: 5, // 0=Sun … 6=Sat, used when frequency === 'weekly' (5 = Friday)
  retention: 14, // how many successful backups to keep
  lastRunAt: null
};

const MAX_RETENTION = 90;
const FAILED_KEEP = 20;

function cairoParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  let hour = Number(get('hour'));
  // en-CA with hour12:false can yield "24" at midnight in some ICU versions.
  if (hour === 24) hour = 0;
  const minute = Number(get('minute'));
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { dateStr, minutes: hour * 60 + minute, weekday };
}

function daysBetweenDateStr(a, b) {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

function parseTimeToMinutes(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Validates and sanitizes a schedule payload. Throws on invalid input.
 */
function validateSchedule(input) {
  const source = input && typeof input === 'object' ? input : {};
  const time = String(source.time || DEFAULT_SCHEDULE.time).trim();
  if (parseTimeToMinutes(time) === null) {
    throw new Error('وقت الجدولة غير صالح (استخدم صيغة HH:MM)');
  }
  const frequency = source.frequency === 'weekly' ? 'weekly' : 'daily';
  const rawWeekday = source.weekday === undefined ? DEFAULT_SCHEDULE.weekday : Number(source.weekday);
  if (frequency === 'weekly' && (!Number.isInteger(rawWeekday) || rawWeekday < 0 || rawWeekday > 6)) {
    throw new Error('اليوم الأسبوعي غير صالح');
  }
  const rawRetention = source.retention === undefined ? DEFAULT_SCHEDULE.retention : Number(source.retention);
  if (!Number.isInteger(rawRetention) || rawRetention < 1 || rawRetention > MAX_RETENTION) {
    throw new Error(`عدد النسخ المحتفظ بها يجب أن يكون بين 1 و ${MAX_RETENTION}`);
  }
  return {
    enabled: Boolean(source.enabled),
    frequency,
    time,
    weekday: frequency === 'weekly' ? rawWeekday : DEFAULT_SCHEDULE.weekday,
    retention: rawRetention
  };
}

/**
 * Pure due-check: is a backup due at `now` given the stored schedule?
 */
function isBackupDue(schedule, now = new Date()) {
  if (!schedule || !schedule.enabled) return false;
  const scheduledMinutes = parseTimeToMinutes(schedule.time);
  if (scheduledMinutes === null) return false;

  const current = cairoParts(now);
  if (current.minutes < scheduledMinutes) return false;
  if (!schedule.lastRunAt) return true;

  const last = cairoParts(new Date(schedule.lastRunAt));
  if (schedule.frequency === 'weekly') {
    if (last.dateStr >= current.dateStr) return false;
    // Normal case: run on the configured weekday.
    if (current.weekday === Number(schedule.weekday)) return true;
    // Catch-up: the weekday was missed (server was down) — run once overdue by a week.
    return daysBetweenDateStr(last.dateStr, current.dateStr) >= 7;
  }
  return last.dateStr < current.dateStr;
}

async function getSchedule(prisma) {
  try {
    const row = await prisma.setting.findUnique({ where: { key: SCHEDULE_KEY } });
    if (!row) return { ...DEFAULT_SCHEDULE };
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_SCHEDULE, ...parsed };
  } catch (err) {
    console.error('[backup] Failed to read schedule, using defaults:', err.message);
    return { ...DEFAULT_SCHEDULE };
  }
}

async function saveSchedule(prisma, input) {
  const clean = validateSchedule(input);
  const previous = await getSchedule(prisma);
  const next = { ...clean, lastRunAt: previous.lastRunAt || null };
  await prisma.setting.upsert({
    where: { key: SCHEDULE_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: SCHEDULE_KEY, value: JSON.stringify(next) }
  });
  return next;
}

async function touchLastRun(prisma, when = new Date()) {
  const current = await getSchedule(prisma);
  current.lastRunAt = when.toISOString();
  await prisma.setting.upsert({
    where: { key: SCHEDULE_KEY },
    update: { value: JSON.stringify(current) },
    create: { key: SCHEDULE_KEY, value: JSON.stringify(current) }
  });
  return current;
}

/**
 * Reads every business table. Returns { version, createdAt, tables }.
 */
async function collectBackupData(prisma) {
  const tables = {};
  for (const name of BACKUP_TABLES) {
    const delegate = prisma[name];
    if (!delegate || typeof delegate.findMany !== 'function') {
      throw new Error(`جدول النسخ غير متوفر: ${name}`);
    }
    tables[name] = await delegate.findMany();
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    tables
  };
}

function summarizeBackup(data) {
  const tableCounts = {};
  let recordCount = 0;
  for (const [name, rows] of Object.entries(data.tables || {})) {
    const count = Array.isArray(rows) ? rows.length : 0;
    tableCounts[name] = count;
    recordCount += count;
  }
  return { tableCounts, recordCount };
}

function sanitizeError(err) {
  let message = (err && err.message) || 'فشل غير معروف أثناء النسخ الاحتياطي';
  message = message
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_CONNECTION_STRING]')
    .replace(/(password|passwd|pwd)=([^\s&"']+)/gi, '$1=[REDACTED]');
  if (message.length > 500) message = message.substring(0, 500) + '...';
  return message;
}

function toJobSummary(job) {
  if (!job) return null;
  const { payload, ...rest } = job;
  return rest;
}

async function pruneOldBackups(prisma, retention) {
  const keep = Math.min(Math.max(Number(retention) || DEFAULT_SCHEDULE.retention, 1), MAX_RETENTION);
  const successes = await prisma.backupJob.findMany({
    where: { status: 'success' },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  const overflow = successes.slice(keep);
  if (overflow.length > 0) {
    await prisma.backupJob.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
  }
  const failures = await prisma.backupJob.findMany({
    where: { status: 'failed' },
    orderBy: { createdAt: 'desc' },
    select: { id: true }
  });
  const failedOverflow = failures.slice(FAILED_KEEP);
  if (failedOverflow.length > 0) {
    await prisma.backupJob.deleteMany({ where: { id: { in: failedOverflow.map((r) => r.id) } } });
  }
}

/**
 * Runs a full backup now and records it as a BackupJob.
 */
async function runBackup(prisma, { trigger = 'manual', createdBy = '' } = {}) {
  const job = await prisma.backupJob.create({
    data: { status: 'running', trigger, createdBy: String(createdBy || '') }
  });
  try {
    const data = await collectBackupData(prisma);
    const { tableCounts, recordCount } = summarizeBackup(data);
    const payload = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(payload, 'utf8');
    const completed = await prisma.backupJob.update({
      where: { id: job.id },
      data: {
        status: 'success',
        tableCounts,
        recordCount,
        sizeBytes,
        payload,
        error: '',
        completedAt: new Date()
      }
    });
    const schedule = await getSchedule(prisma);
    await pruneOldBackups(prisma, schedule.retention);
    return toJobSummary(completed);
  } catch (err) {
    const failed = await prisma.backupJob.update({
      where: { id: job.id },
      data: { status: 'failed', error: sanitizeError(err), completedAt: new Date() }
    });
    const failedError = new Error(failed.error || 'فشل النسخ الاحتياطي');
    failedError.job = toJobSummary(failed);
    throw failedError;
  }
}

async function getBackupJobs(prisma, limit = 20) {
  const rows = await prisma.backupJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(limit) || 20, 1), 100),
    select: {
      id: true,
      status: true,
      trigger: true,
      tableCounts: true,
      recordCount: true,
      sizeBytes: true,
      error: true,
      createdBy: true,
      createdAt: true,
      completedAt: true
    }
  });
  return rows;
}

/**
 * Runs a scheduled backup if one is due. Returns the job summary or null.
 * Skips when another backup started within the last 10 minutes (multi-instance guard).
 */
async function checkAndRunDueBackup(prisma, now = new Date()) {
  const schedule = await getSchedule(prisma);
  if (!isBackupDue(schedule, now)) return null;
  const recent = await prisma.backupJob.findFirst({
    where: {
      status: { in: ['running', 'success'] },
      createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) }
    },
    orderBy: { createdAt: 'desc' }
  });
  if (recent) return null;
  const job = await runBackup(prisma, { trigger: 'scheduled', createdBy: 'scheduler' });
  await touchLastRun(prisma, now);
  return job;
}

module.exports = {
  BACKUP_TABLES,
  DEFAULT_SCHEDULE,
  SCHEDULE_KEY,
  validateSchedule,
  isBackupDue,
  cairoParts,
  getSchedule,
  saveSchedule,
  touchLastRun,
  collectBackupData,
  summarizeBackup,
  runBackup,
  getBackupJobs,
  pruneOldBackups,
  checkAndRunDueBackup
};
