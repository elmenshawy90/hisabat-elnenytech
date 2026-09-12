const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireEditor } = require('../middleware/auth');
const { normalize } = require('../lib/normalize');

// Apply auth middleware to all routes
router.use(requireAuth);
router.use(requireEditor); // viewer role is read-only

/**
 * ربط اسم وحدة بالكتالوج الرئيسي (Unit): بحث بالاسم المطابق ثم المطبّع، ثم إنشاء عند الحاجة.
 * يعمل مع prisma أو مع كائن الـ transaction (tx) — كلاهما يملك .unit
 * @returns {Promise<number|null>} معرف الوحدة الرئيسية أو null عند الاسم الفارغ
 */
async function resolveMasterUnitId(db, rawName) {
  try {
    // قبل تطبيق ترحيل الوحدات أو توليد عميل Prisma قد لا يوجد نموذج Unit — نعود لوضع الاسم فقط
    if (!db.unit) return null;
    const trimmed = rawName ? String(rawName).trim() : '';
    if (!trimmed) return null;

    const exact = await db.unit.findUnique({ where: { name: trimmed } });
    if (exact) return exact.id;

    const normName = normalize(trimmed);
    const all = await db.unit.findMany({ select: { id: true, name: true } });
    const normMatch = all.find(u => normalize(u.name) === normName);
    if (normMatch) return normMatch.id;

    try {
      const created = await db.unit.create({ data: { name: trimmed } });
      return created.id;
    } catch (err) {
      // إنشاء متزامن محتمل — أعد المحاولة بالقراءة
      const retry = await db.unit.findUnique({ where: { name: trimmed } });
      return retry ? retry.id : null;
    }
  } catch (err) {
    console.warn('[units] master catalog unavailable, using name-only mode:', err.message);
    return null;
  }
}

/**
 * بناء كائن إنشاء/تحديث ItemUnit مع تضمين unitId فقط عند توفره
 * (توافق تدريجي: يعمل قبل تطبيق الترحيل وبعده)
 */
function withMasterLink(data, unitId) {
  if (unitId) data.unitId = unitId;
  return data;
}

/**
 * Helper to process and calculate final conversion rates relative to the user-selected base unit.
 * Supports selecting ANY unit row as the Base Unit, and handles relative links in any order.
 */
function calculateCumulativeUnits(unitsInput) {
  if (!Array.isArray(unitsInput) || unitsInput.length === 0) {
    throw new Error('يجب إضافة وحدة قياس واحدة على الأقل للصنف');
  }

  const baseUnits = unitsInput.filter(u => Boolean(u.isBaseUnit));
  if (baseUnits.length === 0) {
    unitsInput[0].isBaseUnit = true;
  } else if (baseUnits.length > 1) {
    throw new Error('يجب تحديد وحدة أساسية واحدة فقط للصنف');
  }

  const N = unitsInput.length;
  const nameToIndexMap = new Map();

  // Validate names and populate nameToIndexMap
  unitsInput.forEach((u, idx) => {
    const uName = String(u.name || '').trim();
    if (!uName) {
      throw new Error(`اسم الوحدة في الصف ${idx + 1} غير صالح`);
    }
    nameToIndexMap.set(uName, idx);
  });

  const rawRefCache = new Map();

  function getRawRef(idx, visited = new Set()) {
    if (rawRefCache.has(idx)) return rawRefCache.get(idx);
    if (visited.has(idx)) return 1.0;
    visited.add(idx);

    const u = unitsInput[idx];
    if (!u) return 1.0;

    let targetIdx = -1;
    if (u.relativeToName && nameToIndexMap.has(String(u.relativeToName).trim())) {
      targetIdx = nameToIndexMap.get(String(u.relativeToName).trim());
    } else if (u.relativeToIndex !== undefined && u.relativeToIndex !== null) {
      targetIdx = Number(u.relativeToIndex);
    }

    let val = 1.0;
    if (targetIdx >= 0 && targetIdx !== idx && (u.relativeQuantity !== undefined && u.relativeQuantity !== null)) {
      const relQty = Number(u.relativeQuantity);
      if (!isNaN(relQty) && relQty > 0) {
        val = relQty * getRawRef(targetIdx, new Set(visited));
      }
    } else if (u.conversionRate !== undefined && u.conversionRate !== null) {
      const rate = Number(u.conversionRate);
      if (!isNaN(rate) && rate > 0) {
        val = rate;
      }
    }

    rawRefCache.set(idx, val);
    return val;
  }

  // Calculate rawRef for all rows
  for (let i = 0; i < N; i++) {
    getRawRef(i);
  }

  // Find the selected Base Unit row
  let baseUnitIdx = unitsInput.findIndex(u => Boolean(u.isBaseUnit));
  if (baseUnitIdx < 0) baseUnitIdx = 0;

  const rawRefBase = rawRefCache.get(baseUnitIdx) || 1.0;

  // Calculate final conversionRate relative to the selected Base Unit
  const processedUnits = unitsInput.map((u, idx) => {
    const uName = String(u.name || '').trim();
    const isBase = idx === baseUnitIdx;

    let finalRate = 1.0;
    if (isBase) {
      finalRate = 1.0;
    } else {
      const rawRef = rawRefCache.get(idx) || 1.0;
      finalRate = rawRef / rawRefBase;
    }

    return {
      id: u.id ? Number(u.id) : undefined,
      name: uName,
      isBaseUnit: isBase,
      conversionRate: finalRate
    };
  });

  return processedUnits;
}

