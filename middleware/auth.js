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

// Viewer role is read-only: blocks POST/PUT/PATCH/DELETE for viewers.
// Admins, editors (and legacy 'user' accounts) can write.
function requireEditor(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (req.user && (req.user.role === 'admin' || req.user.role === 'editor' || req.user.role === 'user')) {
    return next();
  } else {
    return res.status(403).json({ error: 'ممنوع، صلاحية المشاهدة للقراءة فقط' });
  }
}

module.exports = { requireAuth, requireAdmin, requireEditor };
