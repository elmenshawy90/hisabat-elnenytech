const { execSync } = require('child_process');

console.log('🔧 Generating Prisma Client...');
execSync('npx prisma generate', { stdio: 'inherit' });

if (process.env.DATABASE_URL) {
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl.includes('connect_timeout=')) {
    dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'connect_timeout=10';
  }
  if (!dbUrl.includes('connection_limit=')) {
    dbUrl += '&connection_limit=1';
  }
  process.env.DATABASE_URL = dbUrl;

  console.log('📦 Running prisma migrate deploy...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit', timeout: 30000 });
  } catch (e) {
    console.error('❌ prisma migrate deploy failed:', e.message);
    process.exit(1);
  }

  console.log('🌱 Seeding database...');
  try {
    execSync('node db/seed.js', { stdio: 'inherit' });
  } catch (e) {
    console.error('❌ Seeding failed:', e.message);
    process.exit(1);
  }
} else {
  console.log('⚠️  DATABASE_URL not set - skipping prisma migrate deploy and seed');
}

console.log('✅ Build complete');