// GET /api/items - List items (active by default, or all if ?includeInactive=true)
router.get('/', async (req, res) => {
  try {
    const search = req.query.search;
    const includeInactive = req.query.includeInactive === 'true';

    let where = {};
    if (!includeInactive) {
      where.isActive = true;
    }

    if (search && typeof search === 'string' && search.trim()) {
      const normTerm = normalize(search.trim());
      const allItems = await prisma.item.findMany({
        where,
        include: { units: true },
        orderBy: { updatedAt: 'desc' }
      });

      const filteredItems = allItems.filter(item => normalize(item.name).includes(normTerm));

      const itemsWithStock = await Promise.all(
        filteredItems.map(async (item) => {
          const latestLog = await prisma.stockLog.findFirst({
            where: { itemId: item.id },
            orderBy: { id: 'desc' }
          });
          const baseUnit = item.units.find(u => u.isBaseUnit) || null;
          return {
            ...item,
            _id: item.id,
            currentStock: latestLog ? latestLog.balanceAfter : 0,
            baseUnit
          };
        })
      );

      const LOW_STOCK_THRESHOLD = 10;
      const totalActive = itemsWithStock.filter(i => i.isActive !== false).length;
      const lowStockCount = itemsWithStock.filter(i => i.isActive !== false && (Number(i.currentStock) || 0) < LOW_STOCK_THRESHOLD).length;

      return res.json({
        data: itemsWithStock,
        stats: {
          totalActive,
          lowStockCount,
          lowStockThreshold: LOW_STOCK_THRESHOLD
        }
      });
    }

    const items = await prisma.item.findMany({
      where,
      include: { units: true },
      orderBy: { updatedAt: 'desc' }
    });

    const itemsWithStock = await Promise.all(
      items.map(async (item) => {
        const latestLog = await prisma.stockLog.findFirst({
          where: { itemId: item.id },
          orderBy: { id: 'desc' }
        });
        const baseUnit = item.units.find(u => u.isBaseUnit) || null;
        return {
          ...item,
          _id: item.id,
          currentStock: latestLog ? latestLog.balanceAfter : 0,
          baseUnit
        };
      })
    );

    const LOW_STOCK_THRESHOLD = 10;
    const totalActive = itemsWithStock.filter(i => i.isActive !== false).length;
    const lowStockCount = itemsWithStock.filter(i => i.isActive !== false && (Number(i.currentStock) || 0) < LOW_STOCK_THRESHOLD).length;

    res.json({
      data: itemsWithStock,
      stats: {
        totalActive,
        lowStockCount,
        lowStockThreshold: LOW_STOCK_THRESHOLD
      }
    });
  } catch (err) {
    console.error('Error fetching items:', err);
    res.status(500).json({ error: 'فشل في جلب قائمة الأصناف' });
  }
});

