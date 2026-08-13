const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  try {
    let user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    
    // Auto-seed default admin if database is empty or missing admin
    if (!user && username.toLowerCase() === 'admin' && password === 'password123') {
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        const hashedPassword = await bcrypt.hash('password123', 10);
        user = await prisma.user.create({
          data: {
            username: 'admin',
            password: hashedPassword,
            displayName: 'المدير',
            role: 'admin'
          }
        });
      }
    }
    
    if (!user) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.username = user.username;

    res.json({
      message: 'تم تسجيل الدخول بنجاح',
      user: {
        username: user.username,
        displayName: user.displayName,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.userId = null;
    req.session.role = null;
    req.session.username = null;
    req.session.destroy((err) => {
      res.clearCookie('connect.sid', { path: '/' });
      if (err) {
        return res.status(500).json({ error: 'فشل في تسجيل الخروج' });
      }
      res.json({ message: 'تم تسجيل الخروج بنجاح' });
    });
  } else {
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ message: 'تم تسجيل الخروج بنجاح' });
  }
});

// GET /api/auth/me - Check current session
router.get('/me', (req, res) => {
  if (req.session && req.session.userId) {
    res.json({
      authenticated: true,
      user: {
        username: req.session.username,
        role: req.session.role
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
