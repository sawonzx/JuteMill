import { Prisma, InventoryMovementType, RecordStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { recordAudit } from './audit.js';
export class InventoryOperationError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const toMilli = (value) => BigInt(Math.round(value * 1000));
const fromMilli = (value) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1000n;
  const fraction = String(absolute % 1000n).padStart(3, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
};
function isKnownRequestError(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}
export async function recordInventoryMovement(prisma, actorId, input, txClient) {
  const idempKey = input.idempotencyKey || `MV-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        factoryId: input.factoryId,
        productId: input.productId,
        type: input.type,
        quantity: input.quantity ?? null,
        mode: input.adjustmentMode ?? null,
        date: input.transactionDate?.toISOString() ?? null,
        key: idempKey,
      })
    )
    .digest('hex');
  const client = txClient || prisma;
  const duplicate = await client.inventoryMovement.findUnique({
    where: {
      idempotencyKey: idempKey,
    },
  });
  if (duplicate) {
    if (duplicate.requestHash !== requestHash) {
      throw new InventoryOperationError(
        'That submission key was already used for a different stock transaction.',
        409
      );
    }
    return {
      movement: duplicate,
      duplicate: true,
    };
  }
  const runOperation = async (tx) => {
    const product = await tx.product.findUnique({
      where: {
        id: input.productId,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        unit: true,
        status: true,
      },
    });
    if (!product) throw new InventoryOperationError('Product not found.', 404);
    if (product.status !== RecordStatus.ACTIVE) {
      throw new InventoryOperationError('Inactive products cannot receive stock movements.', 409);
    }
    const warehouse = input.warehouseId
      ? await tx.warehouse.findFirst({
          where: {
            id: input.warehouseId,
            factoryId: input.factoryId,
          },
        })
      : await tx.warehouse.findFirst({
          where: {
            factoryId: input.factoryId,
            isDefault: true,
          },
        });
    if (!warehouse) {
      throw new InventoryOperationError(
        'The selected factory has no matching default warehouse.',
        404
      );
    }
    const balance = await tx.inventoryBalance.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: warehouse.id,
          productId: input.productId,
        },
      },
      update: {},
      create: {
        factoryId: input.factoryId,
        warehouseId: warehouse.id,
        productId: input.productId,
        quantity: '0.000',
      },
    });
    const previous = toMilli(Number(balance.quantity));
    let delta;
    if (input.type === InventoryMovementType.STOCK_IN) {
      if (!input.quantity || input.quantity <= 0)
        throw new InventoryOperationError('Positive quantity required for stock in.', 400);
      delta = toMilli(input.quantity);
    } else if (input.type === InventoryMovementType.STOCK_OUT) {
      if (!input.quantity || input.quantity <= 0)
        throw new InventoryOperationError('Positive quantity required for stock out.', 400);
      delta = -toMilli(input.quantity);
    } else if (input.adjustmentMode === 'SET') {
      if (input.quantity === undefined || input.quantity < 0)
        throw new InventoryOperationError('Target quantity must be zero or positive.', 400);
      delta = toMilli(input.quantity) - previous;
    } else {
      if (!input.quantity || input.quantity === 0)
        throw new InventoryOperationError('Delta adjustment must be non-zero.', 400);
      delta = toMilli(input.quantity);
    }
    const resulting = previous + delta;
    if (resulting < 0n) {
      const avail = Number(previous) / 1000;
      const req = input.quantity ?? 0;
      throw new InventoryOperationError(
        `Insufficient stock for ${product.name} (${product.sku}). Available: ${avail} ${product.unit}, Requested: ${req} ${product.unit}. Stock cannot become negative.`,
        409
      );
    }
    if (delta === 0n && input.type === InventoryMovementType.ADJUSTMENT) {
      throw new InventoryOperationError('This adjustment would not change the current stock.', 422);
    }
    const updatedBalance = await tx.inventoryBalance.update({
      where: {
        id: balance.id,
      },
      data: {
        quantity: fromMilli(resulting),
      },
    });
    const movement = await tx.inventoryMovement.create({
      data: {
        idempotencyKey: idempKey,
        requestHash,
        factoryId: input.factoryId,
        warehouseId: warehouse.id,
        productId: input.productId,
        type: input.type,
        quantity: fromMilli(delta < 0n ? -delta : delta),
        previousQuantity: fromMilli(previous),
        resultingQuantity: updatedBalance.quantity,
        reason: input.reason ?? null,
        reference: input.reference ?? null,
        remarks: input.remarks ?? null,
        createdById: actorId,
        transactionDate: input.transactionDate ?? new Date(),
      },
    });
    return movement;
  };
  if (txClient) {
    const movement = await runOperation(txClient);
    return {
      movement,
      duplicate: false,
    };
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const movement = await prisma.$transaction(runOperation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      void recordAudit(prisma, {
        userId: actorId,
        action: `INVENTORY_${input.type}`,
        entity: 'InventoryMovement',
        entityId: movement.id,
        factoryId: input.factoryId,
        details: {
          productId: input.productId,
          type: input.type,
          quantity: input.quantity,
        },
      });
      return {
        movement,
        duplicate: false,
      };
    } catch (error) {
      if (error instanceof InventoryOperationError) throw error;
      if (isKnownRequestError(error) && error.code === 'P2002') {
        const existing = await prisma.inventoryMovement.findUnique({
          where: {
            idempotencyKey: idempKey,
          },
        });
        if (existing)
          return {
            movement: existing,
            duplicate: true,
          };
      }
      if (isKnownRequestError(error) && ['P2002', 'P2034'].includes(error.code) && attempt < 3)
        continue;
      throw error;
    }
  }
  throw new InventoryOperationError(
    'Could not safely record the stock transaction. Please retry.',
    409
  );
}
