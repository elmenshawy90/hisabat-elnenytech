// Allocate inside the same transaction as the invoice so rolled-back writes consume no number.
async function nextInvoiceCode(tx, date = new Date()) {
  const yearMonth = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const id = `invoice-${yearMonth}`;
  const counter = await tx.counter.upsert({
    where: { id },
    create: { id, value: 1 },
    update: { value: { increment: 1 } }
  });
  return `${yearMonth}-${String(counter.value).padStart(2, '0')}`;
}

module.exports = { nextInvoiceCode };
