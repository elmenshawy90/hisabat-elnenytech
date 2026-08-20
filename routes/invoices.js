const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');
const { getClientBalance } = require('../lib/balance');

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
      clientPhone = client.phone && client.phone !== '0000000000' ? client.phone : '-';

      if (data.clientPhone && data.clientPhone.trim() !== '' && data.clientPhone.trim() !== '-') {
        const newPhone = data.clientPhone.trim();
        if (!client.phone || client.phone === '-' || client.phone === '0000000000') {
          clientPhone = newPhone;
          await prisma.client.update({
            where: { id: clientId },
            data: { phone: clientPhone }
          });
        } else {
          const existingPhones = client.phone.split(' - ').map(p => p.trim());
          if (!existingPhones.includes(newPhone)) {
            clientPhone = client.phone + ' - ' + newPhone;
            await prisma.client.update({
              where: { id: clientId },
              data: { phone: clientPhone }
            });
          }
        }
      }
    } else {
      // Find or create client based on name if no ID provided (legacy support)
      const allClients = await prisma.client.findMany();
      const normInputName = normalize(data.clientName);
      let client = allClients.find(c => normalize(c.name) === normInputName);

      if (!client) {
        client = await prisma.client.create({
          data: {
            name: data.clientName,
            phone: (data.clientPhone && data.clientPhone.trim() && data.clientPhone.trim() !== '-') ? data.clientPhone.trim() : '-'
          }
        });
      }
      clientId = client.id;
      clientName = client.name;
      clientPhone = client.phone && client.phone !== '0000000000' ? client.phone : '-';
    }

    // EndClient logic
    let endClientId = null;
    let endClientName = null;

    if (data.endClientId) {
      endClientId = parseInt(data.endClientId);
      const endClient = await prisma.endClient.findUnique({ where: { id: endClientId } });
      if (!endClient) {
        return res.status(404).json({ error: 'العميل النهائي غير موجود' });
      }
      endClientName = endClient.name;
    } else if (data.endClientName && data.endClientName.trim() !== '') {
      const trimmedEndName = data.endClientName.trim();
      const allEndClients = await prisma.endClient.findMany();
      const normInputEndName = normalize(trimmedEndName);
      let endClient = allEndClients.find(ec => normalize(ec.name) === normInputEndName);

      if (!endClient) {
        endClient = await prisma.endClient.create({
          data: {
            name: trimmedEndName,
            phone: '-'
          }
        });
      }
      endClientId = endClient.id;
      endClientName = endClient.name;
    }

    const amount = isNaN(parseFloat(data.amount)) ? 0 : parseFloat(data.amount);
    if (amount < 0) {
      return res.status(400).json({ error: 'المبلغ لا يمكن أن يكون سالباً' });
    }

    const newNotes = data.details || (data.type === 'purchase' ? 'عملية شراء' : 'دفعة');

    // Use transaction to increment counter, create invoice with invoiceCode, and update client notes
    const { invoice, updatedClient } = await prisma.$transaction(async (tx) => {
      const counter = await tx.counter.upsert({
        where: { id: 'invoice' },
        create: { id: 'invoice', value: 1 },
        update: { value: { increment: 1 } }
      });
      const invoiceCode = `Nen${counter.value}`;

      const createdInvoice = await tx.invoice.create({
        data: {
          invoiceCode,
          clientId,
          clientName,
          clientPhone: clientPhone || '-',
          endClientId: endClientId || null,
          endClientName: endClientName || '',
          type: data.type,
          amount,
          details: data.details || '-',
          address: data.address || '-',
          status: data.status || 'pending',
          date: data.date ? new Date(data.date) : new Date()
        }
      });

      const updated = await tx.client.update({
        where: { id: clientId },
        data: {
          notes: newNotes
        }
      });

      return { invoice: createdInvoice, updatedClient: updated };
    });

    // Compute live balance
    const currentBalance = await getClientBalance(prisma, clientId);

    res.status(201).json({
      ...invoice,
      _id: invoice.id,
      invoiceCode: invoice.invoiceCode,
      client: invoice.clientId,
      endClientId: invoice.endClientId,
      endClientName: invoice.endClientName,
      currentBalance
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

    await prisma.invoice.delete({ where: { id } });

    res.json({ message: 'تم حذف الفاتورة بنجاح' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في حذف الفاتورة' });
  }
});

// PATCH /api/invoices/:id - Update invoice
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    const data = req.body;
    const updateData = {};

    // Validate and prepare updatable fields
    if (data.type && ['purchase', 'payment'].includes(data.type)) {
      updateData.type = data.type;
    }

    if (data.amount !== undefined) {
      const amount = parseFloat(data.amount);
      if (isNaN(amount) || amount < 0) {
        return res.status(400).json({ error: 'المبلغ لا يمكن أن يكون سالباً' });
      }
      updateData.amount = amount;
    }

    if (data.details !== undefined) {
      updateData.details = data.details || '-';
    }

    if (data.address !== undefined) {
      updateData.address = data.address || '-';
    }

    if (data.date !== undefined) {
      updateData.date = new Date(data.date);
    }

    if (data.status && ['pending', 'paid', 'overdue'].includes(data.status)) {
      updateData.status = data.status;
    }

    // Handle clientPhone update if provided
    if (data.clientPhone !== undefined) {
      updateData.clientPhone = data.clientPhone || '-';
      
      // Also update in client record if it's a new phone
      if (data.clientPhone && data.clientPhone.trim() !== '' && data.clientPhone.trim() !== '-') {
        const newPhone = data.clientPhone.trim();
        const client = await prisma.client.findUnique({ where: { id: invoice.clientId } });
        
        if (client) {
          const existingPhones = client.phone ? client.phone.split(' - ').map(p => p.trim()) : [];
          if (!existingPhones.includes(newPhone)) {
            const updatedPhone = client.phone ? client.phone + ' - ' + newPhone : newPhone;
            await prisma.client.update({
              where: { id: invoice.clientId },
              data: { phone: updatedPhone }
            });
          }
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: updateData
    });

    const currentBalance = await getClientBalance(prisma, invoice.clientId);

    res.json({
      ...updatedInvoice,
      _id: updatedInvoice.id,
      client: updatedInvoice.clientId,
      currentBalance
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في تحديث الفاتورة' });
  }
});

// PATCH /api/invoices/:id/status - Update invoice status only
router.patch('/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const { status } = req.body;
    if (!status || !['pending', 'paid', 'overdue'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة. استخدم: pending, paid, أو overdue' });
    }

    const invoice = await prisma.invoice.findUnique({ where: { id } });
    if (!invoice) {
      return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id },
      data: { status }
    });

    res.json({
      ...updatedInvoice,
      _id: updatedInvoice.id,
      message: 'تم تحديث حالة الفاتورة بنجاح'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في تحديث حالة الفاتورة' });
  }
});

module.exports = router;