// GET /api/items/:id - Single item details with units and stock logs
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح' });
    }

    const item = await prisma.item.findUnique({
      where: { id },
      include: {
        units: true
      }
    });

    if (!item) {
      return res.status(404).json({ error: 'الصنف غير موجود' });
    }

    let stockLogInclude = {};
    try {
      if (prisma.stockLog && prisma.stockLog.fields && prisma.stockLog.fields.supplierId) {
        stockLogInclude = { include: { supplier: { select: { id: true, name: true } } } };
      }
    } catch { /* وضع التوافق */ }

    const [stockLogs, latestLog, stockLogsCount] = await Promise.all([
      prisma.stockLog.findMany({
        where: { itemId: id },
        orderBy: { id: 'desc' },
        take: 20,
        ...stockLogInclude
      }),
      prisma.stockLog.findFirst({
        where: { itemId: id },
        orderBy: { id: 'desc' }
      }),
      prisma.stockLog.count({
        where: { itemId: id }
      })
    ]);

    const baseUnit = item.units.find(u => u.isBaseUnit) || null;

    res.json({
      ...item,
      _id: item.id,
      currentStock: latestLog ? latestLog.balanceAfter : 0,
      hasStockLogs: stockLogsCount > 0,
      baseUnit,
      stockLogs
    });
  } catch (err) {
    console.error('Error fetching item details:', err);
    res.status(500).json({ error: 'فشل في جلب تفاصيل الصنف' });
  }
});

// POST /api/items - Create item with units
router.post('/', async (req, res) => {
  try {
    const { name, notes, units, defaultSellingPrice } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'اسم الصنف مطلوب' });
    }

    const trimmedName = String(name).trim();
    const normName = normalize(trimmedName);

    const parsedPrice = defaultSellingPrice !== undefined && defaultSellingPrice !== null && defaultSellingPrice !== '' && !isNaN(Number(defaultSellingPrice)) ? Math.round(Number(defaultSellingPrice)) : null;

    // Duplicate name check
    const existingItems = await prisma.item.findMany({ select: { id: true, name: true } });
    const duplicate = existingItems.find(i => normalize(i.name) === normName);
    if (duplicate) {
      return res.status(400).json({ error: 'الصنف مسجل مسبقاً' });
    }

    // Process units
    const processedUnits = calculateCumulativeUnits(units);

    const newItem = await prisma.$transaction(async (tx) => {
      // ربط كل وحدة بالكتالوج الرئيسي (إنشاء تلقائي للأسماء الجديدة)
      const unitsWithMaster = [];
      for (const u of processedUnits) {
        unitsWithMaster.push({ ...u, unitId: await resolveMasterUnitId(tx, u.name) });
      }
      const createdItem = await tx.item.create({
        data: {
          name: trimmedName,
          notes: notes ? String(notes).trim() : '',
          defaultSellingPrice: parsedPrice,
          units: {
            create: unitsWithMaster.map(u => withMasterLink({
              name: u.name,
              isBaseUnit: u.isBaseUnit,
              conversionRate: u.conversionRate
            }, u.unitId))
          }
        },
        include: {
          units: true
        }
      });
      return createdItem;
    });

    const baseUnit = newItem.units.find(u => u.isBaseUnit) || null;

    res.status(201).json({
      ...newItem,
      _id: newItem.id,
      currentStock: 0,
      baseUnit
    });
  } catch (err) {
    console.error('Error creating item:', err);
    res.status(err.message ? 400 : 500).json({
      error: err.message || 'فشل في إنشاء الصنف'
    });
  }
});

