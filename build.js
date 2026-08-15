const { execSync } = require('child_process');

console.log('🔧 Generating Prisma Client...');
execSync('npx prisma generate', { stdio: 'inherit' });

console.log('✅ Build complete');
