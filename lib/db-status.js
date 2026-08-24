/**
 * Checks database connection status and measures response latency
 * @param {Object} prisma Prisma client instance
 * @returns {Promise<Object>} Status object { connected, latencyMs, error }
 */
async function getDatabaseStatus(prisma) {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return {
      connected: true,
      latencyMs
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    let cleanError = err.message || 'فشل الاتصال بقاعدة البيانات';

    // Sanitize error message to prevent leaking sensitive connection strings or passwords
    cleanError = cleanError.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_CONNECTION_STRING]');
    cleanError = cleanError.replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, '[REDACTED_CONNECTION_STRING]');
    cleanError = cleanError.replace(/(password|passwd|pwd)=([^\s&"']+)/gi, '$1=[REDACTED]');

    if (cleanError.length > 250) {
      cleanError = cleanError.substring(0, 250) + '...';
    }

    return {
      connected: false,
      latencyMs,
      error: cleanError
    };
  }
}

module.exports = { getDatabaseStatus };
