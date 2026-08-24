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

// POST /api/end-clients/:id/convert-to-client - Convert end client to an independent Client with historical copy
router.post('/:id/convert-to-client', async (req, res) => {
  try {
    const rawId = parseInt(req.params.id);
    const { name, contractorName } = req.body;

    let endClient = null;
    if (!isNaN(rawId) && rawId > 0) {
      endClient = await prisma.endClient.findUnique({ where: { id: rawId } });
    }

    // If not found by ID or ID is 0, find by name
    const clientName = (endClient?.name || name || '').trim();
    if (!clientName) {
      return res.status(400).json({ error: 'اسم العميل النهائي مطلوب' });
    }

    const normName = normalize(clientName);

    if (!endClient) {
      const allEndClients = await prisma.endClient.findMany();
      endClient = allEndClients.find(ec => normalize(ec.name) === normName);
    }

    // If still doesn't exist in endClient table, create one
    if (!endClient) {
      endClient = await prisma.endClient.create({
        data: {
          name: clientName,
          phone: '-',
          address: '',
          notes: ''
        }
      });
    }

    // Check if already converted
    if (endClient.convertedToClientId) {
      const existingConverted = await prisma.client.findUnique({
        where: { id: endClient.convertedToClientId }
      });
      if (existingConverted) {
        return res.status(200).json({
          ...existingConverted,
          _id: existingConverted.id,
          alreadyConverted: true,
          message: 'العميل ده اتحول بالفعل لعميل مستقل'
        });
      }
    }

    let originNote = 'تم التحويل من عميل نهائي';
    if (contractorName && String(contractorName).trim()) {
      originNote = `تم التحويل من عميل نهائي كان يطلب سابقًا من خلال: ${String(contractorName).trim()}`;
    }

    // Check if client with this name already exists in main Client table
    const existingClients = await prisma.client.findMany({ select: { id: true, name: true, phone: true, address: true } });
    const existingClient = existingClients.find(c => normalize(c.name) === normName);

    const result = await prisma.$transaction(async (tx) => {
      let targetClient;
      if (existingClient) {
        targetClient = await tx.client.findUnique({ where: { id: existingClient.id } });
      } else {
        targetClient = await tx.client.create({
          data: {
            name: endClient.name.trim(),
            phone: endClient.phone || '-',
            address: endClient.address || '',
            notes: originNote,
            pageNumber: 0
          }
        });
      }

      // Fetch all original invoices for this end client that do not already belong to target client
      const originalInvoices = await tx.invoice.findMany({
        where: {
          OR: [
            { endClientId: endClient.id },
            { endClientName: endClient.name }
          ],
          isHistoricalCopy: false,
          NOT: {
            clientId: targetClient.id
          }
        }
      });

      let copiedCount = 0;
      for (const orig of originalInvoices) {
        // Prevent duplicate copy if already copied
        const existingCopy = await tx.invoice.findFirst({
          where: {
            clientId: targetClient.id,
            originalInvoiceId: orig.id,
            isHistoricalCopy: true
          }
        });

        if (!existingCopy) {
          await tx.invoice.create({
            data: {
              clientId: targetClient.id,
              clientName: targetClient.name,
              clientPhone: targetClient.phone || '-',
              endClientId: null,
              endClientName: '',
              type: orig.type,
              amount: orig.amount,
              details: orig.details || '-',
              address: orig.address || '-',
              status: orig.status || 'pending',
              date: orig.date,
              isHistoricalCopy: true,
              originalInvoiceId: orig.id,
              invoiceCode: null // Safe: null avoids any unique constraint collision
            }
          });
          copiedCount++;
        }
      }

      await tx.endClient.update({
        where: { id: endClient.id },
        data: {
          convertedToClientId: targetClient.id
        }
      });

      return { client: targetClient, copiedCount };
    });

    res.status(201).json({
      ...result.client,
      _id: result.client.id,
      balance: 0,
      copiedInvoicesCount: result.copiedCount
    });
  } catch (err) {
    console.error('Error converting end client to client:', err);
    res.status(500).json({ error: 'فشل في تحويل العميل النهائي لعميل مستقل' });
  }
});

module.exports = router;
