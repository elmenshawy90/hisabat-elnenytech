const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/invoices - List invoices with pagination and filters
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    let where = {};
    
    // Filter by client ID if provided
    if (req.query.clientId) {
      where.clientId = parseInt(req.query.clientId);
    }

    const total = await prisma.invoice.count({ where });
    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' }
      ],
      skip,
      take: limit
    });

    res.json({
      data: invoices.map(inv => ({
        ...inv,
        _id: inv.id,
        client: inv.clientId // For frontend compatibility
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب الفواتير' });
  }
});

// POST /api/invoices - Create new invoice
router.post('/', async (req, res) => {
  try {
    const data = req.body;
    let clientId;
    let clientName;
    let clientPhone;

    // If client ID is provided, verify it exists
    if (data.client) {
      clientId = parseInt(data.client);
      let client = await prisma.client.findUnique({ where: { id: clientId } });
      
      if (!client) {
        return res.status(404).json({ error: 'العميل غير موجود' });
      }
      
      clientName = client.name;
      clientPhone = client.phone;

      if (data.clientPhone && data.clientPhone.trim() !== '') {
        const newPhone = data.clientPhone.trim();
        const existingPhones = client.phone.split(' - ').map(p => p.trim());
        if (!existingPhones.includes(newPhone)) {
          clientPhone = client.phone + ' - ' + newPhone;
          // Update client phone
          await prisma.client.update({
            where: { id: clientId },
            data: { phone: clientPhone }
          });
        }
      }
    } else {
      // Find or create client based on name if no ID provided (legacy support)
      let client = await prisma.client.findFirst({ where: { name: data.clientName } });
      if (!client) {
        client = await prisma.client.create({
          data: {
            name: data.clientName,
            phone: data.clientPhone || '0000000000'
          }
        });
      }
      clientId = client.id;
      clientName = client.name;
      clientPhone = client.phone;
    }

    const amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون أكبر من صفر' });
    }

    const amountChange = data.type === 'purchase' ? amount : (data.type === 'payment' ? -amount : 0);
    const newNotes = data.details || (data.type === 'purchase' ? 'عملية شراء' : 'دفعة');

    // Use transaction to create invoice and update client balance
    const [invoice, updatedClient] = await prisma.$transaction([
      prisma.invoice.create({
        data: {
          clientId,
          clientName,
          clientPhone,
          type: data.type,
          amount,
          details: data.details,
          address: data.address || '-',
          status: data.status || 'pending',
          date: data.date ? new Date(data.date) : new Date()
        }
      }),
      prisma.client.update({
        where: { id: clientId },
        data: {
          balance: { increment: amountChange },
          notes: newNotes
        }
      })
    ]);

    res.status(201).json({
      ...invoice,
      _id: invoice.id,
      client: invoice.clientId // For frontend compatibility
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في إنشاء الفاتورة' });
  }
});

// DELETE /api/invoices/:id - Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    const amountChange = invoice.type === 'purchase' ? -invoice.amount : (invoice.type === 'payment' ? invoice.amount : 0);

    // Use transaction to delete invoice and revert client balance
    await prisma.$transaction([
      prisma.invoice.delete({ where: { id } }),
      prisma.client.update({
        where: { id: invoice.clientId },
        data: { balance: { increment: amountChange } }
      })
    ]);

    res.json({ message: 'تم حذف الفاتورة بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في حذف الفاتورة' });
  }
});

module.exports = router;
