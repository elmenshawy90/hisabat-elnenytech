const bcrypt = require('bcrypt');

async function createFirstAdmin(prisma, env = process.env) {
  const username = (env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD;
  if (!username || typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters, at most 72 UTF-8 bytes).');
  }
  const hashedPassword = await bcrypt.hash(password, 12);
  return prisma.$transaction(async (tx) => {
    // Serialize bootstrap attempts, including when the users table is empty.
    await tx.$executeRaw`LOCK TABLE "User" IN EXCLUSIVE MODE`;
    if (await tx.user.count({ where: { role: 'admin' } })) {
      throw new Error('An administrator already exists. No account was changed.');
    }
    if (await tx.user.findUnique({ where: { username } })) {
      throw new Error('This username already exists. No account was changed.');
    }
    return tx.user.create({ data: {
      username, password: hashedPassword, displayName: 'المدير', role: 'admin'
    } });
  });
}

async function main() {
  require('dotenv').config();
  const prisma = require('../lib/prisma');
  try {
    await createFirstAdmin(prisma);
    console.log('Administrator created successfully.');
  } catch (err) {
    // Do not print database errors that could include account input or connection details.
    console.error(err.code ? 'Administrator setup failed. Check database configuration and username availability.' : err.message);
    process.exitCode = 1;
  } finally {
    delete process.env.ADMIN_PASSWORD;
    await prisma.$disconnect();
  }
}

if (require.main === module) main();
module.exports = { createFirstAdmin };