// PUT /api/items/:id - Update item name, notes, and units (with StockLog protection)
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح' });
    }

    const existingItem = await prisma.item.findUnique({
      where: { id },
      include: { units: true }
    });

    if (!existingItem) {
      return res.status(404).json({ error: 'الصنف غير موجود' });
    }

    const { name, notes, units, defaultSellingPrice } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'اسم الصنف مطلوب' });
    }

    const trimmedName = String(name).trim();
    const normName = normalize(trimmedName);
    const parsedPrice = defaultSellingPrice !== undefined && defaultSellingPrice !== null && defaultSellingPrice !== '' && !isNaN(Number(defaultSellingPrice)) ? Math.round(Number(defaultSellingPrice)) : null;

    const existingItems = await prisma.item.findMany({ select: { id: true, name: true } });
    const duplicate = existingItems.find(i => i.id !== id && normalize(i.name) === normName);
    if (duplicate) {
      return res.status(400).json({ error: 'اسم الصنف متطابق مع صنف آخر مسجل مسبقاً' });
    }

    // Check if stock logs exist for this item
    const stockLogsCount = await prisma.stockLog.count({ where: { itemId: id } });
    const hasStockLogs = stockLogsCount > 0;

    let processedUnits = null;
    if (Array.isArray(units) && units.length > 0) {
      processedUnits = calculateCumulativeUnits(units);
    }

    if (hasStockLogs && processedUnits) {
      // Security Guard: Prevent deleting or modifying conversionRate / isBaseUnit for existing units used in logs
      for (const oldUnit of existingItem.units) {
        const matchingNewUnit = processedUnits.find(nu => nu.id === oldUnit.id || (oldUnit.id && nu.name === oldUnit.name));
        if (!matchingNewUnit) {
          return res.status(400).json({
            error: `لا يمكن حذف الوحدة "${oldUnit.name}" لأنها مستخدمة بالفعل في حركات مخزون سابقة`
          });
        }
        if (matchingNewUnit.isBaseUnit !== oldUnit.isBaseUnit || Math.abs(matchingNewUnit.conversionRate - oldUnit.conversionRate) > 0.0001) {
          return res.status(400).json({
            error: `لا يمكن تعديل معامل تحويل الوحدة "${oldUnit.name}" لأنها مستخدمة في حركات مخزون سابقة`
          });
        }
      }
    }

    const updatedItem = await prisma.$transaction(async (tx) => {
      // Update item name, notes & defaultSellingPrice
      const itemRecord = await tx.item.update({
        where: { id },
        data: {
          name: trimmedName,
          notes: notes ? String(notes).trim() : '',
          defaultSellingPrice: parsedPrice
        }
      });

      if (processedUnits) {
        if (hasStockLogs) {
          // Add only NEW units that don't exist yet
          const existingUnitIds = new Set(existingItem.units.map(u => u.id));
          const newUnitsToCreate = processedUnits.filter(u => !u.id || !existingUnitIds.has(u.id));

          for (const u of newUnitsToCreate) {
            await tx.itemUnit.create({
              data: withMasterLink({
                itemId: id,
                name: u.name,
                isBaseUnit: false,
                conversionRate: u.conversionRate
              }, await resolveMasterUnitId(tx, u.name))
            });
          }

          // Allow updating unit names for existing IDs if conversionRate is preserved
          for (const u of processedUnits) {
            if (u.id && existingUnitIds.has(u.id)) {
              await tx.itemUnit.update({
                where: { id: u.id },
                data: withMasterLink({ name: u.name }, await resolveMasterUnitId(tx, u.name))
              });
            }
          }
        } else {
          // No stock logs exist: full free replacement of units
          await tx.itemUnit.deleteMany({ where: { itemId: id } });
          const unitsWithMaster = [];
          for (const u of processedUnits) {
            unitsWithMaster.push({ ...u, unitId: await resolveMasterUnitId(tx, u.name) });
          }
          await tx.itemUnit.createMany({
            data: unitsWithMaster.map(u => withMasterLink({
              itemId: id,
              name: u.name,
              isBaseUnit: u.isBaseUnit,
              conversionRate: u.conversionRate
            }, u.unitId))
          });
        }
      }

      return await tx.item.findUnique({
        where: { id },
        include: { units: true }
      });
    });

    res.json({
      ...updatedItem,
      _id: updatedItem.id
    });
  } catch (err) {
    console.error('Error updating item:', err);
    res.status(err.message ? 400 : 500).json({ error: err.message || 'فشل في تحديث بيانات الصنف' });
  }
});

// DELETE /api/items/:id - Soft delete / Toggle active state (isActive)
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح' });
    }

    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) {
      return res.status(404).json({ error: 'الصنف غير موجود' });
    }

    const updated = await prisma.item.update({
      where: { id },
      data: {
        isActive: !item.isActive
      }
    });

    res.json({
      success: true,
      id: updated.id,
      isActive: updated.isActive,
      message: updated.isActive ? `تم إعادة تفعيل الصنف "${updated.name}" بنجاح` : `تم تعطيل الصنف "${updated.name}" بنجاح`
    });
  } catch (err) {
    console.error('Error toggling item status:', err);
    res.status(500).json({ error: 'فشل في تغيير حالة الصنف' });
  }
});

