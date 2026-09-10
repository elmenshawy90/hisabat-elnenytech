function getSessionSecret(env = process.env) {
  const secret = env.SESSION_SECRET;
  if (typeof secret !== 'string' || !secret.trim() ||
      ['hisabat-production-fallback-secret-2026', 'fallback-secret-for-dev'].includes(secret)) {
    throw new Error('SESSION_SECRET must be configured with a private signing secret before starting the server.');
  }
  return secret;
}

module.exports = { getSessionSecret };
