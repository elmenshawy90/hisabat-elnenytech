const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const ArabicReshaper = require('arabic-reshaper');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getAllClientBalances } = require('../lib/balance');
const ejs = require('ejs');

// Helper to lazily load puppeteer and chromium so app startup on Vercel is 100% stable
async function getPuppeteerAndChromium() {
  const { default: puppeteer } = await import('puppeteer-core');
  const chromium = require('@sparticuz/chromium');
  return { puppeteer, chromium };
}

async function getChromiumExecutablePath(chromium) {
  if (process.platform === 'darwin') {
    const macPaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
    for (const p of macPaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (process.platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of winPaths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return await chromium.executablePath();
}

async function launchPuppeteerBrowser(puppeteer, chromium, defaultViewport = null) {
  const isLocal = process.platform === 'darwin' || process.platform === 'win32';
  const executablePath = await getChromiumExecutablePath(chromium);
  const args = isLocal ? ['--no-sandbox', '--disable-setuid-sandbox'] : chromium.args;
  const headless = isLocal ? true : chromium.headless;

  return await puppeteer.launch({
    args,
    defaultViewport: defaultViewport || chromium.defaultViewport,
    executablePath,
    headless
  });
}

let cachedPrintAssets = null;

function getPrintAssets() {
  if (!cachedPrintAssets) {
    const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.svg');
    const fontPath = path.join(__dirname, '..', 'public', 'fonts', 'Tahoma.ttf');
    cachedPrintAssets = {
      logoDataUri: `data:image/svg+xml;base64,${fs.readFileSync(logoPath).toString('base64')}`,
      fontDataBase64: fs.readFileSync(fontPath).toString('base64')
    };
  }
  return cachedPrintAssets;
}

async function renderPrintTemplate(templateName, data) {
  const templatePath = path.join(__dirname, '..', 'views', 'print', `${templateName}.ejs`);
  return ejs.renderFile(templatePath, { ...data, ...getPrintAssets() });
}

const EXCEL_COLORS = {
  brand: 'FF006840',
  brandDark: 'FF064F35',
  brandSoft: 'FFE8F3EE',
  gold: 'FFD9AD55',
  white: 'FFFFFFFF',
  ink: 'FF17211D',
  muted: 'FF718078',
  line: 'FFDCE5E0'
};

function addExcelDocumentHeader(workbook, worksheet, { title, subtitle, lastColumn }) {
  const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png');
  if (fs.existsSync(logoPath)) {
    const logoId = workbook.addImage({ filename: logoPath, extension: 'png' });
    worksheet.addImage(logoId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 58, height: 58 } });
  }

  worksheet.mergeCells(`B1:${lastColumn}1`);
  worksheet.mergeCells(`B2:${lastColumn}2`);
  worksheet.getCell('B1').value = title;
  worksheet.getCell('B1').font = { bold: true, size: 18, color: { argb: EXCEL_COLORS.white } };
  worksheet.getCell('B2').value = subtitle;
  worksheet.getCell('B2').font = { size: 10, color: { argb: EXCEL_COLORS.white } };
  worksheet.getCell('B1').alignment = worksheet.getCell('B2').alignment = { horizontal: 'right', vertical: 'middle' };
  worksheet.getRow(1).height = 34;
  worksheet.getRow(2).height = 22;

  for (let row = 1; row <= 2; row += 1) {
    for (let col = 1; col <= worksheet.getColumn(lastColumn).number; col += 1) {
      worksheet.getCell(row, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.brand } };
    }
  }
  worksheet.getRow(3).height = 8;
}

