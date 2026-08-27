const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');
const { getClientBalance } = require('../lib/balance');

// Apply auth middleware to all routes
router.use(requireAuth);

// GET /api/end-clients/check-name-match?name=... - Search Client table for matching independent client name
router.get('/check-name-match', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name || !String(name).trim()) {
      return res.json({ matches: [] });
    }

    const normInputName = normalize(String(name).trim());
    const allClients = await prisma.client.findMany({
      select: { id: true, name: true, phone: true, address: true }
    });

    const matchedClients = allClients.filter(c => normalize(c.name) === normInputName);

    const results = await Promise.all(
      matchedClients.map(async (c) => {
        const balance = await getClientBalance(prisma, c.id);
        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          balance
        };
      })
    );

    res.json({ matches: results });
  } catch (err) {
    console.error('Error checking name match:', err);
    res.status(500).json({ error: 'فشل في البحث عن تطابق أسماء العملاء' });
  }
});

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

// POST /api/end-clients/:id/convert-to-client - Convert end client to an independent Client (Full Transfer + optional merge)
router.post('/:id/convert-to-client', async (req, res) => {
  try {
    const rawId = parseInt(req.params.id);
    const { mergeWithClientId, newClientName, name, contractorName } = req.body;

    let endClient = null;
    if (!isNaN(rawId) && rawId > 0) {
      endClient = await prisma.endClient.findUnique({ where: { id: rawId } });
    }

    const clientName = (endClient?.name || name || '').trim();
    if (!endClient && clientName) {
      const normName = normalize(clientName);
      const allEndClients = await prisma.endClient.findMany();
      endClient = allEndClients.find(ec => normalize(ec.name) === normName);
    }

    if (!endClient) {
      return res.status(404).json({ error: 'العميل النهائي غير موجود' });
    }

    const result = await prisma.$transaction(async (tx) => {
      let targetClient = null;

      if (mergeWithClientId) {
        const targetId = parseInt(mergeWithClientId);
        targetClient = await tx.client.findUnique({ where: { id: targetId } });
        if (!targetClient) {
          throw new Error('العميل المستقل المراد الدمج معه غير موجود');
        }
      } else {
        const finalName = (newClientName && String(newClientName).trim()) ? String(newClientName).trim() : endClient.name.trim();

        // Server-side check: Ensure finalName does NOT match any existing independent Client using normalize()
        const normFinalName = normalize(finalName);
        const existingClients = await tx.client.findMany({ select: { id: true, name: true } });
        const duplicate = existingClients.find(c => normalize(c.name) === normFinalName);

        if (duplicate) {
          throw new Error('الاسم لازم يكون مختلفًا عن عميل موجود بالفعل');
        }

        let originNote = 'تم التحويل من عميل نهائي';
        if (contractorName && String(contractorName).trim()) {
          originNote = `تم التحويل من عميل نهائي كان يطلب سابقًا من خلال: ${String(contractorName).trim()}`;
        }

        targetClient = await tx.client.create({
          data: {
            name: finalName,
            phone: endClient.phone || '-',
            address: endClient.address || '',
            notes: originNote,
            pageNumber: 0
          }
        });
      }

      // Fetch all invoices belonging to this end client
      const invoicesToTransfer = await tx.invoice.findMany({
        where: {
          OR: [
            { endClientId: endClient.id },
            { endClientName: endClient.name }
          ]
        }
      });

      const transferredCount = invoicesToTransfer.length;
      const totalAmount = invoicesToTransfer.reduce((sum, inv) => sum + (Number(inv.amount) || 0), 0);

      // Update all invoices to point directly to target independent client and detach endClient
      await tx.invoice.updateMany({
        where: {
          OR: [
            { endClientId: endClient.id },
            { endClientName: endClient.name }
          ]
        },
        data: {
          clientId: targetClient.id,
          clientName: targetClient.name,
          clientPhone: targetClient.phone || '-',
          endClientId: null,
          endClientName: ''
        }
      });

      // Delete the end client record since all invoices were transferred
      await tx.endClient.delete({
        where: { id: endClient.id }
      });

      return { client: targetClient, transferredCount, totalAmount };
    });

    res.status(200).json({
      ...result.client,
      _id: result.client.id,
      transferredInvoicesCount: result.transferredCount,
      totalTransferredAmount: result.totalAmount
    });
  } catch (err) {
    console.error('Error converting end client:', err);
    let status = 500;
    if (err.message === 'العميل المستقل المراد الدمج معه غير موجود') status = 404;
    if (err.message === 'الاسم لازم يكون مختلفًا عن عميل موجود بالفعل') status = 400;

    res.status(status).json({
      error: err.message || 'فشل في تحويل العميل النهائي'
    });
  }
});

module.exports = router;
