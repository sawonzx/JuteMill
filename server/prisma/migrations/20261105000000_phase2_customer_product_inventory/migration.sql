-- Extend Phase 1 records while preserving existing demo orders and inventory.
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ProductType" AS ENUM ('RAW_MATERIAL', 'FINISHED_PRODUCT');
CREATE TYPE "InventoryMovementType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT');

CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FactoryProductThreshold" (
    "id" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minimumQuantity" DECIMAL(14,3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FactoryProductThreshold_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FactoryProductThreshold" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "previousQuantity" DECIMAL(14,3) NOT NULL,
    "resultingQuantity" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,
    "reference" TEXT,
    "remarks" TEXT,
    "createdById" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Customer"
    ADD COLUMN "factoryId" TEXT,
    ADD COLUMN "contactPerson" TEXT,
    ADD COLUMN "notes" TEXT,
    ADD COLUMN "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "type" "CustomerType" NOT NULL DEFAULT 'BUSINESS',
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Product"
    ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "type" "ProductType" NOT NULL DEFAULT 'FINISHED_PRODUCT',
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "standardPrice" DROP NOT NULL;

ALTER TABLE "Inventory" ADD COLUMN "warehouseId" TEXT;

INSERT INTO "Warehouse" ("id", "factoryId", "code", "name", "isDefault")
SELECT 'WH-' || "code", "id", 'MAIN', "name" || ' Main Warehouse', true
FROM "Factory";

-- Give every existing customer a home factory. Customers already used by
-- multiple factories receive a factory-local copy and retain each order link.
WITH homes AS (
    SELECT DISTINCT ON (so."customerId") so."customerId", so."factoryId"
    FROM "SalesOrder" so JOIN "Factory" f ON f."id" = so."factoryId"
    ORDER BY so."customerId", f."code"
)
UPDATE "Customer" c SET "factoryId" = COALESCE(
    (SELECT h."factoryId" FROM homes h WHERE h."customerId" = c."id"),
    (SELECT f."id" FROM "Factory" f ORDER BY f."code" LIMIT 1)
);

-- Phase 1 made codes globally unique; Phase 2 scopes them by factory so
-- legacy customers split across factories can keep their original code.
DROP INDEX "Customer_code_key";

WITH assignments AS (
    SELECT c."id" AS "customerId", so."factoryId",
           row_number() OVER (PARTITION BY c."id" ORDER BY f."code") AS row_num
    FROM "Customer" c
    JOIN (SELECT DISTINCT "customerId", "factoryId" FROM "SalesOrder") so ON so."customerId" = c."id"
    JOIN "Factory" f ON f."id" = so."factoryId"
)
INSERT INTO "Customer" ("id", "factoryId", "name", "code", "contactPerson", "type", "status", "email", "phone", "address", "city", "notes", "createdAt", "updatedAt")
SELECT 'legacy-' || md5(c."id" || ':' || a."factoryId"), a."factoryId", c."name", c."code", COALESCE(c."contactPerson", c."name"), c."type", c."status", c."email", COALESCE(c."phone", ''), c."address", c."city", c."notes", c."createdAt", CURRENT_TIMESTAMP
FROM assignments a JOIN "Customer" c ON c."id" = a."customerId"
WHERE a.row_num > 1;

WITH assignments AS (
    SELECT c."id" AS "customerId", so."factoryId",
           row_number() OVER (PARTITION BY c."id" ORDER BY f."code") AS row_num
    FROM "Customer" c
    JOIN (SELECT DISTINCT "customerId", "factoryId" FROM "SalesOrder") so ON so."customerId" = c."id"
    JOIN "Factory" f ON f."id" = so."factoryId"
)
UPDATE "SalesOrder" so SET "customerId" = 'legacy-' || md5(so."customerId" || ':' || so."factoryId")
FROM assignments a
WHERE so."customerId" = a."customerId" AND so."factoryId" = a."factoryId" AND a.row_num > 1;

UPDATE "Invoice" i SET "customerId" = 'legacy-' || md5(i."customerId" || ':' || i."factoryId")
WHERE EXISTS (SELECT 1 FROM "Customer" c WHERE c."id" = i."customerId" AND c."factoryId" <> i."factoryId")
  AND EXISTS (SELECT 1 FROM "Customer" local_c WHERE local_c."id" = 'legacy-' || md5(i."customerId" || ':' || i."factoryId"));