// POST /api/items/:id/restock - Restock inventory
router.post('/:id/restock', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { quantity, unitId, notes, supplierId, totalCost } = req.body;

    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: 'معرف الصنف غير صالح' });
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'الكمية يجب أن تكون رقماً موجباً أكبر من صفر' });
    }

    const targetUnitId = parseInt(unitId);
    if (isNaN(targetUnitId) || targetUnitId <= 0) {
      return res.status(400).json({ error: 'الوحدة المحددة غير صالحة' });
    }

    const unit = await prisma.itemUnit.findFirst({
      where: { id: targetUnitId, itemId: id }
    });

    if (!unit) {
      return res.status(400).json({ error: 'الوحدة المحددة غير مرتبطة بهذا الصنف' });
    }

    // المورد المرتبط بالتوريد (اختياري) — يُتجاهل بصمت قبل تطبيق ترحيل الموردين
    let restockSupplierId = null;
    let restockSupplierName = '';
    if (supplierId !== undefined && supplierId !== null && supplierId !== '') {
      if (!prisma.supplier) {
        restockSupplierId = null;
      } else {
        const sid = parseInt(supplierId);
        if (isNaN(sid) || sid <= 0) {
          return res.status(400).json({ error: 'المورد المحدد غير صالح' });
        }
        const supplier = await prisma.supplier.findUnique({ where: { id: sid } });
        if (!supplier) {
          return res.status(404).json({ error: 'المورد غير موجود' });
        }
        if (supplier.isActive === false) {
          return res.status(400).json({ error: 'لا يمكن التوريد من مورد معطّل — أعد تفعيله أولًا' });
        }
        restockSupplierId = supplier.id;
        restockSupplierName = supplier.name;
      }
    }

    const quantityBase = qty * Number(unit.conversionRate);

    // تكلفة التوريد الإجمالية (اختيارية) — تُسجل كمستحق للمورد وتتطلب تحديد المورد
    let restockCost = 0;
    if (totalCost !== undefined && totalCost !== null && totalCost !== '') {
      restockCost = Math.round(Number(totalCost));
      if (isNaN(restockCost) || restockCost < 0) {
        return res.status(400).json({ error: 'تكلفة التوريد يجب أن تكون رقمًا موجبًا' });
      }
      if (restockCost > 0 && !restockSupplierId) {
        return res.status(400).json({ error: 'تسجيل تكلفة التوريد يتطلب تحديد المورد' });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const latestLog = await tx.stockLog.findFirst({
        where: { itemId: id },
        orderBy: { id: 'desc' }
      });

      const currentBalance = latestLog ? (Number(latestLog.balanceAfter) || 0) : 0;
      const balanceAfter = currentBalance + quantityBase;

      const restockNote = notes && String(notes).trim()
        ? `توريد (${qty} ${unit.name})${restockSupplierName ? ` من ${restockSupplierName}` : ''}: ${String(notes).trim()}`
        : `توريد (${qty} ${unit.name})${restockSupplierName ? ` من ${restockSupplierName}` : ''}`;

      const stockLogData = {
        itemId: id,
        changeType: 'restock',
        quantityBase,
        balanceAfter,
        notes: restockNote
      };
      // تضمين المورد فقط عند دعم العمود (توافق قبل الترحيل)
      try {
        if (restockSupplierId && tx.stockLog && tx.stockLog.fields && tx.stockLog.fields.supplierId) {
          stockLogData.supplierId = restockSupplierId;
        }
      } catch { /* وضع التوافق — بدون ربط */ }

      const stockLog = await tx.stockLog.create({ data: stockLogData });

      // مستحق المورد: توريد آجل بقيمة التكلفة (يتجاوز بصمت قبل ترحيل الدفتر)
      let purchaseTx = null;
      try {
        if (restockCost > 0 && restockSupplierId && tx.supplierTransaction) {
          purchaseTx = await tx.supplierTransaction.create({
            data: {
              supplierId: restockSupplierId,
              type: 'purchase',
              amount: restockCost,
              notes: `توريد ${unit.name} × ${qty}${restockSupplierName ? ` — ${restockSupplierName}` : ''}`,
              stockLogId: stockLog.id,
              date: new Date()
            }
          });
        }
      } catch (ledgerErr) {
        console.warn('[suppliers] ledger unavailable, skipping payable:', ledgerErr.message);
      }

      return { stockLog, balanceAfter, purchaseTx };
    });

    res.status(201).json({
      stockLog: result.stockLog,
      currentStock: result.balanceAfter,
      purchaseTransaction: result.purchaseTx || undefined,
      message: result.purchaseTx
        ? 'تم توريد المخزون وتسجيل المستحق للمورد بنجاح'
        : 'تم توريد المخزون بنجاح'
    });
  } catch (err) {
    console.error('Error restocking item:', err);
    res.status(500).json({ error: 'فشل في إضافة التوريد للمخزون' });
  }
});

module.exports = router;