function styleExcelTable(worksheet, headerRowNumber, lastColumnNumber) {
  const headerRow = worksheet.getRow(headerRowNumber);
  headerRow.height = 26;
  headerRow.font = { bold: true, color: { argb: EXCEL_COLORS.white } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_COLORS.brandDark } };
    cell.border = { bottom: { style: 'thin', color: { argb: EXCEL_COLORS.gold } } };
  });

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    row.height = 23;
    row.alignment = { vertical: 'middle', horizontal: 'right' };
    for (let col = 1; col <= lastColumnNumber; col += 1) {
      const cell = row.getCell(col);
      cell.border = { bottom: { style: 'hair', color: { argb: EXCEL_COLORS.line } } };
      if ((rowNumber - headerRowNumber) % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAF9' } };
      }
    }
  }

  worksheet.autoFilter = { from: { row: headerRowNumber, column: 1 }, to: { row: headerRowNumber, column: lastColumnNumber } };
  worksheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: headerRowNumber }];
}



// Apply auth middleware
router.use(requireAuth);

// Helper to format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP'
  }).format(amount);
};

// Helper to format date safely
const formatDate = (d) => {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' });
};

// GET /api/export/clients/excel - Export all clients
router.get('/clients/excel', async (req, res) => {
  try {
    const [clients, balanceMap] = await Promise.all([
      prisma.client.findMany({
        orderBy: { name: 'asc' }
      }),
      getAllClientBalances(prisma)
    ]);
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('العملاء', { views: [{ rightToLeft: true }] });
    
    worksheet.columns = [
      { key: 'name', width: 30 },
      { key: 'phone', width: 20 },
      { key: 'balance', width: 25 },
      { key: 'createdAt', width: 20 },
      { key: 'lastTransaction', width: 20 }
    ];
    addExcelDocumentHeader(workbook, worksheet, {
      title: 'قائمة العملاء',
      subtitle: `تقرير أرصدة العملاء — ${formatDate(new Date())}`,
      lastColumn: 'E'
    });
    worksheet.getRow(4).values = ['اسم العميل', 'رقم الهاتف', 'الرصيد المستحق (ج.م)', 'تاريخ الإضافة', 'آخر معاملة'];

    clients.forEach(client => {
      worksheet.addRow({
        name: client.name,
        phone: client.phone,
        balance: balanceMap.get(client.id) || 0,
        createdAt: formatDate(client.createdAt),
        lastTransaction: formatDate(client.updatedAt)
      });
    });
    styleExcelTable(worksheet, 4, 5);
    worksheet.getColumn(3).numFmt = '#,##0.00 "ج.م"';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="clients.xlsx"');
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'فشل في تصدير البيانات' });
  }
});

// GET /api/export/clients/pdf - Export all clients as PDF
router.get('/clients/pdf', async (req, res) => {
  let browser = null;
  try {
    const { puppeteer, chromium } = await getPuppeteerAndChromium();

    const [rawClients, balanceMap] = await Promise.all([
      prisma.client.findMany({ orderBy: { name: 'asc' } }),
      getAllClientBalances(prisma)
    ]);

    const clients = rawClients.map(c => ({
      ...c,
      balance: balanceMap.get(c.id) || 0
    }));

    const totalDebt = clients.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
    const clearClientsCount = clients.filter(c => c.balance <= 0).length;
    const printDate = formatDate(new Date());

    const html = await renderPrintTemplate('clients-list', {
      clients,
      totalDebt,
      clearClientsCount,
      printDate,
      formatCurrency,
      formatDate
    });

    browser = await launchPuppeteerBrowser(puppeteer, chromium);

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    }));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="clients-list.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Clients PDF export error:', err);
    res.status(500).send('فشل في تصدير قائمة العملاء كـ PDF');
  } finally {
    if (browser) await browser.close();
  }
});