UPDATE "Customer" SET "contactPerson" = "name", "phone" = COALESCE("phone", 'Not provided');
ALTER TABLE "Customer" ALTER COLUMN "factoryId" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "contactPerson" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "phone" SET NOT NULL;
ALTER TABLE "Customer" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "updatedAt" DROP DEFAULT;

UPDATE "Inventory" i SET "warehouseId" = w."id"
FROM "Warehouse" w WHERE w."factoryId" = i."factoryId" AND w."isDefault" = true;

-- Convert each Phase 1 balance into an opening movement so every carried
-- balance has ledger provenance, and carry forward its reorder threshold.
INSERT INTO "FactoryProductThreshold" ("id", "factoryId", "productId", "minimumQuantity")
SELECT 'TH-' || md5(i."factoryId" || ':' || i."productId"), i."factoryId", i."productId", i."reorderLevel"
FROM "Inventory" i;

INSERT INTO "InventoryMovement" ("id", "idempotencyKey", "requestHash", "factoryId", "warehouseId", "productId", "type", "quantity", "previousQuantity", "resultingQuantity", "reason", "reference", "createdById", "transactionDate")
SELECT 'OPEN-' || md5(i."factoryId" || ':' || i."productId"), 'OPENING-' || md5(i."factoryId" || ':' || i."productId"), md5('phase1:' || i."factoryId" || ':' || i."productId"), i."factoryId", i."warehouseId", i."productId", 'STOCK_IN', i."quantity", 0, i."quantity", 'Phase 1 balance conversion', 'MIGRATION-OPENING', u."id", i."updatedAt"
FROM "Inventory" i CROSS JOIN LATERAL (SELECT "id" FROM "User" WHERE "role" = 'HEAD_OFFICE_ADMIN' ORDER BY "createdAt" LIMIT 1) u;

ALTER TABLE "Inventory" ALTER COLUMN "warehouseId" SET NOT NULL;
ALTER TABLE "Inventory" ALTER COLUMN "quantity" TYPE DECIMAL(14,3);
ALTER TABLE "Inventory" DROP COLUMN "reorderLevel";

DROP INDEX "Inventory_factoryId_productId_key";
CREATE UNIQUE INDEX "Customer_factoryId_code_key" ON "Customer"("factoryId", "code");
CREATE INDEX "Customer_factoryId_name_idx" ON "Customer"("factoryId", "name");
CREATE INDEX "Customer_factoryId_status_idx" ON "Customer"("factoryId", "status");
CREATE INDEX "Product_status_type_category_idx" ON "Product"("status", "type", "category");
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE UNIQUE INDEX "Warehouse_factoryId_code_key" ON "Warehouse"("factoryId", "code");
CREATE UNIQUE INDEX "Warehouse_id_factoryId_key" ON "Warehouse"("id", "factoryId");
CREATE UNIQUE INDEX "FactoryProductThreshold_factoryId_productId_key" ON "FactoryProductThreshold"("factoryId", "productId");
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");
CREATE INDEX "InventoryMovement_factoryId_transactionDate_idx" ON "InventoryMovement"("factoryId", "transactionDate");
CREATE INDEX "InventoryMovement_productId_transactionDate_idx" ON "InventoryMovement"("productId", "transactionDate");
CREATE INDEX "InventoryMovement_warehouseId_transactionDate_idx" ON "InventoryMovement"("warehouseId", "transactionDate");
CREATE UNIQUE INDEX "Inventory_warehouseId_productId_key" ON "Inventory"("warehouseId", "productId");
CREATE INDEX "Inventory_factoryId_productId_idx" ON "Inventory"("factoryId", "productId");

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_warehouseId_factoryId_fkey" FOREIGN KEY ("warehouseId", "factoryId") REFERENCES "Warehouse"("id", "factoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FactoryProductThreshold" ADD CONSTRAINT "FactoryProductThreshold_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FactoryProductThreshold" ADD CONSTRAINT "FactoryProductThreshold_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Factory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_warehouseId_factoryId_fkey" FOREIGN KEY ("warehouseId", "factoryId") REFERENCES "Warehouse"("id", "factoryId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
