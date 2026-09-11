const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/shared-ui.js'), 'utf8'), ctx);

test('currency and dates retain Arabic labels with Latin digits', () => {
  assert.equal(ctx.formatCurrency(1234.5), '1,235 ج.م');
  assert.equal(ctx.formatCurrency(1234.49), '1,234 ج.م');
  const date = ctx.formatDate('2026-09-10T12:00:00Z');
  assert.match(date, /10/);
  assert.match(date, /2026/);
  assert.doesNotMatch(date, /[٠-٩۰-۹]/);
});

test('phone normalization preserves leading zeros and converts both digit sets', () => {
  assert.equal(ctx.toEnglishDigits('٠١٠۱۲۳٤٥٦٧٨'), '01012345678');
  assert.equal(ctx.toEnglishDigits('01012345678'), '01012345678');
});
