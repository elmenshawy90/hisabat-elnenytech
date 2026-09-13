const express = require('express');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { defaults, validateSettings } = require('../lib/backup/service');
const router = express.Router();
router.use(requireAuth);
router.use(async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: Number(req.user.userId) }, select: { role: true, username: true } });
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'النسخ الاحتياطي متاح للمدير فقط' });
    req.backupUser = user.username;
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.get('X-Requested-With') !== 'Hisabat') return res.status(403).json({ error: 'طلب غير صالح' });
    }
    next();
  } catch { res.status(503).json({ error: 'تعذر التحقق من صلاحيات المستخدم' }); }
});
function configured() { return process.env.BACKUPS_ENABLED === 'true' && !!process.env.BACKUP_WORKER_URL && !!process.env.BACKUP_WORKER_TOKEN; }
async function worker(route, method = 'GET', body) {
  if (!configured()) { const e = new Error('النسخ الاحتياطي غير مفعّل؛ يلزم تجهيز عامل التشغيل والتخزين أولًا'); e.status = 503; throw e; }
  const base = new URL(process.env.BACKUP_WORKER_URL);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('HTTPS required');
  const response = await fetch(new URL(route, base), { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${process.env.BACKUP_WORKER_TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const e = new Error(response.status === 409 ? 'توجد نسخة قيد التنفيذ بالفعل' : 'تعذر تنفيذ العملية؛ تحقق من عامل النسخ'); e.status = [404, 409].includes(response.status) ? response.status : 503; throw e; }
  return response;
}
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
router.get('/', wrap(async (req, res) => {
  if (!configured()) return res.json({ configured: false, settings: defaults, records: [] });
  res.json(await (await worker('/status')).json());
}));
router.put('/settings', wrap(async (req, res) => {
  let settings;
  try { settings = validateSettings(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json(await (await worker('/settings', 'PUT', settings)).json());
}));
router.post('/', wrap(async (req, res) => res.status(202).json(await (await worker('/backups', 'POST', { requestedBy: req.backupUser })).json())));
router.param('id', (req, res, next, id) => /^[a-f\d-]{36}$/.test(id) ? next() : res.status(400).json({ error: 'معرف غير صالح' }));
router.patch('/:id', wrap(async (req, res) => {
  if (typeof req.body.keep !== 'boolean') return res.status(400).json({ error: 'قيمة غير صالحة' });
  res.json(await (await worker(`/backups/${req.params.id}`, 'PATCH', { keep: req.body.keep })).json());
}));
router.get('/:id/download', wrap(async (req, res) => {
  const response = await worker(`/backups/${req.params.id}/download`);
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="hisabat-${req.params.id}.backup"` });
  await pipeline(Readable.fromWeb(response.body), res);
}));
router.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 503).json({ error: err.status ? err.message : 'عامل النسخ غير متاح حاليًا؛ حاول لاحقًا' }); });
module.exports = router;
