const { execSync } = require('child_process');

console.log('📝 Logging deployment build...');
require('./scripts/log-deployment');

console.log('🔧 Generating Prisma Client...');
execSync('npx prisma generate', { stdio: 'inherit' });

console.log('✅ Build complete');


