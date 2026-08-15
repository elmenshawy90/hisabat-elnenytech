const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/end-clients - Search / list end clients (up to 20 for autocomplete)
router.get('/', async (req, res) => {
  try {
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

    const endClients = await prisma.endClient.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 20
    });

    res.json({
      data: endClients.map(ec => ({
        ...ec,
        _id: ec.id
      }))
    });
  } catch (err) {
    console.error('Error fetching end clients:', err);
    res.status(500).json({ error: 'فشل في جلب بيانات العملاء النهائيين' });
  }
});

// POST /api/end-clients - Create new end client manually
router.post('/', async (req, res) => {
  try {
    const { name, phone, address, notes } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'اسم العميل النهائي مطلوب' });
    }

    const trimmedName = name.trim();
    const trimmedPhone = phone && phone.trim() ? phone.trim() : '-';

    const normNewName = normalize(trimmedName);
    const existingEndClients = await prisma.endClient.findMany({ select: { id: true, name: true, phone: true } });
    const duplicate = existingEndClients.find(c => normalize(c.name) === normNewName);

    if (duplicate) {
      return res.status(400).json({ error: 'العميل النهائي مسجل مسبقاً' });
    }

    const endClient = await prisma.endClient.create({
      data: {
        name: trimmedName,
        phone: trimmedPhone,
        address: address || '',
        notes: notes || ''
      }
    });

    res.status(201).json({ ...endClient, _id: endClient.id });
  } catch (err) {
    console.error('Error creating end client:', err);
    res.status(500).json({ error: 'فشل في إنشاء العميل النهائي' });
  }
});

module.exports = router;
