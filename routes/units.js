const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');

// Apply auth middleware to all routes
router.use(requireAuth);

/**
 * GET /api/units - قائمة الوحدات الرئيسية مع الأصناف المرتبطة
 * Query: ?activeOnly=true — الوحدات النشطة فقط (للقوائم المنسدلة)
 */
router.get('/', async (req, res) => {
  try {
    const activeOnly = req.query.activeOnly === 'true';
    const where = activeOnly ? { isActive: true } : {};

    const units = await prisma.unit.findMany({
      where,
      include: {
        itemUnits: {
          include: {
            item: { select: { id: true, name: true, isActive: true } }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    const data = units.map(u => {
      const seen = new Map();
      (u.itemUnits || []).forEach(iu => {
        if (iu.item && !seen.has(iu.item.id)) seen.set(iu.item.id, iu.item);
      });
      const items = [...seen.values()];
      const activeItems = items.filter(i => i.isActive !== false);
      return {
        id: u.id,
        _id: u.id,
        name: u.name,
        isActive: u.isActive,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
        itemsCount: activeItems.length,
        itemsTotalCount: items.length,
        items: activeItems.map(i => ({ id: i.id, _id: i.id, name: i.name }))
      };
    });

    res.json({ data });
  } catch (err) {
    console.error('Error fetching units:', err);
    res.status(500).json({ error: 'فشل في جلب قائمة الوحدات' });
  }
});

/**
 * POST /api/units - إنشاء وحدة رئيسية جديدة
 * Body: { name }
 */
router.post('/', async (req, res) => {
  try {
    const { name } = req.body;
    const trimmed = name ? String(name).trim() : '';
    if (!trimmed) {
      return res.status(400).json({ error: 'اسم الوحدة مطلوب' });
    }

    const normName = normalize(trimmed);
    const existing = await prisma.unit.findMany({ select: { id: true, name: true } });
    if (existing.some(u => normalize(u.name) === normName)) {
      return res.status(400).json({ error: 'الوحدة مسجلة مسبقًا في الكتالوج' });
    }

    const unit = await prisma.unit.create({ data: { name: trimmed } });
    res.status(201).json({ ...unit, _id: unit.id, itemsCount: 0, items: [] });
  } catch (err) {
    console.error('Error creating unit:', err);
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'الوحدة مسجلة مسبقًا في الكتالوج' });
    }
    res.status(500).json({ error: 'فشل في إنشاء الوحدة' });
  }
});

/**
 * PUT /api/units/:id - تعديل اسم الوحدة مع نشره على الأصناف المرتبطة
 * Body: { name?, isActive? }
 */
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الوحدة غير صالح' });
    }

    const existing = await prisma.unit.findUnique({
      where: { id },
      include: { itemUnits: true }
    });
    if (!existing) {
      return res.status(404).json({ error: 'الوحدة غير موجودة' });
    }

    const { name, isActive } = req.body;
    const data = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'اسم الوحدة مطلوب' });
      }
      const normName = normalize(trimmed);
      const others = await prisma.unit.findMany({ select: { id: true, name: true } });
      if (others.some(u => u.id !== id && normalize(u.name) === normName)) {
        return res.status(400).json({ error: 'يوجد وحدة أخرى بنفس الاسم في الكتالوج' });
      }
      data.name = trimmed;
    }

    if (isActive !== undefined) {
      data.isActive = Boolean(isActive);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const unitRecord = await tx.unit.update({ where: { id }, data });

      // نشر الاسم الجديد على وحدات الأصناف المرتبطة (مع تجاوز التعارضات داخل نفس الصنف)
      let propagated = 0;
      const skippedItems = [];
      if (data.name && data.name !== existing.name) {
        const linked = await tx.itemUnit.findMany({ where: { unitId: id } });
        for (const iu of linked) {
          const clash = await tx.itemUnit.findFirst({
            where: { itemId: iu.itemId, name: data.name, id: { not: iu.id } }
          });
          if (clash) {
            skippedItems.push(iu.itemId);
            continue;
          }
          await tx.itemUnit.update({ where: { id: iu.id }, data: { name: data.name } });
          propagated++;
        }
      }
      return { unitRecord, propagated, skippedItems };
    });

    res.json({
      ...updated.unitRecord,
      _id: updated.unitRecord.id,
      propagatedCount: updated.propagated,
      skippedItemIds: updated.skippedItems
    });
  } catch (err) {
    console.error('Error updating unit:', err);
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'يوجد وحدة أخرى بنفس الاسم في الكتالوج' });
    }
    res.status(500).json({ error: 'فشل في تحديث الوحدة' });
  }
});

// DELETE /api/units/:id - تعطيل / إعادة تفعيل الوحدة (حذف ناعم)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الوحدة غير صالح' });
    }

    const unit = await prisma.unit.findUnique({ where: { id } });
    if (!unit) {
      return res.status(404).json({ error: 'الوحدة غير موجودة' });
    }

    const updated = await prisma.unit.update({
      where: { id },
      data: { isActive: !unit.isActive }
    });

    res.json({
      success: true,
      id: updated.id,
      isActive: updated.isActive,
      message: updated.isActive
        ? `تم إعادة تفعيل الوحدة "${updated.name}" بنجاح`
        : `تم تعطيل الوحدة "${updated.name}" بنجاح — ستظل الأصناف المرتبطة تعمل بوحداتها الحالية`
    });
  } catch (err) {
    console.error('Error toggling unit state:', err);
    res.status(500).json({ error: 'فشل في تغيير حالة الوحدة' });
  }
});

