const prisma = require('./prisma');

// Modules shown in navigation (each maps to API route groups)
const MODULES = ['dashboard', 'clients', 'invoices', 'items', 'suppliers'];
// Module access levels
const LEVELS = ['hidden', 'view', 'edit'];

// Built-in system roles (seeded on demand; editable but not deletable)
const DEFAULT_ROLES = {
  admin: {
    label: 'مدير',
    permissions: {
      modules: { dashboard: 'edit', clients: 'edit', invoices: 'edit', items: 'edit', suppliers: 'edit' },
      manageUsers: true,
      manageSettings: true,
    },
  },
  editor: {
    label: 'محرر',
    permissions: {
      modules: { dashboard: 'edit', clients: 'edit', invoices: 'edit', items: 'edit', suppliers: 'edit' },
      manageUsers: false,
      manageSettings: true,
    },
  },
  viewer: {
    label: 'مشاهد',
    permissions: {
      modules: { dashboard: 'view', clients: 'view', invoices: 'view', items: 'view', suppliers: 'view' },
      manageUsers: false,
      manageSettings: false,
    },
  },
};

// Legacy accounts created before roles existed carry role 'user' → editor-equivalent access.
const LEGACY_FALLBACK_KEY = 'editor';

function sanitizePermissions(input) {
  const modules = {};
  for (const m of MODULES) {
    const v = input && input.modules && input.modules[m];
    modules[m] = LEVELS.includes(v) ? v : 'hidden';
  }
  return {
    modules,
    manageUsers: Boolean(input && input.manageUsers),
    manageSettings: Boolean(input && input.manageSettings),
  };
}

// Short-lived in-memory cache so every API call doesn't hit the DB.
// Invalidated on any role write.
let cache = { at: 0, map: null };
const CACHE_TTL_MS = 30 * 1000;

function invalidateRolesCache() {
  cache = { at: 0, map: null };
}

async function ensureSystemRoles() {
  for (const [key, def] of Object.entries(DEFAULT_ROLES)) {
    await prisma.role.upsert({
      where: { key },
      update: {},
      create: { key, label: def.label, system: true, permissions: def.permissions },
    });
  }
}

async function loadRoleMap() {
  if (cache.map && Date.now() - cache.at < CACHE_TTL_MS) return cache.map;
  await ensureSystemRoles();
  const rows = await prisma.role.findMany();
  const map = {};
  for (const r of rows) {
    map[r.key] = { key: r.key, label: r.label, system: r.system, permissions: sanitizePermissions(r.permissions) };
  }
  cache = { at: Date.now(), map };
  return map;
}

async function getRolePermissions(roleKey) {
  const map = await loadRoleMap();
  if (map[roleKey]) return map[roleKey].permissions;
  if (roleKey === 'user' && map[LEGACY_FALLBACK_KEY]) return map[LEGACY_FALLBACK_KEY].permissions;
  return null; // unknown role → deny
}

async function listRolesWithCounts() {
  const map = await loadRoleMap();
  const groups = await prisma.user.groupBy({ by: ['role'], _count: { role: true } });
  const counts = {};
  for (const g of groups) counts[g.role] = g._count.role;
  return Object.values(map)
    .map((r) => ({ ...r, userCount: counts[r.key] || 0 }))
    .sort((a, b) => Number(b.system) - Number(a.system) || a.key.localeCompare(b.key));
}

function canRead(perms, module) {
  return perms && (perms.modules[module] === 'view' || perms.modules[module] === 'edit');
}

function canWrite(perms, module) {
  return perms && perms.modules[module] === 'edit';
}

module.exports = {
  MODULES,
  LEVELS,
  DEFAULT_ROLES,
  sanitizePermissions,
  invalidateRolesCache,
  ensureSystemRoles,
  loadRoleMap,
  getRolePermissions,
  listRolesWithCounts,
  canRead,
  canWrite,
};
