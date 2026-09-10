const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareChromiumEnvironment } = require('../lib/chromium-environment');

test('Vercel launch environment contains actual bundled NSS libraries without AWS markers', async () => {
  const original = { VERCEL: '1', LD_LIBRARY_PATH: '/existing/lib', FONTCONFIG_PATH: '/existing/fonts' };
  const [first, second] = await Promise.all([
    prepareChromiumEnvironment(original, 'linux'),
    prepareChromiumEnvironment(original, 'linux')
  ]);
  assert.deepEqual(first, second);
  const libraryDirectory = first.LD_LIBRARY_PATH.split(':')[0];
  assert.ok(fs.existsSync(path.join(libraryDirectory, 'libnss3.so')));
  assert.ok(first.LD_LIBRARY_PATH.endsWith(':/existing/lib'));
  assert.equal(first.FONTCONFIG_PATH, '/existing/fonts');
  assert.equal(original.LD_LIBRARY_PATH, '/existing/lib');
});

test('local and non-Vercel environments are preserved', async () => {
  assert.deepEqual(await prepareChromiumEnvironment({ TEST: 'local' }, 'darwin'), { TEST: 'local' });
  assert.deepEqual(await prepareChromiumEnvironment({ TEST: 'linux' }, 'linux'), { TEST: 'linux' });
});
