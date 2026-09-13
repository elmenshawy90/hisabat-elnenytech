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

// Dynamic role permissions (customizable from the Users > Roles tab).
// GET/HEAD/OPTIONS need 'view' on the module; writes need 'edit'.
function requireAccess(module) {
  return async (req, res, next) => {
    try {
      const { getRolePermissions, canRead, canWrite } = require('../lib/roles');
      const perms = await getRolePermissions(req.user && req.user.role);
      if (!perms) {
        return res.status(403).json({ error: 'ممنوع، الدور غير معروف' });
      }
      const isRead = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
      const ok = isRead ? canRead(perms, module) : canWrite(perms, module);
      if (!ok) {
        return res.status(403).json({ error: isRead ? 'ممنوع، هذا القسم مخفي لدورك' : 'ممنوع، دورك لا يسمح بالتعديل' });
      }
      req.permissions = perms;
      return next();
    } catch (err) {
      console.error('requireAccess error:', err);
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
  };
}

// User/role management section (Users tab + /api/users + /api/roles)
async function requireManageUsers(req, res, next) {
  try {
    const { getRolePermissions } = require('../lib/roles');
    const perms = await getRolePermissions(req.user && req.user.role);
    if (perms && perms.manageUsers) {
      req.permissions = perms;
      return next();
    }
    return res.status(403).json({ error: 'ممنوع، مطلوب صلاحيات إدارة المستخدمين' });
  } catch (err) {
    console.error('requireManageUsers error:', err);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
}

module.exports = { requireAuth, requireAdmin, requireEditor, requireAccess, requireManageUsers };
