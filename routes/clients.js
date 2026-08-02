const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { requireAuth } = require('../middleware/auth');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/clients - List clients with pagination and search
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search;

    const where = search ? {
      OR: [
        { name: { contains: search } },
        { phone: { contains: search } }
      ]
    } : {};

    const total = await prisma.client.count({ where });
    const clients = await prisma.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit
    });

    res.json({
      data: clients.map(c => ({
        ...c,
        _id: c.id,
        lastTransaction: c.updatedAt,
        lastTransactionNote: c.notes || '',
        initials: c.name.split(' ').slice(0, 2).map(w => w[0]).join(' ')
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
    res.status(500).json({ error: 'فشل في جلب بيانات العملاء' });
  }
});

// GET /api/clients/:id - Get single client with their invoices
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id) || !Number.isInteger(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        invoices: {
          orderBy: { date: 'desc' }
        }
      }
    });

    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }

    res.json({
      ...client,
      _id: client.id,
      lastTransaction: client.updatedAt,
      lastTransactionNote: client.notes || '',
      invoices: client.invoices.map(inv => ({ ...inv, _id: inv.id })),
      initials: client.name.split(' ').slice(0, 2).map(w => w[0]).join(' ')
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في جلب بيانات العميل' });
  }
});

// POST /api/clients - Create new client
router.post('/', async (req, res) => {
  try {
    const { name, phone, address, notes, balance } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ error: 'اسم العميل ورقم الهاتف مطلوبان' });
    }

    const client = await prisma.client.create({
      data: {
        name,
        phone,
        address: address || '',
        notes: notes || '',
        balance: balance ? parseFloat(balance) : 0
      }
    });
    res.status(201).json({ ...client, _id: client.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'فشل في إنشاء العميل' });
  }
});

// PUT /api/clients/:id - Update client
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id) || !Number.isInteger(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    const { name, phone, address, notes, balance } = req.body;

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (phone !== undefined) dataToUpdate.phone = phone;
    if (address !== undefined) dataToUpdate.address = address;
    if (notes !== undefined) dataToUpdate.notes = notes;
    if (balance !== undefined) dataToUpdate.balance = parseFloat(balance);

    const client = await prisma.client.update({
      where: { id },
      data: dataToUpdate
    });
    
    res.json({ ...client, _id: client.id });
  } catch (err) {
    console.error(err);
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    res.status(500).json({ error: 'فشل في تحديث العميل' });
  }
});

// DELETE /api/clients/:id - Delete client and their invoices
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'معرف غير صالح' });

    // Delete associated invoices first
    await prisma.invoice.deleteMany({
      where: { clientId: id }
    });

    const client = await prisma.client.delete({
      where: { id }
    });
    
    res.json({ message: 'تم حذف العميل بنجاح' });
  } catch (err) {
    console.error(err);
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }
    res.status(500).json({ error: 'فشل في حذف العميل' });
  }
});

module.exports = router;