// GET /api/export/clients/image - Export all clients as PNG
router.get('/clients/image', async (req, res) => {
  let browser = null;
  try {
    const { puppeteer, chromium } = await getPuppeteerAndChromium();

    const [rawClients, balanceMap] = await Promise.all([
      prisma.client.findMany({ orderBy: { name: 'asc' } }),
      getAllClientBalances(prisma)
    ]);

    const clients = rawClients.map(c => ({
      ...c,
      balance: balanceMap.get(c.id) || 0
    }));

    const totalDebt = clients.reduce((sum, c) => sum + (c.balance > 0 ? c.balance : 0), 0);
    const clearClientsCount = clients.filter(c => c.balance <= 0).length;
    const printDate = formatDate(new Date());

    const html = await renderPrintTemplate('clients-list', {
      clients,
      totalDebt,
      clearClientsCount,
      printDate,
      formatCurrency,
      formatDate
    });

    browser = await launchPuppeteerBrowser(puppeteer, chromium, { width: 950, height: 1200, deviceScaleFactor: 2 });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: 'body { background: #fff !important; } .document { margin: 0 auto !important; box-shadow: none !important; }' });

    const screenshotBuffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="clients-list.png"');
    res.send(screenshotBuffer);
  } catch (err) {
    console.error('Clients PNG export error:', err);
    res.status(500).send('فشل في تصدير قائمة العملاء كصورة');
  } finally {
    if (browser) await browser.close();
  }
});


// GET /api/export/invoices/excel - Export invoices
router.get('/invoices/excel', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      orderBy: { date: 'desc' },
      include: { client: true }
    });
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('الفواتير والمعاملات', { views: [{ rightToLeft: true }] });
    
    worksheet.columns = [
      { key: 'date', width: 15 },
      { key: 'clientName', width: 30 },
      { key: 'clientPhone', width: 20 },
      { key: 'type', width: 15 },
      { key: 'amount', width: 20 },
      { key: 'details', width: 40 }
    ];
    addExcelDocumentHeader(workbook, worksheet, {
      title: 'سجل الفواتير والمعاملات',
      subtitle: `تقرير شامل — ${formatDate(new Date())}`,
      lastColumn: 'F'
    });
    worksheet.getRow(4).values = ['التاريخ', 'اسم العميل', 'رقم الهاتف', 'النوع', 'المبلغ (ج.م)', 'التفاصيل'];

    invoices.forEach(inv => {
      worksheet.addRow({
        date: formatDate(inv.date),
        clientName: inv.clientName,
        clientPhone: inv.clientPhone || '-',
        type: inv.type === 'purchase' ? 'شراء' : 'دفع',
        amount: inv.amount,
        details: inv.details || '-'
      });
    });
    styleExcelTable(worksheet, 4, 6);
    worksheet.getColumn(5).numFmt = '#,##0.00 "ج.م"';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"');
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'فشل في تصدير البيانات' });
  }
});

// GET /api/export/invoices/pdf - Export invoices as PDF
router.get('/invoices/pdf', async (req, res) => {
  let browser = null;
  try {
    const { puppeteer, chromium } = await getPuppeteerAndChromium();

    const invoices = await prisma.invoice.findMany({
      orderBy: { date: 'desc' },
      include: { client: true }
    });

    let totalPurchases = 0;
    let totalPayments = 0;
    for (const inv of invoices) {
      if (inv.type === 'purchase') totalPurchases += inv.amount;
      else if (inv.type === 'payment') totalPayments += inv.amount;
    }

    const printDate = formatDate(new Date());
    const html = await renderPrintTemplate('invoices-list', {
      invoices,
      totalPurchases,
      totalPayments,
      printDate,
      formatCurrency,
      formatDate
    });

    browser = await launchPuppeteerBrowser(puppeteer, chromium);

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
    }));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices-list.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Invoices PDF export error:', err);
    res.status(500).send('فشل في تصدير سجل الفواتير كـ PDF');
  } finally {
    if (browser) await browser.close();
  }
});

