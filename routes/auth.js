const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { getSessionSecret } = require('../lib/auth-config');
const { requireAuth } = require('../middleware/auth');
const sessionSecret = getSessionSecret();

// Configuration for account lockout
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 30;

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    
    if (!user) {
      return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    }

    // Check if account is locked
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const minutesRemaining = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
      return res.status(429).json({ 
        error: `الحساب مقفول. يرجى المحاولة بعد ${minutesRemaining} دقيقة` 
      });
    }

    // Clear lockout if time has passed
    if (user.lockedUntil && new Date(user.lockedUntil) <= new Date()) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: null,
          failedLoginAttempts: 0
        }
      });
      user.lockedUntil = null;
      user.failedLoginAttempts = 0;
    }

    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      // Increment failed login attempts
      const newFailedAttempts = user.failedLoginAttempts + 1;
      const lockoutData = {};
      
      if (newFailedAttempts >= MAX_LOGIN_ATTEMPTS) {
        // Lock account for LOCK_TIME_MINUTES
        const lockedUntil = new Date();
        lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCK_TIME_MINUTES);
        lockoutData.lockedUntil = lockedUntil;
        
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: newFailedAttempts,
            ...lockoutData
          }
        });
        
        return res.status(429).json({ 
          error: `محاولات دخول خاطئة متعددة. تم قفل الحساب لمدة ${LOCK_TIME_MINUTES} دقيقة` 
        });
      } else {
        // Just increment the counter
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: newFailedAttempts
          }
        });
        
        const attemptsRemaining = MAX_LOGIN_ATTEMPTS - newFailedAttempts;
        return res.status(401).json({ 
          error: 'بيانات الدخول غير صحيحة',
          attemptsRemaining 
        });
      }
    }

    // Successful login - reset failed attempts and unlock account
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      sessionSecret,
      { expiresIn: '7d' }
    );

    const isSecure = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
    res.cookie('token', token, {
      httpOnly: true,
      secure: isSecure,
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

// POST /api/auth/change-password - change own password (any authenticated user)
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
  }
  if (Buffer.byteLength(newPassword, 'utf8') > 72) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة طويلة جداً' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

    const ok = await bcrypt.compare(currentPassword || '', user.password);
    if (!ok) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });
    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
