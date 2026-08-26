const { execSync } = require('child_process');
const fs = require('fs');

console.log('📝 Writing deployment info...');
const deployInfo = { deployedAt: new Date().toISOString() };
fs.writeFileSync('deployment-info.json', JSON.stringify(deployInfo, null, 2));

console.log('🔧 Generating Prisma Client...');
execSync('npx prisma generate', { stdio: 'inherit' });

console.log('✅ Build complete');

