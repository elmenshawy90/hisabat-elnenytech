// Decrypts to a NEW local file only. Does not connect to or restore a database.
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
async function decrypt(input, output, key) {
  if (!/^[a-f\d]{64}$/i.test(key || '')) throw new Error('A 32-byte hex BACKUP_ENCRYPTION_KEY is required');
  const source = await fs.open(input, 'r');
  let created = false;
  try {
    const { size } = await source.stat();
    const header = Buffer.alloc(20); const tag = Buffer.alloc(16);
    await source.read(header, 0, 20, 0); await source.read(tag, 0, 16, size - 16);
    if (size < 37 || header.subarray(0, 8).toString() !== 'HISABAK1') throw new Error('Invalid backup format');
    const destination = await fs.open(output, 'wx', 0o600); await destination.close(); created = true;
    const cipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), header.subarray(8)); cipher.setAuthTag(tag);
    await pipeline(createReadStream(input, { start: 20, end: size - 17 }), cipher, createWriteStream(output, { flags: 'w', mode: 0o600 }));
  } catch (e) { if (created) await fs.rm(output, { force: true }); throw e; }
  finally { await source.close(); }
}
module.exports = { decrypt };
if (require.main === module) decrypt(process.argv[2], process.argv[3], process.env.BACKUP_ENCRYPTION_KEY).then(() => console.log('Decrypted. No database was modified.')).catch(() => { console.error('Decryption failed. Check key, input, and that output does not already exist.'); process.exitCode = 1; });
