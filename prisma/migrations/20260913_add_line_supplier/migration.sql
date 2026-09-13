-- Optional per-line supplier name for off-stock items (internal only, never printed)
ALTER TABLE "InvoiceItem" ADD COLUMN "supplierName" TEXT;
