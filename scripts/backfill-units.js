/**
 * Backfill script: بناء كتالوج الوحدات الرئيسي (Unit) من أسماء وحدات الأصناف الحالية
 * وربط كل ItemUnit بالوحدة الرئيسية المطابقة.
 *
 * آمن وقابل لإعادة التشغيل (idempotent):
 * - ينشئ Unit لكل اسم مميز (بعد trim) غير موجود مسبقًا
 * - يربط ItemUnit.unitId حيث يكون فارغًا فقط
 * - لا يحذف أو يعدل أي بيانات موجودة
 *
 * التشغيل: node scripts/backfill-units.js
 * (يجب تطبيق prisma/migrations/20260906_add_shared_units/migration.sql أولًا)
 */
require('dotenv').config();
const prisma = require('../lib/prisma');

async function main() {
  console.log('[backfill-units] Starting...');

  const itemUnits = await prisma.itemUnit.findMany({
    select: { id: true, itemId: true, name: true, unitId: true }
  });
  console.log(`[backfill-units] Found ${itemUnits.length} item-units.`);

  // تجميع الأسماء المميزة بعد trim
  const nameMap = new Map(); // trimmedName -> [itemUnitIds]
  for (const iu of itemUnits) {
    const trimmed = String(iu.name || '').trim();
    if (!trimmed) continue;
    if (!nameMap.has(trimmed)) nameMap.set(trimmed, []);
    nameMap.get(trimmed).push(iu.id);
  }
  console.log(`[backfill-units] Distinct unit names: ${nameMap.size}`);

  let created = 0;
  let linked = 0;
  let skipped = 0;

  for (const [name, ids] of nameMap) {
    let unit = await prisma.unit.findUnique({ where: { name } });
    if (!unit) {
      try {
        unit = await prisma.unit.create({ data: { name } });
        created++;
        console.log(`[backfill-units] + Created unit "${name}" (id=${unit.id})`);
      } catch (err) {
        // احتمال إنشاء متزامن من عملية أخرى — أعد الجلب
        unit = await prisma.unit.findUnique({ where: { name } });
        if (!unit) {
          console.error(`[backfill-units] ! Failed to create unit "${name}": ${err.message}`);
          skipped += ids.length;
          continue;
        }
      }
    }

    // اربط الوحدات غير المربوطة فقط، وحدّث الاسم ليطابق الكتالوج (trim)
    for (const iuId of ids) {
      const current = itemUnits.find(x => x.id === iuId);
      if (current && current.unitId) {
        skipped++;
        continue;
      }
      try {
        await prisma.itemUnit.update({
          where: { id: iuId },
          data: { unitId: unit.id, name }
        });
        linked++;
      } catch (err) {
        console.error(`[backfill-units] ! Failed to link itemUnit ${iuId} ("${name}"): ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`[backfill-units] Done. created=${created} linked=${linked} skipped=${skipped}`);
}

main()
  .catch(err => {
    console.error('[backfill-units] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
