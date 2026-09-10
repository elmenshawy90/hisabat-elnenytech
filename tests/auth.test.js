const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getSessionSecret } = require('../lib/auth-config');
const { createFirstAdmin } = require('../scripts/setup-admin');

const secret = 'test-only-private-signing-key-1234567890';
process.env.SESSION_SECRET = secret;
const prismaPath = require.resolve('../lib/prisma');
const mock = { user: {} };
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: mock };
const router = require('../routes/auth');
const login = router.stack.find(layer => layer.route?.path === '/login').route.stack[0].handle;
function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    cookie(name, value, options) { this.cookieData = { name, value, options }; }
  };
}

test('missing, blank, and known fallback signing secrets are rejected', () => {
  for (const value of [undefined, '', '  ', 'hisabat-production-fallback-secret-2026', 'fallback-secret-for-dev']) {
    assert.throws(() => getSessionSecret({ SESSION_SECRET: value }), /SESSION_SECRET/);
  }
  assert.equal(getSessionSecret({ SESSION_SECRET: secret }), secret);
});

test('default credentials cannot create an account on login', async () => {
  mock.user = { findUnique: async () => null, create: () => assert.fail('Login must not create users') };
  const res = response();
  await login({ body: { username: 'admin', password: 'password123' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.cookieData, undefined);
});

test('invalid input types are rejected before a database call', async () => {
  mock.user = { findUnique: () => assert.fail('Unexpected database call') };
  for (const body of [{ username: {}, password: 'x' }, { username: 'admin', password: [] }]) {
    const res = response();
    await login({ body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('existing users can log in with a signed seven-day HttpOnly cookie', async () => {
  const password = 'existing-user-password';
  const user = { id: 7, username: 'admin', displayName: 'Admin', role: 'admin', password: await bcrypt.hash(password, 4), failedLoginAttempts: 2, lockedUntil: null };
  let update;
  mock.user = { findUnique: async () => user, update: async (data) => { update = data; } };
  const res = response();
  await login({ body: { username: 'admin', password }, secure: true, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  const token = jwt.verify(res.cookieData.value, secret);
  assert.equal(token.userId, 7);
  assert.equal(token.exp - token.iat, 7 * 24 * 60 * 60);
  assert.equal(res.cookieData.options.httpOnly, true);
  assert.equal(res.cookieData.options.secure, true);
  assert.equal(update.data.failedLoginAttempts, 0);
  assert.equal(res.body.user.password, undefined);
});

test('failed passwords retain account lockout behavior', async () => {
  let update;
  mock.user = {
    findUnique: async () => ({ id: 7, password: await bcrypt.hash('correct-password', 4), failedLoginAttempts: 4 }),
    update: async data => { update = data; }
  };
  const res = response();
  await login({ body: { username: 'admin', password: 'wrong-password' } }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(update.data.failedLoginAttempts, 5);
  assert.ok(update.data.lockedUntil > new Date());
  assert.equal(res.cookieData, undefined);
});

function database({ existingAdmin = false, existingUser = false } = {}) {
  let saved;
  let locked = false;
  const tx = {
    $executeRaw: async () => { locked = true; },
    user: {
      count: async () => { assert.ok(locked); return existingAdmin ? 1 : 0; },
      findUnique: async () => existingUser ? { id: 3 } : null,
      create: async ({ data }) => { saved = data; return { id: 9, ...data }; }
    }
  };
  return { $transaction: async fn => fn(tx), get saved() { return saved; } };
}
const credentials = { ADMIN_USERNAME: ' NewAdmin ', ADMIN_PASSWORD: 'chosen-long-password' };

test('bootstrap stores a bcrypt hash with a normalized username', async () => {
  const db = database();
  await createFirstAdmin(db, credentials);
  assert.equal(db.saved.username, 'newadmin');
  assert.equal(db.saved.role, 'admin');
  assert.notEqual(db.saved.password, credentials.ADMIN_PASSWORD);
  assert.ok(await bcrypt.compare(credentials.ADMIN_PASSWORD, db.saved.password));
});

test('bootstrap refuses existing administrators and username collisions', async () => {
  for (const state of [{ existingAdmin: true }, { existingUser: true }]) {
    const db = database(state);
    await assert.rejects(createFirstAdmin(db, credentials), /already exists/);
    assert.equal(db.saved, undefined);
  }
});

test('bootstrap rejects missing or invalid credentials before database access', async () => {
  const db = { $transaction: () => assert.fail('Unexpected database call') };
  for (const env of [{}, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'short' }, { ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'أ'.repeat(40) }]) {
    await assert.rejects(createFirstAdmin(db, env), /ADMIN_USERNAME and ADMIN_PASSWORD/);
  }
});
