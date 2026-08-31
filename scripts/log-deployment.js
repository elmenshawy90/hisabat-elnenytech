const fs = require('fs');
const path = require('path');

const MAX_LOG_ENTRIES = 50;
const logFilePath = path.join(__dirname, '..', 'deployment-log.json');

function logDeployment() {
  let logs = [];

  if (fs.existsSync(logFilePath)) {
    try {
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      if (Array.isArray(parsed)) {
        logs = parsed;
      }
    } catch (err) {
      console.warn('[log-deployment] Warning: Could not parse existing deployment-log.json. Starting fresh.', err.message);
      logs = [];
    }
  }

  const newEntry = {
    timestamp: new Date().toISOString(),
    status: 'success'
  };

  logs.push(newEntry);

  // Cap at MAX_LOG_ENTRIES (keep latest 50)
  if (logs.length > MAX_LOG_ENTRIES) {
    logs = logs.slice(logs.length - MAX_LOG_ENTRIES);
  }

  fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2), 'utf8');
  console.log(`📝 [log-deployment] Logged new deployment at ${newEntry.timestamp}. Total entries: ${logs.length}`);
}

logDeployment();
