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
    if (!rawQ || typeof rawQ !== 'string' || rawQ.trim().length < 1) {
      return res.json({ contractors: [], endClientMatches: [] });
    }

    const terms = [...new Set(rawQ.trim().split(/\s+/).filter(Boolean))];
    const normTerms = [...new Set(terms.map(t => normalize(t)).filter(Boolean))];
    if (terms.length === 0 || normTerms.length === 0) {
      return res.json({ contractors: [], endClientMatches: [] });
    }

    // 1. Search Contractors (Clients) using normalized contains search
    const [allClients, balanceMap] = await Promise.all([
      prisma.client.findMany({
        orderBy: { updatedAt: 'desc' }
      }),
      getAllClientBalances(prisma)
    ]);

    const filteredContractors = allClients.filter(c => {
      const normName = normalize(c.name || '');
      const phone = c.phone || '';
      return normTerms.some(term => normName.includes(term)) || terms.some(term => phone.includes(term));
    });

    const contractors = filteredContractors.slice(0, 20);

    const contractorIds = contractors.map(c => c.id);
    let invoicesForContractors = [];
    if (contractorIds.length > 0) {
      invoicesForContractors = await prisma.invoice.findMany({
        where: {
          clientId: { in: contractorIds },
          endClientName: { not: '' }
        },
        select: { clientId: true, endClientName: true },
        orderBy: { updatedAt: 'desc' }
      });
    }

    const contractorEndClientsMap = new Map();
    for (const inv of invoicesForContractors) {
      if (!inv.endClientName || !inv.endClientName.trim() || inv.endClientName.trim() === '-') continue;
      if (!contractorEndClientsMap.has(inv.clientId)) {
        contractorEndClientsMap.set(inv.clientId, new Set());
      }
      contractorEndClientsMap.get(inv.clientId).add(inv.endClientName.trim());
    }

    const contractorsWithEndClients = contractors.map(c => {
      const endClientsSet = contractorEndClientsMap.get(c.id) || new Set();
      const validEndClientNames = Array.from(endClientsSet);
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
    });

    // 2. Search Invoices for End Clients matching terms with normalized contains
    const allInvoices = await prisma.invoice.findMany({
      where: {
        endClientName: { not: '' }
      },
      include: {
        client: {
          select: { id: true, name: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    const filteredInvoices = allInvoices.filter(inv => {
      if (!inv.endClientName || !inv.endClientName.trim() || inv.endClientName.trim() === '-') return false;
      const normEndName = normalize(inv.endClientName);
      return normTerms.some(term => normEndName.includes(term));
    });

    // In-memory aggregation by normalized endClientName
    const endClientGroups = new Map();

    for (const inv of filteredInvoices) {
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
    })).slice(0, 50);

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
