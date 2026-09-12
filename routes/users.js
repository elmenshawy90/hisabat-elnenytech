const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All user-management endpoints are admin-only
router.use(requireAuth);
router.use(requireAdmin);

const VALID_ROLES = ['admin', 'editor', 'viewer'];

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
    lockedUntil: u.lockedUntil,
  };
}

// GET /api/users - list all users (no password hashes)
router.get('/', async (req, res) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(users.map(publicUser));
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// POST /api/users - create a user
router.post('/', async (req, res) => {
  const { username, password, displayName, role } = req.body;

  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'اسم المستخدم مطلوب' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: 'الدور غير صالح (admin / editor / viewer)' });
  }

  try {
    const normalized = username.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { username: normalized } });
    if (existing) {
      return res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({
      data: {
        username: normalized,
        password: hashed,
        displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : 'مستخدم',
        role,
      },
    });
    res.status(201).json(publicUser(created));
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// PUT /api/users/:id - update displayName / role / password
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرف غير صالح' });
  const { displayName, role, password } = req.body;

  try {
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

    // Cannot change your own role (prevents accidental lockout)
    if (role && role !== target.role && target.id === req.user.userId) {
      return res.status(400).json({ error: 'لا يمكنك تغيير دور حسابك الحالي' });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'الدور غير صالح (admin / editor / viewer)' });
    }
    // Cannot demote the last admin
    if (role && target.role === 'admin' && role !== 'admin') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'لا يمكن تخفيض آخر مدير في النظام' });
      }
    }
    if (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 8)) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
    }

    const data = {};
    if (typeof displayName === 'string' && displayName.trim()) data.displayName = displayName.trim();
    if (role) data.role = role;
    if (password) data.password = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({ where: { id }, data });
    res.json(publicUser(updated));
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرف غير صالح' });

  try {
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (target.id === req.user.userId) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
    }
    if (target.role === 'admin') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'لا يمكن حذف آخر مدير في النظام' });
      }
    }
    await prisma.user.delete({ where: { id } });
    res.json({ message: 'تم حذف المستخدم بنجاح' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
