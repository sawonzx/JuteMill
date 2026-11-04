import { Prisma, PrismaClient, InventoryMovementType, RecordStatus } from '@prisma/client'
import { createHash } from 'node:crypto'

export class InventoryOperationError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

export type MovementInput = {
  factoryId: string
  warehouseId?: string
  productId: string
  type: InventoryMovementType
  quantity?: number
  adjustmentMode?: 'SET' | 'DELTA'
  reason?: string
  reference?: string
  remarks?: string
  idempotencyKey: string
  transactionDate?: Date
}

const toMilli = (value: number) => BigInt(Math.round(value * 1000))
const fromMilli = (value: bigint) => {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 1000n
  const fraction = String(absolute % 1000n).padStart(3, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

function isKnownRequestError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError
}

export async function recordInventoryMovement(prisma: PrismaClient, actorId: string, input: MovementInput) {
  const requestHash = createHash('sha256').update(JSON.stringify({ ...input, quantity: input.quantity ?? null, transactionDate: input.transactionDate?.toISOString() ?? null })).digest('hex')
  const duplicate = await prisma.inventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (duplicate) {
    if (duplicate.requestHash !== requestHash) throw new InventoryOperationError('That submission key was already used for a different stock transaction.', 409)
    return { movement: duplicate, duplicate: true }
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const movement = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, status: true } })
        if (!product) throw new InventoryOperationError('Product not found.', 404)
        if (product.status !== RecordStatus.ACTIVE) throw new InventoryOperationError('Inactive products cannot receive stock movements.', 409)

        const warehouse = input.warehouseId
          ? await tx.warehouse.findFirst({ where: { id: input.warehouseId, factoryId: input.factoryId } })
          : await tx.warehouse.findFirst({ where: { factoryId: input.factoryId, isDefault: true } })
        if (!warehouse) throw new InventoryOperationError('The selected factory has no matching default warehouse.', 404)

        const existing = await tx.inventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
        if (existing) {
          if (existing.requestHash !== requestHash) throw new InventoryOperationError('That submission key was already used for a different stock transaction.', 409)
          return existing
        }

        const balance = await tx.inventoryBalance.upsert({
          where: { warehouseId_productId: { warehouseId: warehouse.id, productId: input.productId } },
          update: {},
          create: { factoryId: input.factoryId, warehouseId: warehouse.id, productId: input.productId, quantity: '0.000' },
        })
        const previous = toMilli(Number(balance.quantity))
        let delta: bigint
        if (input.type === InventoryMovementType.STOCK_IN) delta = toMilli(input.quantity!)
        else if (input.type === InventoryMovementType.STOCK_OUT) delta = -toMilli(input.quantity!)
        else if (input.adjustmentMode === 'SET') delta = toMilli(input.quantity!) - previous
        else delta = toMilli(input.quantity!)
        const resulting = previous + delta
        if (resulting < 0n) throw new InventoryOperationError('Insufficient stock. Stock cannot become negative.', 409)
        if (delta === 0n) throw new InventoryOperationError('This adjustment would not change the current stock.', 422)

        const updatedBalance = await tx.inventoryBalance.update({ where: { id: balance.id }, data: { quantity: fromMilli(resulting) } })
        return tx.inventoryMovement.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            requestHash,
            factoryId: input.factoryId,
            warehouseId: warehouse.id,
            productId: input.productId,
            type: input.type,
            quantity: fromMilli(delta < 0n ? -delta : delta),
            previousQuantity: fromMilli(previous),
            resultingQuantity: updatedBalance.quantity,
            reason: input.reason,
            reference: input.reference,
            remarks: input.remarks,
            createdById: actorId,
            transactionDate: input.transactionDate,
          },
        })
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      return { movement, duplicate: false }
    } catch (error) {
      if (error instanceof InventoryOperationError) throw error
      if (isKnownRequestError(error) && error.code === 'P2002') {
        const existing = await prisma.inventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
        if (existing && existing.requestHash === requestHash) return { movement: existing, duplicate: true }
        if (existing) throw new InventoryOperationError('That submission key was already used for a different stock transaction.', 409)
      }
      if (isKnownRequestError(error) && ['P2002', 'P2034'].includes(error.code) && attempt < 3) continue
      throw error
    }
  }
  throw new InventoryOperationError('Could not safely record the stock transaction. Please retry.', 409)
}
