const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../lib/backup');

// 2026-09-13 is a Sunday. 12:00Z == 15:00 in Cairo (DST, UTC+3) — safely
// past a 03:00 schedule and safely before a 23:00 one, far from midnight edges.
const SUN_15H_CAIRO = new Date('2026-09-13T12:00:00Z');
const MON_15H_CAIRO = new Date('2026-09-14T12:00:00Z');

function dailySchedule(overrides = {}) {
  return {
    enabled: true,
    frequency: 'daily',
    time: '03:00',
    weekday: 5,
    retention: 14,
    lastRunAt: null,
    ...overrides
  };
}

// In-memory mock of the Prisma surface used by lib/backup.
function mockPrisma(tables = {}, jobs = [], settings = {}) {
  const delegates = {};
  for (const name of backup.BACKUP_TABLES) {
    const rows = tables[name];
    delegates[name] = {
      findMany: async () => {
        if (typeof rows === 'function') return rows();
        if (rows instanceof Error) throw rows;
        return rows || [];
      }
    };
  }
  let seq = 100;
  return {
    ...delegates,
    backupJob: {
      async create({ data }) {
        const job = { id: seq++, tableCounts: null, recordCount: 0, sizeBytes: 0, payload: null, error: '', createdBy: '', createdAt: new Date(), completedAt: null, ...data };
        jobs.push(job);
        return { ...job };
      },
      async update({ where, data }) {
        const job = jobs.find((j) => j.id === where.id);
        assert.ok(job, 'job must exist');
        Object.assign(job, data);
        return { ...job };
      },
      async findMany({ where = {}, orderBy, take } = {}) {
        let rows = jobs.filter((j) => (where.status ? j.status === where.status : true));
        rows = rows.slice().sort((a, b) => b.createdAt - a.createdAt);
        return (typeof take === 'number' ? rows.slice(0, take) : rows).map((j) => ({ ...j }));
      },
      async findFirst() {
        return null;
      },
      async deleteMany({ where }) {
        const ids = new Set(where.id.in);
        let count = 0;
        for (let i = jobs.length - 1; i >= 0; i -= 1) {
          if (ids.has(jobs[i].id)) {
            jobs.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      }
    },
    setting: {
      async findMany() {
        return Object.entries(settings).map(([key, value]) => ({ key, value }));
      },
      async findUnique({ where }) {
        return settings[where.key] ? { key: where.key, value: settings[where.key] } : null;
      },
      async upsert({ where, update, create }) {
        settings[where.key] = update.value || create.value;
        return { key: where.key, value: settings[where.key] };
      }
    },
    __jobs: jobs,
    __settings: settings
  };
}

test('validateSchedule accepts a full schedule and applies safe defaults', () => {
  const clean = backup.validateSchedule({ enabled: true, frequency: 'weekly', time: '04:30', weekday: 1, retention: 7 });
  assert.deepEqual(clean, { enabled: true, frequency: 'weekly', time: '04:30', weekday: 1, retention: 7 });

  const defaults = backup.validateSchedule({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.frequency, 'daily');
  assert.equal(defaults.retention, 14);
});

test('validateSchedule rejects bad time, weekday, and retention values', () => {
  assert.throws(() => backup.validateSchedule({ time: '25:00' }), /وقت الجدولة/);
  assert.throws(() => backup.validateSchedule({ time: 'nope' }), /وقت الجدولة/);
  assert.throws(() => backup.validateSchedule({ frequency: 'weekly', weekday: 9 }), /اليوم الأسبوعي/);
  assert.throws(() => backup.validateSchedule({ retention: 0 }), /عدد النسخ/);
  assert.throws(() => backup.validateSchedule({ retention: 91 }), /عدد النسخ/);
});

test('isBackupDue handles the daily lifecycle', () => {
  assert.equal(backup.isBackupDue({ ...dailySchedule(), enabled: false }, SUN_15H_CAIRO), false);
  assert.equal(backup.isBackupDue(dailySchedule(), SUN_15H_CAIRO), true); // never ran
  assert.equal(backup.isBackupDue(dailySchedule({ time: '23:00' }), SUN_15H_CAIRO), false); // later today
  assert.equal(
    backup.isBackupDue(dailySchedule({ lastRunAt: '2026-09-13T05:00:00Z' }), SUN_15H_CAIRO),
    false
  ); // already ran today (Cairo)
  assert.equal(
    backup.isBackupDue(dailySchedule({ lastRunAt: '2026-09-12T05:00:00Z' }), SUN_15H_CAIRO),
    true
  ); // ran yesterday → due
});

test('isBackupDue runs weekly only on the configured weekday (with catch-up)', () => {
  const friday = { ...dailySchedule(), frequency: 'weekly', weekday: 5, lastRunAt: '2026-09-11T05:00:00Z' };
  // Sunday now, Friday schedule, last ran Friday → not due.
  assert.equal(backup.isBackupDue(friday, SUN_15H_CAIRO), false);
  // Monday now, Friday schedule, last ran 8 days ago (missed week) → catch-up run.
  const missed = { ...friday, lastRunAt: '2026-09-05T05:00:00Z' };
  assert.equal(backup.isBackupDue(missed, MON_15H_CAIRO), true);
  // Monday now, Friday schedule, last ran yesterday → not due.
  const recent = { ...friday, lastRunAt: '2026-09-13T05:00:00Z' };
  assert.equal(backup.isBackupDue(recent, MON_15H_CAIRO), false);
});

test('schedule round-trips through the Setting store and preserves lastRunAt', async () => {
  const prisma = mockPrisma();
  const saved = await backup.saveSchedule(prisma, { enabled: true, time: '02:00', retention: 5 });
  assert.equal(saved.enabled, true);
  assert.equal(saved.lastRunAt, null);

  const loaded = await backup.getSchedule(prisma);
  assert.equal(loaded.time, '02:00');

  await backup.touchLastRun(prisma, new Date('2026-09-13T00:00:00Z'));
  const resaved = await backup.saveSchedule(prisma, { enabled: false, time: '02:00', retention: 5 });
  assert.equal(resaved.lastRunAt, '2026-09-13T00:00:00.000Z');
});

test('runBackup dumps every table and records a success job', async () => {
  const prisma = mockPrisma({ client: [{ id: 1, name: 'عميل' }], invoice: [{ id: 1 }, { id: 2 }] });
  const job = await backup.runBackup(prisma, { trigger: 'manual', createdBy: 'admin' });

  assert.equal(job.status, 'success');
  assert.equal(job.trigger, 'manual');
  assert.equal(job.recordCount, 3);
  assert.equal(job.tableCounts.client, 1);
  assert.equal(job.tableCounts.invoice, 2);
  assert.ok(job.sizeBytes > 0);
  assert.equal(job.payload, undefined); // summaries never leak the dump

  const stored = prisma.__jobs[0];
  const parsed = JSON.parse(stored.payload);
  assert.equal(parsed.version, 1);
  assert.deepEqual(Object.keys(parsed.tables).sort(), backup.BACKUP_TABLES.slice().sort());
  assert.equal(parsed.tables.client[0].name, 'عميل');
});

test('runBackup records a sanitized failure without leaking connection strings', async () => {
  const failure = new Error('connect postgres://admin:s3cret@host/db failed');
  const prisma = mockPrisma({ client: failure });
  await assert.rejects(() => backup.runBackup(prisma, { trigger: 'manual' }), /failed/);
  const stored = prisma.__jobs[0];
  assert.equal(stored.status, 'failed');
  assert.match(stored.payload || '', /^$/); // no dump stored — null/empty only
  assert.doesNotMatch(stored.error, /s3cret/);
  assert.match(stored.error, /REDACTED_CONNECTION_STRING/);
});

test('checkAndRunDueBackup runs only when due and skips recent duplicates', async () => {
  const dueStore = {};
  const duePrisma = mockPrisma({}, [], dueStore);
  await backup.saveSchedule(duePrisma, { enabled: true, time: '03:00', retention: 14 });
  const job = await backup.checkAndRunDueBackup(duePrisma, SUN_15H_CAIRO);
  assert.ok(job);
  assert.equal(job.trigger, 'scheduled');
  const schedule = await backup.getSchedule(duePrisma);
  assert.ok(schedule.lastRunAt);

  // Second tick same day → nothing due.
  assert.equal(await backup.checkAndRunDueBackup(duePrisma, SUN_15H_CAIRO), null);

  // Disabled schedule → null without touching the DB jobs table.
  const offPrisma = mockPrisma();
  await backup.saveSchedule(offPrisma, { enabled: false });
  assert.equal(await backup.checkAndRunDueBackup(offPrisma, SUN_15H_CAIRO), null);
  assert.equal(offPrisma.__jobs.length, 0);
});

test('pruneOldBackups keeps only the newest N successful jobs', async () => {
  const prisma = mockPrisma();
  for (let i = 0; i < 5; i += 1) {
    const job = await prisma.backupJob.create({ data: { status: 'success' } });
    job.createdAt = new Date(Date.UTC(2026, 8, 10 + i));
  }
  await backup.pruneOldBackups(prisma, 2);
  assert.equal(prisma.__jobs.length, 2);
});
