-- CreateTable: كتالوج الوحدات الرئيسي المشترك
CREATE TABLE "Unit" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit"("name");
CREATE INDEX "Unit_name_idx" ON "Unit"("name");

-- AlterTable: ربط وحدات الأصناف بالكتالوج الرئيسي (اختياري للحفاظ على البيانات القديمة)
ALTER TABLE "ItemUnit" ADD COLUMN "unitId" INTEGER;

-- AddForeignKey
ALTER TABLE "ItemUnit" ADD CONSTRAINT "ItemUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ItemUnit_unitId_idx" ON "ItemUnit"("unitId");
