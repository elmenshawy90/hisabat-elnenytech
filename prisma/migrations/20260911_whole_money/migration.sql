-- Monetary values are whole EGP. Quantities and conversion rates remain fractional.
DO $$
BEGIN
  UPDATE "Item" SET "defaultSellingPrice" = round("defaultSellingPrice"::numeric)::double precision
    WHERE "defaultSellingPrice" <> round("defaultSellingPrice"::numeric)::double precision;
  UPDATE "InvoiceItem" SET "unitPrice" = round("unitPrice"::numeric)::double precision;
  UPDATE "InvoiceItem" SET "lineTotal" = round((quantity::numeric * "unitPrice"::numeric))::double precision;
  UPDATE "InvoiceService" SET price = round(price::numeric)::double precision;
  UPDATE "SupplierTransaction" SET amount = round(amount::numeric)::double precision;
  UPDATE "Invoice" SET amount = round(amount::numeric)::double precision,
    "discountAmount" = round("discountAmount"::numeric)::double precision,
    "paidAmount" = round("paidAmount"::numeric)::double precision;
  -- The invoice must still agree with its rounded lines, discount and services.
  UPDATE "Invoice" i SET
    "discountAmount" = least(i."discountAmount", b.subtotal),
    amount = greatest(0, b.subtotal - i."discountAmount") +
      coalesce((SELECT sum(s.price) FROM "InvoiceService" s WHERE s."invoiceId" = i.id), 0)
  FROM (SELECT "invoiceId", sum("lineTotal") AS subtotal FROM "InvoiceItem" GROUP BY "invoiceId") b
  WHERE i.id = b."invoiceId" AND i.type = 'purchase';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_whole_money') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_whole_money"
      CHECK (amount = trunc(amount) AND "discountAmount" = trunc("discountAmount") AND "paidAmount" = trunc("paidAmount"));
    ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_whole_money"
      CHECK ("unitPrice" = trunc("unitPrice") AND "lineTotal" = trunc("lineTotal"));
    ALTER TABLE "InvoiceService" ADD CONSTRAINT "InvoiceService_whole_money" CHECK (price = trunc(price));
    ALTER TABLE "Item" ADD CONSTRAINT "Item_whole_money" CHECK ("defaultSellingPrice" = trunc("defaultSellingPrice"));
    ALTER TABLE "SupplierTransaction" ADD CONSTRAINT "SupplierTransaction_whole_money" CHECK (amount = trunc(amount));
  END IF;
END $$;
