const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/shared-ui.js'), 'utf8'), ctx);

test('HTML escaping protects text and both quote styles without losing Arabic', () => {
  assert.equal(ctx.escapeHtml('أحمد <img src=x> & "شركة" \'نقل\''), 'أحمد &lt;img src=x&gt; &amp; &quot;شركة&quot; &#39;نقل&#39;');
  assert.equal(ctx.escapeHtml(null), '');
});

test('highlighting escapes matched and unmatched input while preserving search markup', () => {
  for (const query of ['', '   ', 'أحمد', '<img', 'onerror', '&', '[.*]']) {
    const result = ctx.highlightArabic('أحمد <img src=x onerror=alert(1)> & [.*]', query);
    assert.ok(!result.includes('<img'));
    assert.ok(!result.includes('onerror=alert(1)>'));
    assert.ok(result.includes('&amp;'));
  }
  assert.match(ctx.highlightArabic('أحمد وإبراهيم', 'احمد ابراهيم'), /<span[^>]+>أحمد<\/span>/);
});

test('inline string encoding cannot escape HTML attributes or JavaScript strings', () => {
  for (const value of ["');globalThis.pwned=true;//", '&#39;);alert(1);//', '\\" onmouseover="alert(1)', 'أحمد\n\r\u2028😀</script>']) {
    const encoded = ctx.escapeJsString(value);
    assert.match(encoded, /^(?:\\u[0-9a-f]{4})*$/);
    assert.equal(vm.runInNewContext(`'${encoded}'`), value);
  }
});

test('all EJS templates and inline JavaScript compile', () => {
  const ejs = require('ejs');
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.ejs')) {
        const source = fs.readFileSync(file, 'utf8');
        ejs.compile(source, { filename: file });
        for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
          if (match[1].trim() && !match[1].includes('<%')) new vm.Script(match[1], { filename: file });
        }
      }
    }
  }
  walk(path.join(__dirname, '../views'));
});
