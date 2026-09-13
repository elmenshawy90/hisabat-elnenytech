const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireManageUsers } = require('../middleware/auth');
const {
  listRolesWithCounts,
  sanitizePermissions,
  invalidateRolesCache,
} = require('../lib/roles');

// All role-management endpoints require user-management permission
router.use(requireAuth);
router.use(requireManageUsers);

function shape(role, userCount) {
  return {
    key: role.key,
    label: role.label,
    system: role.system,
    permissions: sanitizePermissions(role.permissions),
    userCount: userCount || 0,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

// GET /api/roles - list roles with permission sets + assigned user counts
router.get('/', async (req, res) => {
  try {
    res.json(await listRolesWithCounts());
  } catch (err) {
    console.error('List roles error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// POST /api/roles - create a custom role
router.post('/', async (req, res) => {
  const { key, label, permissions } = req.body;

  if (typeof key !== 'string' || !/^[a-z][a-z0-9_]{1,29}$/.test(key.trim())) {
    return res.status(400).json({ error: 'معرف الدور يجب أن يكون بالإنجليزية: يبدأ بحرف ويحتوي أحرفاً أو أرقاماً أو _ (حتى 30 حرفاً)' });
  }
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'اسم الدور مطلوب' });
  }

  try {
    const cleanKey = key.trim().toLowerCase();
    const existing = await prisma.role.findUnique({ where: { key: cleanKey } });
    if (existing) {
      return res.status(409).json({ error: 'معرف الدور مسجل مسبقاً' });
    }
    const created = await prisma.role.create({
      data: {
        key: cleanKey,
        label: label.trim(),
        system: false,
        permissions: sanitizePermissions(permissions),
      },
    });
    invalidateRolesCache();
    res.status(201).json(shape(created, 0));
  } catch (err) {
    console.error('Create role error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// PUT /api/roles/:key - update label (custom only) + permissions
router.put('/:key', async (req, res) => {
  const roleKey = String(req.params.key || '').toLowerCase();
  const { label, permissions } = req.body;

  try {
    const target = await prisma.role.findUnique({ where: { key: roleKey } });
    if (!target) return res.status(404).json({ error: 'الدور غير موجود' });

    const clean = sanitizePermissions(permissions);
    // Prevent locking yourself out: can't strip user-management from your own role
    if (req.user.role === roleKey && target.permissions && !clean.manageUsers) {
      const before = sanitizePermissions(target.permissions);
      if (before.manageUsers) {
        return res.status(400).json({ error: 'لا يمكنك إزالة صلاحية إدارة المستخدمين عن دورك الحالي' });
      }
    }

    const data = { permissions: clean };
    if (!target.system && typeof label === 'string' && label.trim()) {
      data.label = label.trim();
    }
    const updated = await prisma.role.update({ where: { key: roleKey }, data });
    invalidateRolesCache();
    const userCount = await prisma.user.count({ where: { role: roleKey } });
    res.json(shape(updated, userCount));
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// DELETE /api/roles/:key - delete custom role (only when no users assigned)
router.delete('/:key', async (req, res) => {
  const roleKey = String(req.params.key || '').toLowerCase();

  try {
    const target = await prisma.role.findUnique({ where: { key: roleKey } });
    if (!target) return res.status(404).json({ error: 'الدور غير موجود' });
    if (target.system) {
      return res.status(400).json({ error: 'لا يمكن حذف الأدوار الأساسية' });
    }
    if (req.user.role === roleKey) {
      return res.status(400).json({ error: 'لا يمكنك حذف الدور المسند إلى حسابك الحالي' });
    }
    const assigned = await prisma.user.count({ where: { role: roleKey } });
    if (assigned > 0) {
      return res.status(400).json({ error: `لا يمكن حذف الدور — مسند إلى ${assigned} من المستخدمين. انقلهم أولاً` });
    }
    await prisma.role.delete({ where: { key: roleKey } });
    invalidateRolesCache();
    res.json({ message: 'تم حذف الدور بنجاح' });
  } catch (err) {
    console.error('Delete role error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
