const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');

// Apply auth middleware to all routes
router.use(requireAuth);

// دعم تدريجي: ربط التوريدات قبل تطبيق ترحيل الموردين
function stockSupplierSupported() {
  try {
    return Boolean(prisma.stockLog && prisma.stockLog.fields && prisma.stockLog.fields.supplierId);
  } catch {
    return false;
  }
}

// GET /api/suppliers - قائمة الموردين مع البحث وعدد التوريدات
// Query: ?search= &includeInactive=true &activeOnly=true
router.get('/', async (req, res) => {
  try {
    const search = req.query.search;
    const includeInactive = req.query.includeInactive === 'true';
    const activeOnly = req.query.activeOnly === 'true';

    const where = {};
    if (activeOnly || !includeInactive) {
      where.isActive = true;
    }

    let suppliers = await prisma.supplier.findMany({
      where,
      orderBy: { updatedAt: 'desc' }
    });

    if (search && typeof search === 'string' && search.trim()) {
      const terms = [...new Set(search.trim().split(/\s+/).filter(Boolean))];
      const normTerms = [...new Set(terms.map(t => normalize(t)).filter(Boolean))];
      suppliers = suppliers.filter(s => {
        const normName = normalize(s.name || '');
        const phone = s.phone || '';
        const normAddress = normalize(s.address || '');
        return normTerms.some(term => normName.includes(term) || phone.includes(term) || normAddress.includes(term));
      });
    }

    // إحصاءات التوريد لكل مورد
    let countsMap = new Map();
    let lastMap = new Map();
    if (stockSupplierSupported()) {
      try {
        const groups = await prisma.stockLog.groupBy({
          by: ['supplierId'],
          _count: { _all: true },
          _max: { createdAt: true },
          where: { supplierId: { not: null } }
        });
        for (const g of groups) {
          countsMap.set(g.supplierId, g._count._all);
          lastMap.set(g.supplierId, g._max.createdAt);
        }
      } catch {
        // وضع التوافق قبل الترحيل — بدون إحصاءات
      }
    }

    const activeCount = suppliers.filter(s => s.isActive !== false).length;

    res.json({
      data: suppliers.map(s => ({
        ...s,
        _id: s.id,
        restocksCount: countsMap.get(s.id) || 0,
        lastRestockAt: lastMap.get(s.id) || null
      })),
      stats: {
        totalActive: activeCount,
        totalInactive: suppliers.length - activeCount
      }
    });
  } catch (err) {
    console.error('Error fetching suppliers:', err);
    res.status(500).json({ error: 'فشل في جلب بيانات الموردين' });
  }
});

// GET /api/suppliers/:id - مورد واحد مع آخر توريداته
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف غير صالح' });
    }

    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      return res.status(404).json({ error: 'المورد غير موجود' });
    }

    let restocks = [];
    if (stockSupplierSupported()) {
      try {
        restocks = await prisma.stockLog.findMany({
          where: { supplierId: id },
          include: { item: { select: { id: true, name: true } } },
          orderBy: { id: 'desc' },
          take: 20
        });
      } catch {
        restocks = [];
      }
    }

    res.json({ ...supplier, _id: supplier.id, restocks });
  } catch (err) {
    console.error('Error fetching supplier:', err);
    res.status(500).json({ error: 'فشل في جلب بيانات المورد' });
  }
});

// POST /api/suppliers - إنشاء مورد جديد
router.post('/', async (req, res) => {
  try {
    const { name, phone, address, notes } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'اسم المورد مطلوب' });
    }

    const trimmedName = String(name).trim();
    const normNewName = normalize(trimmedName);
    const existing = await prisma.supplier.findMany({ select: { id: true, name: true } });
    if (existing.some(s => normalize(s.name) === normNewName)) {
      return res.status(400).json({ error: 'المورد مسجل مسبقًا، الرجاء تغيير الاسم للمتابعة' });
    }

    const supplier = await prisma.supplier.create({
      data: {
        name: trimmedName,
        phone: phone && String(phone).trim() ? String(phone).trim() : '-',
        address: address ? String(address).trim() : '',
        notes: notes ? String(notes).trim() : ''
      }
    });

    res.status(201).json({ ...supplier, _id: supplier.id, restocksCount: 0, lastRestockAt: null });
  } catch (err) {
    console.error('Error creating supplier:', err);
    res.status(500).json({ error: 'فشل في إنشاء المورد' });
  }
});

// PUT /api/suppliers/:id - تحديث بيانات المورد
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف غير صالح' });
    }

    const { name, phone, address, notes } = req.body;
    const dataToUpdate = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'اسم المورد مطلوب' });
      }
      const others = await prisma.supplier.findMany({ select: { id: true, name: true } });
      if (others.some(s => s.id !== id && normalize(s.name) === normalize(trimmed))) {
        return res.status(400).json({ error: 'يوجد مورد آخر بنفس الاسم' });
      }
      dataToUpdate.name = trimmed;
    }
    if (phone !== undefined) dataToUpdate.phone = String(phone).trim() || '-';
    if (address !== undefined) dataToUpdate.address = String(address).trim();
    if (notes !== undefined) dataToUpdate.notes = String(notes).trim();

    const supplier = await prisma.supplier.update({
      where: { id },
      data: dataToUpdate
    });

    res.json({ ...supplier, _id: supplier.id });
  } catch (err) {
    console.error('Error updating supplier:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'المورد غير موجود' });
    }
    res.status(500).json({ error: 'فشل في تحديث المورد' });
  }
});

// DELETE /api/suppliers/:id - تعطيل / إعادة تفعيل المورد (حذف ناعم — سجل التوريدات يبقى محفوظًا)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف غير صالح' });
    }

    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      return res.status(404).json({ error: 'المورد غير موجود' });
    }

    const updated = await prisma.supplier.update({
      where: { id },
      data: { isActive: !supplier.isActive }
    });

    res.json({
      success: true,
      id: updated.id,
      isActive: updated.isActive,
      message: updated.isActive
        ? `تم إعادة تفعيل المورد "${updated.name}" بنجاح`
        : `تم تعطيل المورد "${updated.name}" بنجاح — سجل توريداته السابقة يبقى محفوظًا`
    });
  } catch (err) {
    console.error('Error toggling supplier state:', err);
    res.status(500).json({ error: 'فشل في تغيير حالة المورد' });
  }
});

module.exports = router;
