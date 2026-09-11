const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');

function fixture() {
  const filename = path.join(__dirname, '../routes/invoices.js');
  const realRequire = createRequire(filename);
  const writes = [];
  const db = {
    client: { findUnique: async () => ({ id: 1, name: 'Test', phone: '-' }), update: async () => ({ id: 1 }) },
    itemUnit: { findUnique: async () => ({ itemId: 1, conversionRate: 1, item: { name: 'Test' } }) },
    counter: { upsert: async () => ({ value: 1 }) },
    invoiceService: {},
    invoice: { create: async ({ data }) => { writes.push(data); return { id: writes.length, ...data }; } }
  };
  db.$transaction = async callback => callback(db);
  const ctx = vm.createContext({ console, module: { exports: {} }, require(name) {
    if (name === '../lib/prisma') return db;
    if (name === '../lib/balance') return { getClientBalance: async () => 0 };
    if (name === '../lib/stock') return { checkStockAvailability: async () => ({ sufficient: true }), deductStock: async () => {} };
    return realRequire(name);
  }});
  vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx);
  const handler = ctx.module.exports.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack[0].handle;
  return { writes, async send(body) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; } };
    await handler({ body: { client: 1, clientId: 1, ...body } }, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.data));
    return res.data;
  }};
}

test('purchase rounds prices, each fractional-quantity line, discount, services and linked payment', async () => {
  const f = fixture();
  await f.send({ type: 'purchase', items: [
    { itemId: 1, itemUnitId: 1, quantity: 0.5, unitPrice: 11.4 },
    { itemId: 1, itemUnitId: 1, quantity: 0.5, unitPrice: 11.4 }
  ], services: [{ name: 'Delivery', price: 2.6 }], discountType: 'percentage', discountValue: 10, paidAmount: 4.5 });
  const purchase = f.writes[0];
  assert.equal(purchase.items.create[0].quantity, 0.5);
  assert.equal(purchase.items.create[0].unitPrice, 11);
  assert.equal(purchase.items.create[0].lineTotal, 6);
  assert.equal(purchase.discountAmount, 1);
  assert.equal(purchase.services.create[0].price, 3);
  assert.equal(purchase.amount, 14);
  assert.equal(purchase.paidAmount, 5);
  assert.equal(f.writes[1].amount, 5);
});

test('payments round to nearest pound before calculating percentage discounts', async () => {
  const f = fixture();
  await f.send({ type: 'payment', amount: 14.6, discountType: 'percentage', discountValue: 10 });
  assert.equal(f.writes[0].amount, 13);
  assert.equal(f.writes[0].discountAmount, 2);
});
