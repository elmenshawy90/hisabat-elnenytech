// Run as ONE persistent process with a private durable volume, independently of Vercel.
const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { BackupService } = require('../lib/backup/service');
async function main() {
  if (process.env.BACKUPS_ENABLED !== 'true') throw new Error('BACKUPS_ENABLED must be explicitly enabled');
  const token = process.env.BACKUP_WORKER_TOKEN || '';
  if (token.length < 32) throw new Error('A strong BACKUP_WORKER_TOKEN is required');
  const directory = path.resolve(process.env.BACKUP_DIRECTORY || '.');
  const relative = path.relative(path.join(__dirname, '..'), directory);
  if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Backup storage must be outside the application directory');
  const service = new BackupService({ directory: process.env.BACKUP_DIRECTORY || '', databaseUrl: process.env.BACKUP_DATABASE_URL, key: process.env.BACKUP_ENCRYPTION_KEY });
  await fs.mkdir(service.directory, { recursive: true, mode: 0o700 });
  // A second worker must never share this directory. Stale locks require operator review.
  const lock = await fs.open(path.join(service.directory, 'worker.lock'), 'wx', 0o600);
  await lock.writeFile(String(process.pid));
  await service.init();
  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use((req, res, next) => {
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return res.sendStatus(401);
    res.set('Cache-Control', 'no-store'); next();
  });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  app.get('/status', (req, res) => res.json(service.snapshot()));
  app.put('/settings', wrap(async (req, res) => res.json(await service.settings(req.body))));
  app.post('/backups', wrap(async (req, res) => res.status(202).json(await service.start('manual', String(req.body.requestedBy || 'مدير').slice(0, 100)))));
  app.patch('/backups/:id', wrap(async (req, res) => res.json(await service.keep(req.params.id, req.body.keep))));
  app.get('/backups/:id/download', wrap(async (req, res) => res.download(service.file(req.params.id), `${req.params.id}.backup`)));
  app.use((err, req, res, next) => { res.status(err.status || 500).json({ error: err.status ? err.message : 'تعذر تنفيذ العملية في عامل النسخ' }); });
  const timer = setInterval(() => service.tick().catch(() => console.error('Backup scheduler failed')), 60000);
  const server = app.listen(Number(process.env.BACKUP_WORKER_PORT || 3101), process.env.BACKUP_WORKER_HOST || '127.0.0.1', () => console.log('Backup worker ready'));
  await service.tick();
  async function stop() {
    clearInterval(timer); server.close();
    await service.job?.catch(() => {});
    await service.saving;
    await lock.close(); await fs.rm(path.join(service.directory, 'worker.lock'), { force: true });
    process.exit(0);
  }
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
main().catch(() => { console.error('Backup worker could not start. Check explicit configuration, directory lock and permissions.'); process.exitCode = 1; });
