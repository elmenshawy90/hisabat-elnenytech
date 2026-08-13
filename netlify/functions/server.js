const serverless = require('serverless-http');
const app = require('../../server');

// Wrap Express app with serverless handler for Netlify Functions
module.exports.handler = serverless(app);
