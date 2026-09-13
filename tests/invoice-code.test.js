const test = require('node:test');
const assert = require('node:assert/strict');
const { nextInvoiceCode } = require('../lib/invoice-code');

test('monthly invoice numbering pads digits, rolls over months/years and continues existing counters', async () => {
  const counters = new Map([['invoice-2608', 99]]);
  const tx = { counter: { upsert: async ({ where, create, update }) => {
    const value = counters.has(where.id) ? counters.get(where.id) + update.value.increment : create.value;
    counters.set(where.id, value);
    return { value };
  } } };
  assert.equal(await nextInvoiceCode(tx, new Date(2026, 8, 10)), '2609-01');
  assert.equal(await nextInvoiceCode(tx, new Date(2026, 8, 11)), '2609-02');
  assert.equal(await nextInvoiceCode(tx, new Date(2026, 9, 1)), '2610-01');
  assert.equal(await nextInvoiceCode(tx, new Date(2027, 0, 1)), '2701-01');
  assert.equal(await nextInvoiceCode(tx, new Date(2026, 7, 1)), '2608-100');
});