// GET /api/export/invoices/image - Export invoices as PNG
router.get('/invoices/image', async (req, res) => {
  let browser = null;
  try {
    const { puppeteer, chromium } = await getPuppeteerAndChromium();

    const invoices = await prisma.invoice.findMany({
      orderBy: { date: 'desc' },
      include: { client: true }
    });

    let totalPurchases = 0;
    let totalPayments = 0;
    for (const inv of invoices) {
      if (inv.type === 'purchase') totalPurchases += inv.amount;
      else if (inv.type === 'payment') totalPayments += inv.amount;
    }

    const printDate = formatDate(new Date());
    const html = await renderPrintTemplate('invoices-list', {
      invoices,
      totalPurchases,
      totalPayments,
      printDate,
      formatCurrency,
      formatDate
    });

    browser = await launchPuppeteerBrowser(puppeteer, chromium, { width: 950, height: 1200, deviceScaleFactor: 2 });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.addStyleTag({ content: 'body { background: #fff !important; } .document { margin: 0 auto !important; box-shadow: none !important; }' });

    const screenshotBuffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices-list.png"');
    res.send(screenshotBuffer);
  } catch (err) {
    console.error('Invoices PNG export error:', err);
    res.status(500).send('فشل في تصدير سجل الفواتير كصورة');
  } finally {
    if (browser) await browser.close();
  }
});


