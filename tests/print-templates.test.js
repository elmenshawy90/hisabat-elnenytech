const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const printDirectory = path.join(__dirname, '..', 'views', 'print');
const common = {
  toEnglishDigits: value => String(value ?? '').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660)),
  logoDataUri: 'data:image/svg+xml;base64,PHN2Zy8+',
  fontDataBase64: 'AA==',
  boldFontDataBase64: 'AA==',
  printDate: '١٠/٩/٢٠٢٦',
  formatCurrency: value => `${Number(value).toFixed(2)} ج.م`,
  formatDate: () => '١٠/٩/٢٠٢٦'
};

async function render(name, data) {
  return ejs.renderFile(path.join(printDirectory, `${name}.ejs`), { ...common, ...data });
}

test('all print templates render the shared brand header', async () => {
  const client = { name: 'عميل تجريبي', phone: '01000000000', invoices: [] };
  const invoice = {
    id: 1,
    invoiceCode: 'INV-1',
    date: new Date(),
    type: 'purchase',
    amount: 100,
    paidAmount: 0,
    discountAmount: 0,
    clientName: client.name,
    items: [],
    services: []
  };
  const templates = [
    ['clients-list', { clients: [], totalDebt: 0, clearClientsCount: 0 }],
    ['invoices-list', { invoices: [], totalPurchases: 0, totalPayments: 0 }],
    ['client-statement', { client, invoices: [], totalPurchases: 0, totalPayments: 0, currentBalance: 0, firstTxDate: '-', lastTxDate: '-' }],
    ['invoice-receipt', { invoice }]
  ];

  for (const [name, data] of templates) {
    const html = await render(name, data);
    assert.match(html, /class="brand-logo"/);
    assert.match(html, /data:image\/svg\+xml;base64/);
    assert.match(html, /نظام حسابات/);
  }
});

test('invoice items keep the approved RTL column sequence', async () => {
  const html = await render('invoice-receipt', {
    invoice: {
      id: 1,
      invoiceCode: 'INV-1',
      date: new Date(),
      type: 'purchase',
      amount: 250,
      paidAmount: 0,
      discountAmount: 0,
      clientName: 'عميل تجريبي',
      items: [{ quantity: 2, unitPrice: 125, lineTotal: 250, item: { name: 'أسمنت' }, itemUnit: { name: 'طن' } }],
      services: []
    }
  });
  const header = html.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)?.[1] || '';
  const labels = ['الكمية', 'الوحدة', 'الصنف', 'سعر الوحدة', 'الإجمالي'];
  const positions = labels.map(label => header.indexOf(label));

  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});
