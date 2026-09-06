-- CreateTable: دفتر حساب المورد (مستحقات ومدفوعات)
CREATE TABLE "SupplierTransaction" (
    "id" SERIAL NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "stockLogId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierTransaction_stockLogId_key" ON "SupplierTransaction"("stockLogId");

-- CreateIndex
CREATE INDEX "SupplierTransaction_supplierId_idx" ON "SupplierTransaction"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierTransaction_date_idx" ON "SupplierTransaction"("date");

-- AddForeignKey
ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_stockLogId_fkey" FOREIGN KEY ("stockLogId") REFERENCES "StockLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