/**
 * POST /api/units/:id/map - ربط الوحدة بعدة أصناف
 * Body: { itemIds: number[], conversionRate?: number }
 * - يتجاوز الأصناف المرتبطة مسبقًا (بنفس unitId أو نفس الاسم)
 * - معامل التحويل الافتراضي 1 (وحدة أساسية نسبيًا) — يُضبط لاحقًا من شاشة الصنف
 * - لو الصنف بلا وحدات تمامًا تصبح الوحدة المربوطة هي الأساسية
 */
router.post('/:id/map', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الوحدة غير صالح' });
    }

    const unit = await prisma.unit.findUnique({ where: { id } });
    if (!unit) {
      return res.status(404).json({ error: 'الوحدة غير موجودة' });
    }
    if (unit.isActive === false) {
      return res.status(400).json({ error: 'لا يمكن الربط بوحدة معطّلة — أعد تفعيلها أولًا' });
    }

    const { itemIds, conversionRate } = req.body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ error: 'اختر صنفًا واحدًا على الأقل للربط' });
    }

    const rate = conversionRate !== undefined && conversionRate !== null && conversionRate !== ''
      ? Number(conversionRate)
      : 1;
    if (isNaN(rate) || rate <= 0) {
      return res.status(400).json({ error: 'معامل التحويل يجب أن يكون رقمًا موجبًا' });
    }

    const normUnitName = normalize(unit.name);
    let linked = 0;
    const skipped = [];

    for (const rawId of itemIds) {
      const itemId = parseInt(rawId);
      if (isNaN(itemId) || itemId <= 0) continue;

      const item = await prisma.item.findUnique({
        where: { id: itemId },
        include: { units: true }
      });
      if (!item) {
        skipped.push({ itemId, reason: 'الصنف غير موجود' });
        continue;
      }

      const alreadyLinked = (item.units || []).some(
        u => u.unitId === id || normalize(u.name) === normUnitName
      );
      if (alreadyLinked) {
        skipped.push({ itemId, itemName: item.name, reason: 'مرتبط مسبقًا' });
        continue;
      }

      const isFirstUnit = !item.units || item.units.length === 0;
      await prisma.itemUnit.create({
        data: {
          itemId,
          unitId: id,
          name: unit.name,
          isBaseUnit: isFirstUnit,
          conversionRate: isFirstUnit ? 1 : rate
        }
      });
      linked++;
    }

    res.json({
      success: true,
      linked,
      skipped,
      message: linked > 0
        ? `تم ربط الوحدة "${unit.name}" بـ ${linked} صنف بنجاح — راجع معامل التحويل لكل صنف من شاشة الأصناف`
        : 'لم يتم ربط أي صنف جديد (الأصناف المختارة مرتبطة مسبقًا)'
    });
  } catch (err) {
    console.error('Error mapping unit to items:', err);
    res.status(500).json({ error: 'فشل في ربط الوحدة بالأصناف' });
  }
});

/**
 * DELETE /api/units/:id/items/:itemId - فك ربط الوحدة عن صنف
 * - ممنوع لو الوحدة مستخدمة في فواتير (InvoiceItem)
 * - ممنوع لو الصنف له حركات مخزون (حماية السجل التاريخي — نفس قاعدة الأصناف)
 * - ممنوع فك ربط الوحدة الأساسية طالما توجد وحدات أخرى
 */
router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const itemId = parseInt(req.params.itemId);
    if (isNaN(id) || id <= 0 || isNaN(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'معرف غير صالح' });
    }

    const link = await prisma.itemUnit.findFirst({
      where: { itemId, unitId: id },
      include: { item: true }
    });
    if (!link) {
      return res.status(404).json({ error: 'لا يوجد ربط بين هذه الوحدة وهذا الصنف' });
    }

    const invoiceUsage = await prisma.invoiceItem.count({ where: { itemUnitId: link.id } });
    if (invoiceUsage > 0) {
      return res.status(400).json({
        error: `لا يمكن فك الربط — الوحدة "${link.name}" مستخدمة في ${invoiceUsage} بند فواتير للصنف "${link.item.name}"`
      });
    }

    const stockCount = await prisma.stockLog.count({ where: { itemId } });
    if (stockCount > 0) {
      return res.status(400).json({
        error: `لا يمكن فك الربط — الصنف "${link.item.name}" له حركات مخزون مسجلة (حماية السجل التاريخي)`
      });
    }

    if (link.isBaseUnit) {
      const others = await prisma.itemUnit.count({ where: { itemId, id: { not: link.id } } });
      if (others > 0) {
        return res.status(400).json({
          error: 'لا يمكن فك ربط الوحدة الأساسية طالما توجد وحدات أخرى — حدد وحدة أساسية بديلة من شاشة الصنف أولًا'
        });
      }
    }

    await prisma.itemUnit.delete({ where: { id: link.id } });
    res.json({ success: true, message: `تم فك ربط الوحدة "${link.name}" عن الصنف "${link.item.name}"` });
  } catch (err) {
    console.error('Error unmapping unit:', err);
    res.status(500).json({ error: 'فشل في فك الربط' });
  }
});

module.exports = router;
