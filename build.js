const { execSync } = require('child_process');

console.log('🔧 Generating Prisma Client...');
execSync('npx prisma generate', { stdio: 'inherit' });

if (process.env.DATABASE_URL) {
  console.log('📦 Running prisma migrate deploy...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  } catch (e) {
    console.error('❌ prisma db push failed:', e.message);
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
  console.log('⚠️  DATABASE_URL not set - skipping prisma db push and seed');
}

console.log('✅ Build complete');
