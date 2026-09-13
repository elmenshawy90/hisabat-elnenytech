const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { BackupService, nextRun, validateSettings } = require('../lib/backup/service');
const { decrypt } = require('../scripts/decrypt-backup');
async function fixture(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hisabat-backup-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = new BackupService({ directory, databaseUrl: 'postgresql://fixture.invalid/test', key: 'ab'.repeat(32), dump: file => fs.writeFile(file, 'PGDMP test fixture'), ...extra });
  await service.init(); return service;
}
test('backup is encrypted, roundtrips, survives restart and rejects tampering without partial output', async t => {
  const s = await fixture(t);
  const r = await s.start('manual', 'admin'); await s.status();
  assert.equal(r.status, 'completed'); assert.equal(r.sha256.length, 64);
  const file = s.file(r.id); const bytes = await fs.readFile(file);
  assert.equal(bytes.includes(Buffer.from('PGDMP')), false);
  const output = path.join(s.directory, 'restored.dump');
  await decrypt(file, output, 'ab'.repeat(32)); assert.equal(await fs.readFile(output, 'utf8'), 'PGDMP test fixture');
  await assert.rejects(decrypt(file, output, 'ab'.repeat(32))); // no overwrite
  bytes[25] ^= 1; await fs.writeFile(file, bytes);
  const bad = path.join(s.directory, 'bad.dump'); await assert.rejects(decrypt(file, bad, 'ab'.repeat(32)));
  await assert.rejects(fs.access(bad));
  const restarted = new BackupService({ directory: s.directory, databaseUrl: 'fixture', key: 'ab'.repeat(32) }); await restarted.init();
  assert.equal(restarted.snapshot().records[0].id, r.id);
});
test('concurrent manual jobs are rejected and failed dumps leave no downloadable file', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = await fixture(t, { dump: async () => { await gate; throw new Error('secret database credentials'); } });
  const r = await s.start(); await assert.rejects(s.start(), /قيد التنفيذ/); release(); await s.status();
  assert.equal(r.status, 'failed'); assert.equal(r.error.includes('secret'), false); assert.throws(() => s.file(r.id));
  assert.equal((await fs.readdir(s.directory)).some(n => /\.(part|dump)$/.test(n)), false);
});
test('biweekly schedule crosses months, manual backup leaves schedule unchanged, retention preserves pinned/latest', async t => {
  let now = new Date('2026-09-30T22:00:00Z');
  const s = await fixture(t, { now: () => now });
  const settings = { enabled: true, intervalDays: 14, time: '02:00', retentionDays: 30 };
  await s.settings(settings); assert.equal(s.state.settings.nextRun, '2026-09-30T23:00:00.000Z');
  const first = await s.start(); await s.status(); await s.keep(first.id, true);
  const second = await s.start(); await s.status();
  assert.equal(s.state.settings.nextRun, '2026-09-30T23:00:00.000Z');
  now = new Date('2026-09-30T23:01:00Z'); await s.tick(); await s.status();
  assert.equal(s.state.settings.nextRun, '2026-10-14T23:00:00.000Z');
  now = new Date('2026-12-01T10:00:00Z'); const latest = await s.start(); await s.status();
  assert.equal(first.status, 'completed'); assert.equal(second.status, 'expired'); assert.equal(latest.status, 'completed');
  assert.throws(() => s.file('../../outside'));
});
test('schedule validates intervals and times', () => {
  assert.throws(() => validateSettings({ enabled: true, intervalDays: 2, time: '02:00', retentionDays: 90 }));
  assert.throws(() => validateSettings({ enabled: true, intervalDays: 14, time: '25:00', retentionDays: 90 }));
  assert.equal(nextRun({ time: '02:00', intervalDays: 14 }, new Date('2026-12-31T23:30:00Z'), true), '2027-01-14T23:00:00.000Z');
});

test('backup API rechecks current admin role and is disabled without configuration', async () => {
  const vm = require('node:vm');
  const syncFs = require('node:fs');
  const { createRequire } = require('node:module');
  const filename = path.join(__dirname, '../routes/backups.js');
  const realRequire = createRequire(filename);
  let role = 'viewer';
  const context = vm.createContext({ process: { env: {} }, console, module: { exports: {} }, require(name) {
    if (name === '../lib/prisma') return { user: { findUnique: async ({ where }) => { assert.equal(where.id, 7); return { role, username: 'tester' }; } } };
    return realRequire(name);
  } });
  vm.runInContext(syncFs.readFileSync(filename, 'utf8'), context);
  const router = context.module.exports;
  const gate = router.stack[1].handle;
  const response = () => ({ code: 200, set() {}, status(n) { this.code = n; return this; }, json(d) { this.data = d; } });
  let called = false; const denied = response();
  await gate({ user: { userId: 7, role: 'admin' }, method: 'GET' }, denied, () => { called = true; });
  assert.equal(denied.code, 403); assert.equal(called, false);
  role = 'admin'; const allowed = response();
  await gate({ user: { userId: 7 }, method: 'GET' }, allowed, () => { called = true; }); assert.equal(called, true);
  const get = router.stack.find(l => l.route?.path === '/' && l.route.methods.get).route.stack[0].handle;
  await get({}, allowed, e => { throw e; });
  assert.equal(allowed.data.configured, false); assert.equal(allowed.data.records.length, 0);
  const csrf = response(); await gate({ user: { userId: 7 }, method: 'POST', get: () => '' }, csrf, () => assert.fail('untrusted write accepted')); assert.equal(csrf.code, 403);
});
