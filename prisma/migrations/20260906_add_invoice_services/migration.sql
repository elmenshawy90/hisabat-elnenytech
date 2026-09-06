-- CreateTable: بنود الخدمات الإضافية (أخري) للفواتير
CREATE TABLE "InvoiceService" (
    "id" SERIAL NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceService_invoiceId_idx" ON "InvoiceService"("invoiceId");

-- AddForeignKey
ALTER TABLE "InvoiceService" ADD CONSTRAINT "InvoiceService_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
