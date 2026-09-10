const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let preparation;

// Chromium 131 only auto-detects selected AWS runtimes. Vercel can omit those
// markers, so explicitly unpack its bundled AL2023 libraries before launch.
async function prepareChromiumEnvironment(env = process.env, platform = process.platform) {
  if (platform !== 'linux' || !env.VERCEL) return { ...env };
  if (!preparation) {
    preparation = (async () => {
      const { default: LambdaFS } = require('@sparticuz/chromium/build/lambdafs');
      const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '..', 'bin', 'al2023.tar.br');
      const directory = await LambdaFS.inflate(archive);
      const libraryPath = path.join(directory, 'lib');
      await fs.promises.access(path.join(libraryPath, 'libnss3.so'));
      return libraryPath;
    })().catch(error => {
      preparation = undefined;
      throw error;
    });
  }
  const libraryPath = await preparation;
  return {
    ...env,
    FONTCONFIG_PATH: env.FONTCONFIG_PATH || path.join(os.tmpdir(), 'fonts'),
    LD_LIBRARY_PATH: [...new Set([libraryPath, ...(env.LD_LIBRARY_PATH || '').split(':').filter(Boolean)])].join(':')
  };
}

module.exports = { prepareChromiumEnvironment };
