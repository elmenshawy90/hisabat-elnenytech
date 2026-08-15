const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');
const { getAllClientBalances } = require('../lib/balance');

// Apply auth middleware
router.use(requireAuth);

// GET /api/search?q=... - Unified search for Contractors & End Clients
router.get('/', async (req, res) => {
  try {
    const rawQ = req.query.q;
    if (!rawQ || typeof rawQ !== 'string' || rawQ.trim().length < 2) {
      return res.json({ contractors: [], endClientMatches: [] });
    }

    const terms = [...new Set(rawQ.trim().split(/\s+/).filter(Boolean))];
    if (terms.length === 0) {
      return res.json({ contractors: [], endClientMatches: [] });
    }

    // 1. Search Contractors (Clients)
    const contractorsWhere = {
      OR: terms.flatMap(term => [
        { name: { contains: term } },
        { phone: { contains: term } }
      ])
    };

    const [contractors, balanceMap] = await Promise.all([
      prisma.client.findMany({
        where: contractorsWhere,
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      getAllClientBalances(prisma)
    ]);

    const contractorsWithEndClients = await Promise.all(
      contractors.map(async (c) => {
        const distinctInvoices = await prisma.invoice.findMany({
          where: {
            clientId: c.id,
            endClientName: { not: '' }
          },
          distinct: ['endClientName'],
          select: { endClientName: true },
          orderBy: { updatedAt: 'desc' },
          take: 20
        });

        const validEndClientNames = distinctInvoices
          .map(inv => inv.endClientName)
          .filter(name => name && name.trim() && name.trim() !== '-');

        return {
          id: c.id,
          _id: c.id,
          name: c.name,
          phone: c.phone,
          balance: balanceMap.get(c.id) || 0,
          lastTransaction: c.updatedAt,
          notes: c.notes,
          matchedEndClients: validEndClientNames,
          matchedEndClientsCount: validEndClientNames.length
        };
      })
    );

    // 2. Search Invoices for End Clients matching terms
    const endClientInvoices = await prisma.invoice.findMany({
      where: {
        OR: terms.map(term => ({
          endClientName: { contains: term }
        }))
      },
      include: {
        client: {
          select: { id: true, name: true }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 100
    });

    // In-memory aggregation by normalized endClientName
    const endClientGroups = new Map();

    for (const inv of endClientInvoices) {
      if (!inv.endClientName || !inv.endClientName.trim() || inv.endClientName.trim() === '-') continue;

      const normKey = normalize(inv.endClientName);
      if (!endClientGroups.has(normKey)) {
        endClientGroups.set(normKey, {
          endClientName: inv.endClientName,
          contractorMap: new Map()
        });
      }

      const group = endClientGroups.get(normKey);
      if (inv.client) {
        const contractorId = inv.client.id;
        if (!group.contractorMap.has(contractorId)) {
          group.contractorMap.set(contractorId, {
            id: inv.client.id,
            name: inv.client.name,
            invoiceCount: 0
          });
        }
        group.contractorMap.get(contractorId).invoiceCount++;
      }
    }

    const endClientMatches = Array.from(endClientGroups.values()).map(g => ({
      endClientName: g.endClientName,
      contractors: Array.from(g.contractorMap.values())
    }));

    res.json({
      contractors: contractorsWithEndClients,
      endClientMatches
    });
  } catch (err) {
    console.error('Error in unified search:', err);
    res.status(500).json({ error: 'فشل في عملية البحث' });
  }
});

module.exports = router;
