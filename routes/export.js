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
  return date.toLocaleDateString('ar-EG');
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
      { header: 'اسم العميل', key: 'name', width: 30 },
      { header: 'رقم الهاتف', key: 'phone', width: 20 },
      { header: 'الرصيد المستحق (ج.م)', key: 'balance', width: 25 },
      { header: 'تاريخ الإضافة', key: 'createdAt', width: 20 },
      { header: 'آخر معاملة', key: 'lastTransaction', width: 20 }
    ];

    // Style headers
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006840' } }; // Primary color

    clients.forEach(client => {
      worksheet.addRow({
        name: client.name,
        phone: client.phone,
        balance: balanceMap.get(client.id) || 0,
        createdAt: formatDate(client.createdAt),
        lastTransaction: formatDate(client.updatedAt)
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="clients.xlsx"');
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'فشل في تصدير البيانات' });
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
      { header: 'التاريخ', key: 'date', width: 15 },
      { header: 'اسم العميل', key: 'clientName', width: 30 },
      { header: 'رقم الهاتف', key: 'clientPhone', width: 20 },
      { header: 'النوع', key: 'type', width: 15 },
      { header: 'المبلغ (ج.م)', key: 'amount', width: 20 },
      { header: 'التفاصيل', key: 'details', width: 40 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006840' } };

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

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"');
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'فشل في تصدير البيانات' });
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
      include: { invoices: true }
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

    // Title & Client Header in Excel
    worksheet.mergeCells('A1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `كشف حساب - ${client.name}`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006840' } };
    worksheet.getRow(1).height = 35;

    // Info Meta Rows
    worksheet.addRow(['رقم الهاتف:', client.phone || '-', '', 'تاريخ التقرير:', formatDate(new Date()), '']);
    worksheet.addRow(['إجمالي المشتريات:', totalPurchases, 'ج.م', 'إجمالي المدفوعات:', totalPayments, 'ج.م']);
    worksheet.addRow(['الرصيد المستحق:', currentBalance, 'ج.م', 'عدد العمليات:', client.invoices.length, '']);
    worksheet.addRow([]); // Blank line

    // Table Header
    const headerRowNumber = 6;
    worksheet.getRow(headerRowNumber).values = [
      'التاريخ',
      'النوع',
      'المبلغ (ج.م)',
      'البيان / التفاصيل',
      'العميل النهائي',
      'الرصيد بعد العملية (ج.م)'
    ];
    worksheet.getRow(headerRowNumber).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(headerRowNumber).alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(headerRowNumber).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006840' } };
    worksheet.getRow(headerRowNumber).height = 25;

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
      include: { invoices: true }
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

    // Generate PDF via PDFKit
    const doc = new PDFDocument({
      size: 'A4',
      margin: 30,
      info: {
        Title: `كشف حساب - ${client.name}`,
        Author: 'حسابات'
      }
    });

    // Use an Arabic-capable font when available so Arabic text renders correctly in RTL layout.
    const possibleFonts = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
      'C:\\Windows\\Fonts\\tahoma.ttf',
      'C:\\Windows\\Fonts\\times.ttf'
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

module.exports = router;
