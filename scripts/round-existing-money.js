require('dotenv').config();
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const prisma = require('../lib/prisma');

const fields = {
  invoice: ['amount', 'discountAmount', 'paidAmount'],
  invoiceItem: ['unitPrice', 'lineTotal'],
  invoiceService: ['price'],
  item: ['defaultSellingPrice'],
  supplierTransaction: ['amount']
};

async function snapshot(db) {
  const result = {};
  for (const [model, columns] of Object.entries(fields)) {
    result[model] = await db[model].findMany({ select: Object.fromEntries(['id', ...columns].map(key => [key, true])) });
  }
  return result;
}
function audit(data) {
  return Object.fromEntries(Object.entries(fields).map(([model, columns]) => [model,
    data[model].filter(row => columns.some(key => row[key] !== null && !Number.isInteger(row[key]))).length
  ]));
}

async function main() {
  if (!process.argv.includes('--apply')) {
    console.log('Rows with fractional money:', audit(await snapshot(prisma)));
    return;
  }
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260911_whole_money/migration.sql'), 'utf8');
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "Invoice", "InvoiceItem", "InvoiceService", "Item", "SupplierTransaction" IN SHARE ROW EXCLUSIVE MODE');
    const before = await snapshot(tx);
    const backupPath = path.join(os.tmpdir(), `hisabat-money-before-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(before), { mode: 0o600 });
    console.log('Backup:', backupPath);
    console.log('Before:', audit(before));
    await tx.$executeRawUnsafe(sql);
    const after = audit(await snapshot(tx));
    if (Object.values(after).some(count => count !== 0)) throw new Error('Fractional money remains; rolling back');
    const mismatches = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "Invoice" i
      WHERE i.type = 'purchase' AND EXISTS (SELECT 1 FROM "InvoiceItem" b WHERE b."invoiceId" = i.id)
      AND i.amount <> greatest(0, (SELECT sum(b."lineTotal") FROM "InvoiceItem" b WHERE b."invoiceId" = i.id) - i."discountAmount")
        + coalesce((SELECT sum(s.price) FROM "InvoiceService" s WHERE s."invoiceId" = i.id), 0)`);
    if (mismatches[0].count) throw new Error('Invoice totals disagree with lines; rolling back');
    // The attempted write is rolled back by the nested exception block.
    await tx.$executeRawUnsafe(`DO $$ BEGIN
      BEGIN
        UPDATE "Invoice" SET amount = amount + 0.25 WHERE id = (SELECT min(id) FROM "Invoice");
        RAISE EXCEPTION 'Fractional write was not blocked';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
    END $$;`);
    console.log('After:', after);
    console.log('Invoice totals verified; fractional database write rejected.');
  }, { timeout: 60000 });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