// GET /api/export/client/:id/excel - Export single client statement to Excel
router.get('/client/:id/excel', async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).json({ error: 'معرف العميل غير صالح' });
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        invoices: {
          include: {
            items: {
              include: {
                item: true,
                itemUnit: true
              }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }

    // 1. Calculate true chronological running balance
    const chronological = [...client.invoices].sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      if (dateA !== dateB) return dateA - dateB;
      const createdA = new Date(a.createdAt || 0).getTime() || (Number(a.id) || 0);
      const createdB = new Date(b.createdAt || 0).getTime() || (Number(b.id) || 0);
      if (createdA !== createdB) return createdA - createdB;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    let running = 0;
    let totalPurchases = 0;
    let totalPayments = 0;
    for (const inv of chronological) {
      if (inv.type === 'purchase') {
        running += inv.amount;
        totalPurchases += inv.amount;
      } else if (inv.type === 'payment') {
        running -= inv.amount;
        totalPayments += inv.amount;
      }
      inv.runningBalance = running;
    }

    const currentBalance = running;
    const displayInvoices = [...chronological].reverse(); // Newest first for report

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('كشف حساب', { views: [{ rightToLeft: true }] });

    addExcelDocumentHeader(workbook, worksheet, {
      title: `كشف حساب - ${client.name}`,
      subtitle: `حركة الحساب حتى ${formatDate(new Date())}`,
      lastColumn: 'F'
    });

    worksheet.addRow(['رقم الهاتف:', client.phone || '-', '', 'تاريخ التقرير:', formatDate(new Date()), '']);
    worksheet.addRow(['إجمالي المشتريات:', totalPurchases, 'ج.م', 'إجمالي المدفوعات:', totalPayments, 'ج.م']);
    worksheet.addRow(['الرصيد المستحق:', currentBalance, 'ج.م', 'عدد العمليات:', client.invoices.length, '']);
    worksheet.addRow([]);

    // Table Header
    const headerRowNumber = 8;
    worksheet.getRow(headerRowNumber).values = [
      'التاريخ',
      'النوع',
      'المبلغ (ج.م)',
      'البيان / التفاصيل',
      'العميل النهائي',
      'الرصيد بعد العملية (ج.م)'
    ];
    worksheet.columns = [
      { key: 'date', width: 16 },
      { key: 'type', width: 14 },
      { key: 'amount', width: 18 },
      { key: 'details', width: 35 },
      { key: 'endClientName', width: 22 },
      { key: 'runningBalance', width: 22 }
    ];

    displayInvoices.forEach((inv) => {
      const isPurchase = inv.type === 'purchase';
      const row = worksheet.addRow([
        formatDate(inv.date),
        isPurchase ? 'شراء' : 'دفع',
        inv.amount,
        inv.details || '-',
        inv.endClientName || '-',
        inv.runningBalance
      ]);
      row.alignment = { vertical: 'middle', horizontal: 'right' };
      row.getCell(2).alignment = { horizontal: 'center' };
      if (!isPurchase) {
        row.getCell(2).font = { color: { argb: 'FF16A34A' }, bold: true };
      }
    });
    styleExcelTable(worksheet, headerRowNumber, 6);
    worksheet.getColumn(3).numFmt = '#,##0.00 "ج.م"';
    worksheet.getColumn(6).numFmt = '#,##0.00 "ج.م"';

    const safeName = (client.name || 'client').replace(/[\\/:*?"<>|]/g, '_');
    const filename = `client-statement-${safeName}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="client-statement.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Client Excel export error:', err);
    res.status(500).json({ error: 'فشل في تصدير كشف الحساب' });
  }
});

// GET /api/export/client/:id/pdf - Export single client statement to PDF
router.get('/client/:id/pdf', async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).send('معرف العميل غير صالح');
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        invoices: {
          include: {
            items: {
              include: {
                item: true,
                itemUnit: true
              }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).send('العميل غير موجود');
    }

    // 1. Calculate true chronological running balance
    const chronological = [...client.invoices].sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      if (dateA !== dateB) return dateA - dateB;
      const createdA = new Date(a.createdAt || 0).getTime() || (Number(a.id) || 0);
      const createdB = new Date(b.createdAt || 0).getTime() || (Number(b.id) || 0);
      if (createdA !== createdB) return createdA - createdB;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    let running = 0;
    let totalPurchases = 0;
    let totalPayments = 0;
    for (const inv of chronological) {
      if (inv.type === 'purchase') {
        running += inv.amount;
        totalPurchases += inv.amount;
      } else if (inv.type === 'payment') {
        running -= inv.amount;
        totalPayments += inv.amount;
      }
      inv.runningBalance = running;
    }

    const currentBalance = running;
    const displayInvoices = [...chronological].reverse(); // Newest first for report
    const printDate = formatDate(new Date());

    // Use the same branded HTML document for PDF and image exports.
    // The PDFKit renderer below remains a fallback for environments where Chromium cannot start.
    let htmlBrowser = null;
    try {
      const { puppeteer, chromium } = await getPuppeteerAndChromium();
      const firstTxDate = displayInvoices.length > 0 ? formatDate(displayInvoices[displayInvoices.length - 1].date) : '-';
      const lastTxDate = displayInvoices.length > 0 ? formatDate(displayInvoices[0].date) : '-';
      const html = await renderPrintTemplate('client-statement', {
        client,
        invoices: displayInvoices,
        totalPurchases,
        totalPayments,
        currentBalance,
        firstTxDate,
        lastTxDate,
        printDate,
        formatCurrency,
        formatDate
      });

      htmlBrowser = await launchPuppeteerBrowser(puppeteer, chromium);
      const page = await htmlBrowser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = Buffer.from(await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
      }));

      const safeName = (client.name || 'client').replace(/[\\/:*?"<>|]/g, '_');
      const filename = `client-statement-${safeName}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="client-statement.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.status(200).send(pdfBuffer);
    } catch (htmlPdfError) {
      console.warn('Branded HTML PDF failed; using PDFKit fallback:', htmlPdfError.message);
    } finally {
      if (htmlBrowser) await htmlBrowser.close();
    }

    // Generate PDF via PDFKit
    const doc = new PDFDocument({
      size: 'A4',
      margin: 30,
      info: {
        Title: `كشف حساب - ${client.name}`,
        Author: 'حسابات'
      }
    });

    // Prefer a font bundled with the project so Arabic text renders correctly in both local and serverless environments.
    const projectFont = path.join(__dirname, '..', 'public', 'fonts', 'Tahoma.ttf');
    const possibleFonts = [
      projectFont,
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf'
    ];
    const systemFont = possibleFonts.find(p => fs.existsSync(p));
    if (systemFont) {
      doc.font(systemFont);
    }

    const shapeArabic = (text) => {
      if (text === null || text === undefined) return '-';
      const str = String(text);
      if (!/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(str)) {
        return str;
      }
      return ArabicReshaper.convertArabic(str);
    };

    const drawRtlText = (text, x, y, width, align = 'right') => {
      const shaped = shapeArabic(text);
      doc.text(shaped, x, y, {
        width,
        align,
        lineGap: 0,
        ellipsis: false
      });
    };

    const drawInfoPair = (label, value, y, leftX, rightWidth, rightLabelX, valueX) => {
      doc.fillColor('#0F172A').fontSize(10);
      drawRtlText(label, rightLabelX, y, rightWidth, 'right');
      drawRtlText(value, valueX, y, leftX - valueX - 8, 'left');
    };

    // Set Response Headers for Instant Download
    const rawName = (client.name || 'client').trim();
    const safeName = rawName
      .normalize('NFKD')
      .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, '_')
      .replace(/[\\/:*?"<>|\s]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'client';
    const filename = `client-statement-${safeName}.pdf`;
    const asciiFilename = `client-statement-${safeName.replace(/[^A-Za-z0-9_.-]/g, '_')}.pdf`;

    const pdfChunks = [];
    doc.on('data', (chunk) => pdfChunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(pdfChunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.status(200).end(pdfBuffer);
    });
    doc.on('error', (pdfErr) => {
      console.error('PDF-generation stream error:', pdfErr);
      if (!res.headersSent) {
        res.status(500).send('فشل في إنشاء ملف PDF');
      } else {
        res.destroy(pdfErr);
      }
    });

    // 1. Header Banner
    doc.rect(30, 30, 535, 48).fill('#006840');
    doc.fillColor('#FFFFFF').fontSize(16);
    drawRtlText(`كشف حساب عميل - ${client.name}`, 40, 40, 515, 'center');
    doc.fontSize(9);
    drawRtlText(`تاريخ التقرير: ${printDate}  |  نظام حسابات لإدارة ديون وتوريدات مواد البناء`, 40, 60, 515, 'center');

    // 2. Client Info Card (matching the Excel statement structure)
    doc.rect(30, 86, 535, 62).fillAndStroke('#F8FAFC', '#CBD5E1');
    drawInfoPair('اسم العميل:', client.name, 95, 300, 120, 175, 300);
    drawInfoPair('رقم الهاتف:', client.phone || '-', 112, 300, 120, 175, 300);
    drawInfoPair('عدد العمليات:', `${displayInvoices.length} معاملة`, 129, 300, 120, 175, 300);

    drawInfoPair('إجمالي المشتريات:', formatCurrency(totalPurchases), 95, 510, 160, 340, 470);
    drawInfoPair('إجمالي المدفوعات:', formatCurrency(totalPayments), 112, 510, 160, 340, 470);
    doc.fillColor(currentBalance > 0 ? '#B91C1C' : '#15803D');
    drawInfoPair('الرصيد المستحق:', formatCurrency(currentBalance), 129, 510, 160, 340, 470);

    // 3. Table Header
    let y = 160;
    doc.rect(30, y, 535, 22).fill('#006840');
    doc.fillColor('#FFFFFF').fontSize(9);
    drawRtlText('التاريخ', 485, y + 6, 75, 'center');
    drawRtlText('النوع', 430, y + 6, 50, 'center');
    drawRtlText('المبلغ', 345, y + 6, 80, 'center');
    drawRtlText('البيان / التفاصيل', 195, y + 6, 145, 'center');
    drawRtlText('العميل النهائي', 110, y + 6, 80, 'center');
    drawRtlText('الرصيد بعد العملية', 35, y + 6, 70, 'center');

    y += 22;

    if (displayInvoices.length === 0) {
      doc.rect(30, y, 535, 30).fillAndStroke('#FFFFFF', '#E2E8F0');
      doc.fillColor('#64748B').fontSize(10).text('لا توجد معاملات مسجلة لهذا العميل', 40, y + 10, { align: 'center', width: 515 });
      y += 30;
    } else {
      // 4. Table Rows
      displayInvoices.forEach((inv, i) => {
        if (y > 750) {
          doc.addPage();
          y = 35;
          if (systemFont) doc.font(systemFont);
          // Redraw Table Header on new page
          doc.rect(30, y, 535, 22).fill('#006840');
          doc.fillColor('#FFFFFF').fontSize(9);
          drawRtlText('التاريخ', 485, y + 6, 75, 'center');
          drawRtlText('النوع', 430, y + 6, 50, 'center');
          drawRtlText('المبلغ', 345, y + 6, 80, 'center');
          drawRtlText('البيان / التفاصيل', 195, y + 6, 145, 'center');
          drawRtlText('العميل النهائي', 110, y + 6, 80, 'center');
          drawRtlText('الرصيد بعد العملية', 35, y + 6, 70, 'center');
          y += 22;
        }

        const isEven = i % 2 === 0;
        if (isEven) {
          doc.rect(30, y, 535, 20).fill('#F8FAFC');
        }

        doc.rect(30, y, 535, 20).stroke('#E2E8F0');
        doc.fillColor('#0F172A').fontSize(8.5);

        const typeLabel = inv.type === 'purchase' ? 'شراء' : 'دفع';
        drawRtlText(formatDate(inv.date), 485, y + 5, 75, 'center');
        doc.fillColor(inv.type === 'payment' ? '#16A34A' : '#0F172A');
        drawRtlText(typeLabel, 430, y + 5, 50, 'center');
        drawRtlText(`${formatCurrency(inv.amount)}`, 345, y + 5, 80, 'center');
        doc.fillColor('#0F172A');
        drawRtlText(inv.details || '-', 195, y + 5, 145, 'center');
        drawRtlText(inv.endClientName || '-', 110, y + 5, 80, 'center');
        doc.fillColor(inv.runningBalance <= 0 ? '#16A34A' : '#006840');
        drawRtlText(`${formatCurrency(inv.runningBalance)}`, 35, y + 5, 70, 'center');

        y += 20;
      });
    }

    // 5. Signatures Footer
    if (y > 720) {
      doc.addPage();
      y = 40;
      if (systemFont) doc.font(systemFont);
    }
    y += 25;
    doc.fillColor('#475569').fontSize(9);
    drawRtlText('توقيع المحاسب المسؤول: .......................................', 40, y, 240, 'right');
    drawRtlText('توقيع المستلم / العميل: .......................................', 300, y, 250, 'right');

    doc.end();
  } catch (err) {
    console.error('Client PDF export error:', err);
    res.status(500).send('فشل في تصدير كشف الحساب: ' + (err.message || ''));
  }
});

// GET /api/export/client/:id/image - Export single client statement as PNG Image using Puppeteer
router.get('/client/:id/image', async (req, res) => {
  let browser = null;
  try {
    const { puppeteer, chromium } = await getPuppeteerAndChromium();

    const clientId = parseInt(req.params.id);
    if (isNaN(clientId)) {
      return res.status(400).send('معرف العميل غير صالح');
    }

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        invoices: {
          include: {
            items: {
              include: {
                item: true,
                itemUnit: true
              }
            }
          }
        }
      }
    });

    if (!client) {
      return res.status(404).send('العميل غير موجود');
    }

    // 1. Calculate true chronological running balance
    const chronological = [...client.invoices].sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      if (dateA !== dateB) return dateA - dateB;
      const createdA = new Date(a.createdAt || 0).getTime() || (Number(a.id) || 0);
      const createdB = new Date(b.createdAt || 0).getTime() || (Number(b.id) || 0);
      if (createdA !== createdB) return createdA - createdB;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    let running = 0;
    let totalPurchases = 0;
    let totalPayments = 0;
    for (const inv of chronological) {
      if (inv.type === 'purchase') {
        running += inv.amount;
        totalPurchases += inv.amount;
      } else if (inv.type === 'payment') {
        running -= inv.amount;
        totalPayments += inv.amount;
      }
      inv.runningBalance = running;
    }

    const currentBalance = running;
    const displayInvoices = [...chronological].reverse();
    const printDate = formatDate(new Date());
    const firstTxDate = displayInvoices.length > 0 ? formatDate(displayInvoices[displayInvoices.length - 1].date) : '-';
    const lastTxDate = displayInvoices.length > 0 ? formatDate(displayInvoices[0].date) : '-';

    // Render HTML template via EJS
    const html = await renderPrintTemplate('client-statement', {
      client,
      invoices: displayInvoices,
      totalPurchases,
      totalPayments,
      currentBalance,
      firstTxDate,
      lastTxDate,
      printDate,
      formatCurrency,
      formatDate
    });

    browser = await launchPuppeteerBrowser(puppeteer, chromium, { width: 900, height: 1200, deviceScaleFactor: 2 });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Hide web action toolbar (.no-print) so image only contains statement content
    await page.addStyleTag({ content: '.no-print { display: none !important; } body { background: #fff !important; } .document { margin: 0 auto !important; box-shadow: none !important; }' });

    const screenshotBuffer = Buffer.from(await page.screenshot({
      fullPage: true,
      type: 'png'
    }));

    const rawName = (client.name || 'client').trim();
    const safeName = rawName
      .normalize('NFKD')
      .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, '_')
      .replace(/[\\/:*?"<>|\s]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'client';
    const filename = `client-statement-${safeName}.png`;
    const asciiFilename = `client-statement-${safeName.replace(/[^A-Za-z0-9_.-]/g, '_')}.png`;

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(200).send(screenshotBuffer);
  } catch (err) {
    console.error('Client Image export error:', err);
    res.status(500).send('فشل في تصدير كشف الحساب كصورة: ' + (err.message || ''));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// GET /api/export/invoice/:id/image - Export single invoice receipt as PNG Image
router.get('/invoice/:id/image', async (req, res) => {
  let browser = null;
  try {
    const { puppeteer, chromium } = await getPuppeteerAndChromium();

    const invoiceId = parseInt(req.params.id);
    if (isNaN(invoiceId)) {
      return res.status(400).send('معرف الفاتورة غير صالح');
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: true,
        endClient: true,
        items: {
          include: {
            item: true,
            itemUnit: true
          }
        },
        ...(prisma.invoiceService ? { services: true } : {})
      }
    });

    if (!invoice) {
      return res.status(404).send('الفاتورة غير موجودة');
    }

    const html = await renderPrintTemplate('invoice-receipt', {
      invoice,
      formatCurrency,
      formatDate
    });

    browser = await launchPuppeteerBrowser(puppeteer, chromium, { width: 800, height: 1000, deviceScaleFactor: 2 });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Hide web action toolbar (.no-print) so image only contains receipt card
    await page.addStyleTag({ content: '.no-print { display: none !important; } body { background: #fff !important; } .document { margin: 0 auto !important; box-shadow: none !important; }' });

    const screenshotBuffer = Buffer.from(await page.screenshot({
      fullPage: true,
      type: 'png'
    }));

    const code = (invoice.invoiceCode || `inv-${invoice.id}`).replace(/[\\/:*?"<>|\s]/g, '_');
    const filename = `invoice-${code}.png`;

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${code}.png"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(200).send(screenshotBuffer);
  } catch (err) {
    console.error('Invoice image export error:', err);
    res.status(500).send('فشل في تصدير إيصال الفاتورة كصورة: ' + (err.message || ''));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

module.exports = router;
