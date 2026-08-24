function requireAuth(req, res, next) {
  if (req.user) {
    return next();
  } else {
    return res.status(401).json({ error: 'غير مصرح، يرجى تسجيل الدخول' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  } else {
    return res.status(403).json({ error: 'ممنوع، مطلوب صلاحيات مدير' });
  }
}

module.exports = { requireAuth, requireAdmin };
