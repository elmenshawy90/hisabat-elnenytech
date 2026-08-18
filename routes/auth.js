const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// Configuration for account lockout
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MINUTES = 30;

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
  }

  try {
    let user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    
    // Create default admin if it doesn't exist
    if (!user && username.toLowerCase() === 'admin' && password === 'password123') {
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        const hashedPassword = await bcrypt.hash('password123', 10);
        user = await prisma.user.create({
          data: {
            username: 'admin',
            password: hashedPassword,
            displayName: 'المدير',
            role: 'admin',
            failedLoginAttempts: 0,
            lockedUntil: null
          }
        });
      }
    }
    
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
