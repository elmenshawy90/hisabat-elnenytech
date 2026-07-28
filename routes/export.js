const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware
router.use(requireAuth);

// Helper to format currency
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: 'EGP'
  }).format(amount);
};

// GET /api/export/clients/excel - Export all clients
router.get('/clients/excel', async (req, res) => {
  try {
    const clients = await Client.find().sort({ name: 1 });
    
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
        balance: client.balance,
        createdAt: client.createdAt ? client.createdAt.toLocaleDateString('ar-EG') : '-',
        lastTransaction: client.updatedAt ? client.updatedAt.toLocaleDateString('ar-EG') : '-'
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
    const invoices = await Invoice.find().sort({ date: -1 }).populate('client');
    
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
        date: inv.date ? inv.date.toLocaleDateString('ar-EG') : '-',
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

module.exports = router;
