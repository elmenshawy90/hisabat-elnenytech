const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function handler(file, route, method, db) {
  const filename = path.join(__dirname, '../routes', file);
  const realRequire = createRequire(filename);
  const ctx = vm.createContext({ console, module: { exports: {} }, require(name) {
    if (name === '../lib/prisma') return db;
    if (name === '../lib/balance') return { getClientBalance: async () => 80 };
    return realRequire(name);
  } });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx);
  return ctx.module.exports.stack.find(l => l.route?.path === route && l.route.methods[method]).route.stack[0].handle;
}
function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; } };
}
test('editing client data saves page number and cannot create an opening balance', async () => {
  let saved;
  const db = { client: { update: async ({ data }) => { saved = data; return { id: 1, ...data }; } } };
  const res = response();
  await handler('clients.js', '/:id', 'put', db)({ params: { id: '1' }, body: { name: 'Test', pageNumber: 42, openingBalance: 100, openingBalanceType: 'debit' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.pageNumber, 42);
  assert.equal(saved.openingBalance, undefined);
  assert.equal(res.data.balance, 80);
});
test('invoice details and list expose the linked client page while preserving list client ID', async () => {
  const invoice = { id: 2, clientId: 1, client: { pageNumber: 42 } };
  const check = ({ include }) => { assert.equal(include.client.select.pageNumber, true); return invoice; };
  const db = { invoice: { count: async () => 1, findUnique: async args => check(args), findMany: async args => [check(args)] } };
  const single = response();
  await handler('invoices.js', '/:id', 'get', db)({ params: { id: '2' } }, single);
  assert.equal(single.data.clientPageNumber, 42);
  const list = response();
  await handler('invoices.js', '/', 'get', db)({ query: {} }, list);
  assert.equal(list.data.data[0].clientPageNumber, 42);
  assert.equal(list.data.data[0].client, 1);
});
