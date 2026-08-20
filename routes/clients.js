const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');
const { getClientBalance, getAllClientBalances } = require('../lib/balance');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/clients - List clients with pagination and search
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search;
    let where = {};

    if (search && typeof search === 'string') {
      const terms = [...new Set(search.trim().split(/\s+/).filter(Boolean))];
      if (terms.length > 0) {
        where = {
          OR: terms.flatMap(term => [
            { name: { contains: term } },
            { phone: { contains: term } }
          ])
        };
      }
    }

    const [total, clients, balanceMap] = await Promise.all([
      prisma.client.count({ where }),
      prisma.client.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit
      }),
      getAllClientBalances(prisma)
    ]);

    res.json({
      data: clients.map(c => ({
        ...c,
        _id: c.id,
        balance: balanceMap.get(c.id) || 0,
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

    const [client, balance] = await Promise.all([
      prisma.client.findUnique({
        where: { id },
        include: {
          invoices: {
            include: {
              endClient: true
            },
            orderBy: [
              { date: 'desc' },
              { createdAt: 'desc' },
              { id: 'desc' }
            ]
          }
        }
      }),
      getClientBalance(prisma, id)
    ]);

    if (!client) {
      return res.status(404).json({ error: 'العميل غير موجود' });
    }

    res.json({
      ...client,
      _id: client.id,
      balance,
      lastTransaction: client.updatedAt,
      lastTransactionNote: client.notes || '',
      invoices: client.invoices.map(inv => ({
        ...inv,
        _id: inv.id,
        endClient: inv.endClient
      })),
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
    const { name, phone, address, notes, pageNumber } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'اسم العميل مطلوب' });
    }

    const trimmedName = name.trim();
    const trimmedPhone = phone && phone.trim() ? phone.trim() : '-';
    const parsedPageNumber = pageNumber === undefined || pageNumber === null || pageNumber === '' ? 0 : Number(pageNumber);

    const normNewName = normalize(trimmedName);
    const existingClients = await prisma.client.findMany({ select: { id: true, name: true, phone: true } });
    const duplicate = existingClients.find(c => normalize(c.name) === normNewName);

    if (duplicate) {
      return res.status(400).json({ error: 'العميل مسجل مسبقاً، الرجاء تغيير الاسم للمتابعة' });
    }

    const client = await prisma.client.create({
      data: {
        name: trimmedName,
        phone: trimmedPhone,
        address: address || '',
        notes: notes || '',
        pageNumber: Number.isFinite(parsedPageNumber) && parsedPageNumber >= 0 ? parsedPageNumber : 0
      }
    });
    res.status(201).json({ ...client, _id: client.id, balance: 0 });
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

    const { name, phone, address, notes, pageNumber } = req.body;

    const dataToUpdate = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (phone !== undefined) dataToUpdate.phone = phone;
    if (address !== undefined) dataToUpdate.address = address;
    if (notes !== undefined) dataToUpdate.notes = notes;
    if (pageNumber !== undefined) {
      const parsedPageNumber = pageNumber === null || pageNumber === '' ? 0 : Number(pageNumber);
      dataToUpdate.pageNumber = Number.isFinite(parsedPageNumber) && parsedPageNumber >= 0 ? parsedPageNumber : 0;
    }

    const client = await prisma.client.update({
      where: { id },
      data: dataToUpdate
    });
    
    const balance = await getClientBalance(prisma, id);
    res.json({ ...client, _id: client.id, balance });
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
