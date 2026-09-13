const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');

const defaults = { enabled: false, intervalDays: 14, time: '02:00', retentionDays: 90, nextRun: null };
function nextRun(settings, now = new Date(), advance = false) {
  const [hour, minute] = settings.time.split(':').map(Number);
  const local = new Date(now.getTime() + 3 * 3600000);
  const result = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour - 3, minute));
  if (advance) result.setUTCDate(result.getUTCDate() + settings.intervalDays);
  else if (result <= now) result.setUTCDate(result.getUTCDate() + 1);
  return result.toISOString();
}
function validateSettings(input) {
  if (typeof input.enabled !== 'boolean' || ![1, 7, 14].includes(input.intervalDays) ||
      ![30, 90, 180, 365].includes(input.retentionDays) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    throw new Error('إعدادات الجدولة غير صالحة');
  }
  return { enabled: input.enabled, intervalDays: input.intervalDays, time: input.time, retentionDays: input.retentionDays };
}
function dumpDatabase(file, url) {
  return new Promise((resolve, reject) => {
    // Credentials stay in the worker environment, never in command arguments or logs.
    const child = spawn('pg_dump', ['--format=custom', '--schema=public', '--no-owner', '--no-acl', '--file', file], {
      env: { ...process.env, PGDATABASE: url }, stdio: ['ignore', 'ignore', 'pipe']
    });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill('SIGTERM'), 30 * 60000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('تعذر تشغيل أداة النسخ الاحتياطي')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('فشل نسخ قاعدة البيانات؛ راجع اتصال العامل وإصدار pg_dump')); });
  });
}
class BackupService {
  constructor({ directory, databaseUrl, key, dump = dumpDatabase, now = () => new Date() }) {
    if (!path.isAbsolute(directory) || !databaseUrl || !/^[a-f\d]{64}$/i.test(key || '')) throw new Error('Incomplete backup worker configuration');
    this.directory = directory; this.databaseUrl = databaseUrl; this.key = Buffer.from(key, 'hex');
    this.dump = dump; this.now = now; this.job = null; this.saving = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.state = JSON.parse(await fs.readFile(path.join(this.directory, 'index.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; this.state = { settings: { ...defaults }, records: [] }; }
    for (const record of this.state.records) {
      if (record.status === 'running') { record.status = 'failed'; record.error = 'توقف عامل النسخ قبل اكتمال العملية'; }
    }
    // Remove incomplete temporary exports after an interrupted process.
    for (const name of await fs.readdir(this.directory)) {
      if (/^[a-f\d-]{36}\.(dump|part)$/.test(name)) await fs.rm(path.join(this.directory, name), { force: true });
    }
    await this.save();
  }
  save() {
    const snapshot = JSON.stringify(this.state);
    this.saving = this.saving.catch(() => {}).then(async () => {
      const tmp = path.join(this.directory, 'index.tmp');
      await fs.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.rename(tmp, path.join(this.directory, 'index.json'));
    });
    return this.saving;
  }
  async status() {
    await this.job?.catch(() => {}); // Used only by tests/CLI; HTTP uses snapshot().
    return this.snapshot();
  }
  snapshot() { return { configured: true, settings: this.state.settings, records: [...this.state.records].reverse() }; }
  async settings(input) {
    const value = validateSettings(input);
    this.state.settings = { ...value, nextRun: value.enabled ? nextRun(value, this.now()) : null };
    await this.save(); return this.state.settings;
  }
  async start(type = 'manual', requestedBy = 'النظام') {
    if (this.job) { const e = new Error('توجد نسخة احتياطية قيد التنفيذ'); e.status = 409; throw e; }
    const record = { id: crypto.randomUUID(), createdAt: this.now().toISOString(), type, requestedBy, status: 'running', size: 0, keep: false };
    this.state.records.push(record);
    // Assign the job before yielding, so simultaneous requests cannot start a second dump.
    this.job = this.run(record).finally(() => { this.job = null; });
    this.job.catch(() => {});
    return record;
  }
  async run(record) {
    const raw = path.join(this.directory, `${record.id}.dump`);
    const temp = path.join(this.directory, `${record.id}.part`);
    try {
      await this.save();
      await fs.writeFile(raw, '', { mode: 0o600 });
      await this.dump(raw, this.databaseUrl);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
      await fs.writeFile(temp, Buffer.concat([Buffer.from('HISABAK1'), iv]), { mode: 0o600 });
      await pipeline(createReadStream(raw), cipher, createWriteStream(temp, { flags: 'a', mode: 0o600 }));
      await fs.appendFile(temp, cipher.getAuthTag());
      const file = path.join(this.directory, `${record.id}.backup`);
      await fs.rename(temp, file);
      record.size = (await fs.stat(file)).size;
      record.sha256 = await hashFile(file);
      record.status = 'completed'; record.completedAt = this.now().toISOString();
    } catch (e) {
      record.status = 'failed'; record.error = 'تعذر إكمال النسخة. تحقق من اتصال قاعدة البيانات ومساحة التخزين وأداة pg_dump.';
    } finally {
      await fs.rm(raw, { force: true }); await fs.rm(temp, { force: true });
      await this.save();
    }
    if (record.status === 'completed') await this.cleanup();
  }
  async cleanup() {
    const cutoff = this.now().getTime() - this.state.settings.retentionDays * 86400000;
    const completed = this.state.records.filter(r => r.status === 'completed');
    const latest = completed.at(-1)?.id;
    for (const r of completed) {
      if (r.id !== latest && !r.keep && new Date(r.createdAt).getTime() < cutoff) {
        await fs.rm(path.join(this.directory, `${r.id}.backup`), { force: true });
        r.status = 'expired';
      }
    }
    await this.save();
  }
  async tick() {
    const s = this.state.settings;
    if (this.job || !s.enabled || !s.nextRun || new Date(s.nextRun) > this.now()) return;
    // Persist the next date first: restarts do not repeat an already-started scheduled run.
    s.nextRun = nextRun(s, this.now(), true);
    await this.save();
    await this.start('automatic');
  }
  async keep(id, keep) {
    const record = this.state.records.find(r => r.id === id && r.status === 'completed');
    if (!record || typeof keep !== 'boolean') { const e = new Error('النسخة غير متاحة'); e.status = 404; throw e; }
    record.keep = keep; await this.save(); return record;
  }
  file(id) {
    const record = this.state.records.find(r => r.id === id && r.status === 'completed');
    if (!record) { const e = new Error('النسخة غير متاحة'); e.status = 404; throw e; }
    return path.join(this.directory, `${record.id}.backup`);
  }
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
module.exports = { BackupService, defaults, nextRun, validateSettings };
