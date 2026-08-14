const serverless = require('serverless-http');
const fs = require('fs');
const path = require('path');

const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT;

if (isServerless && (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:'))) {
  const tmpDbPath = path.join('/tmp', 'dev.db');

  if (!fs.existsSync(tmpDbPath)) {
    const candidatePaths = [
      path.join(__dirname, '../prisma/dev.db'),
      path.join(__dirname, '../../prisma/dev.db'),
      path.join(process.cwd(), 'prisma/dev.db'),
      path.join(process.cwd(), 'dev.db')
    ];

    for (const src of candidatePaths) {
      if (fs.existsSync(src)) {
        try {
          fs.copyFileSync(src, tmpDbPath);
          break;
        } catch (e) {
          console.error('Error copying db to /tmp:', e);
        }
      }
    }
  }

  process.env.DATABASE_URL = `file:${tmpDbPath}`;
}

const app = require('../server');

module.exports = serverless(app);
