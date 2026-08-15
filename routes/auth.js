const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  try {
    let user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    
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

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      process.env.SESSION_SECRET || 'fallback-secret-for-dev',
      { expiresIn: '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    });

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
  res.clearCookie('token', { path: '/' });
  res.json({ message: 'تم تسجيل الخروج بنجاح' });
});

// GET /api/auth/me - Check current session
router.get('/me', (req, res) => {
  if (req.user) {
    res.json({
      authenticated: true,
      user: {
        username: req.user.username,
        role: req.user.role
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
