import { Prisma, ProductionStatus, ProductType, InventoryMovementType } from '@prisma/client';
import { recordInventoryMovement } from './inventory.js';
import { recordAudit, resolveActorId } from './audit.js';
export class ProductionOperationError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function generateBatchNumber(prisma, factoryId) {
  const factory = await prisma.factory.findUnique({
    where: {
      id: factoryId,
    },
    select: {
      code: true,
    },
  });
  const prefix = factory ? `PR-${factory.code}` : 'PR';
  const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '');
  const count = await prisma.productionRecord.count({
    where: {
      factoryId,
    },
  });
  const seq = String(count + 1).padStart(4, '0');
  const candidate = `${prefix}-${yearMonth}-${seq}`;
  const existing = await prisma.productionRecord.findUnique({
    where: {
      batchNumber: candidate,
    },
  });
  if (existing) {
    return `${prefix}-${yearMonth}-${String(count + 10).padStart(4, '0')}`;
  }
  return candidate;
}
export async function createProductionRecord(prisma, actorId, input) {
  if (input.rawMaterialQuantity <= 0) {
    throw new ProductionOperationError('Raw material quantity must be greater than zero.', 400);
  }
  if (input.finishedQuantity <= 0) {
    throw new ProductionOperationError('Finished product quantity must be greater than zero.', 400);
  }
  const rawProduct = await prisma.product.findUnique({
    where: {
      id: input.rawMaterialId,
    },
  });
  if (!rawProduct) throw new ProductionOperationError('Raw material product not found.', 404);
  if (rawProduct.type !== ProductType.RAW_MATERIAL) {
    throw new ProductionOperationError(
      `Product ${rawProduct.name} is not classified as a raw material.`,
      400
    );
  }
  const finProduct = await prisma.product.findUnique({
    where: {
      id: input.finishedProductId,
    },
  });
  if (!finProduct) throw new ProductionOperationError('Finished product not found.', 404);
  if (finProduct.type !== ProductType.FINISHED_PRODUCT) {
    throw new ProductionOperationError(
      `Product ${finProduct.name} is not classified as a finished product.`,
      400
    );
  }
  const batchNumber = await generateBatchNumber(prisma, input.factoryId);
  const safeActorId = await resolveActorId(prisma, actorId);
  const record = await prisma.productionRecord.create({
    data: {
      batchNumber,
      factoryId: input.factoryId,
      rawMaterialId: input.rawMaterialId,
      rawMaterialQuantity: input.rawMaterialQuantity,
      finishedProductId: input.finishedProductId,
      finishedQuantity: input.finishedQuantity,
      wastageQuantity: input.wastageQuantity ?? 0,
      status: ProductionStatus.DRAFT,
      productionDate: input.productionDate ?? new Date(),
      remarks: input.remarks ?? null,
      createdById: safeActorId,
    },
    include: {
      factory: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      rawMaterial: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
        },
      },
      finishedProduct: {
        select: {
          id: true,
          sku: true,
          name: true,
          unit: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  void recordAudit(prisma, {
    userId: actorId,
    action: 'CREATE_PRODUCTION_BATCH',
    entity: 'ProductionRecord',
    entityId: record.id,
    factoryId: input.factoryId,
    details: {
      batchNumber,
      rawMaterial: rawProduct.sku,
      output: finProduct.sku,
    },
  });
  return record;
}
export async function completeProductionBatch(prisma, batchId, actorId, options) {
  return await prisma.$transaction(
    async (tx) => {
      const batch = await tx.productionRecord.findUnique({
        where: {
          id: batchId,
        },
        include: {
          rawMaterial: true,
          finishedProduct: true,
          factory: true,
          createdBy: true,
        },
      });
      if (!batch) throw new ProductionOperationError('Production batch not found.', 404);
      if (batch.status === ProductionStatus.COMPLETED) {
        throw new ProductionOperationError('This production batch is already completed.', 400);
      }
      const defaultWarehouse = await tx.warehouse.findFirst({
        where: {
          factoryId: batch.factoryId,
          isDefault: true,
        },
      });
      if (!defaultWarehouse) {
        throw new ProductionOperationError('Factory default warehouse not configured.', 404);
      }
      const rawReq = Number(batch.rawMaterialQuantity);
      const finYield =
        options?.actualQuantity && options.actualQuantity > 0
          ? Number(options.actualQuantity)
          : Number(batch.finishedQuantity);
      let rawBalance = await tx.inventoryBalance.findFirst({
        where: {
          factoryId: batch.factoryId,
          productId: batch.rawMaterialId,
          quantity: {
            gte: rawReq,
          },
        },
      });
      if (!rawBalance) {
        rawBalance = await tx.inventoryBalance.findFirst({
          where: {
            factoryId: batch.factoryId,
            productId: batch.rawMaterialId,
          },
        });
      }
      const rawWarehouseId = rawBalance?.warehouseId ?? defaultWarehouse.id;
      const currentStock = rawBalance ? Number(rawBalance.quantity) : 0;
      if (currentStock < rawReq) {
        throw new ProductionOperationError(
          `Insufficient raw material stock for batch completion. Product: ${batch.rawMaterial.name} (${batch.rawMaterial.sku}). In stock: ${currentStock} ${batch.rawMaterial.unit}, Required: ${rawReq} ${batch.rawMaterial.unit}.`,
          409
        );
      }
      const finBalance = await tx.inventoryBalance.findFirst({
        where: {
          factoryId: batch.factoryId,
          productId: batch.finishedProductId,
        },
      });
      const finWarehouseId = finBalance?.warehouseId ?? defaultWarehouse.id;
      await recordInventoryMovement(
        prisma,
        actorId,
        {
          factoryId: batch.factoryId,
          warehouseId: rawWarehouseId,
          productId: batch.rawMaterialId,
          type: InventoryMovementType.STOCK_OUT,
          quantity: rawReq,
          reason: `Production Input Consumed: Batch ${batch.batchNumber}`,
          reference: batch.batchNumber,
          remarks: `Raw material ${batch.rawMaterial.name} used in production`,
        },
        tx
      );
      await recordInventoryMovement(
        prisma,
        actorId,
        {
          factoryId: batch.factoryId,
          warehouseId: finWarehouseId,
          productId: batch.finishedProductId,
          type: InventoryMovementType.STOCK_IN,
          quantity: finYield,
          reason: `Production Finished Goods Yield: Batch ${batch.batchNumber}`,
          reference: batch.batchNumber,
          remarks: `Produced ${finYield} ${batch.finishedProduct.unit} of ${batch.finishedProduct.name}`,
        },
        tx
      );
      const updatedRemarks =
        options?.remarks || options?.notes
          ? [batch.remarks, options.remarks || options.notes].filter(Boolean).join(' | ')
          : batch.remarks;
      const updated = await tx.productionRecord.update({
        where: {
          id: batch.id,
        },
        data: {
          status: ProductionStatus.COMPLETED,
          completedAt: new Date(),
          finishedQuantity: finYield,
          remarks: updatedRemarks,
        },
        include: {
          rawMaterial: {
            select: {
              id: true,
              sku: true,
              name: true,
              unit: true,
            },
          },
          finishedProduct: {
            select: {
              id: true,
              sku: true,
              name: true,
              unit: true,
            },
          },
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      return updated;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    }
  );
}
