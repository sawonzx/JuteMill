import { Prisma, OrderStatus, ProductType, InventoryMovementType } from '@prisma/client';
import { recordInventoryMovement } from './inventory.js';
import { recordAudit } from './audit.js';
export class OrderOperationError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function generateOrderNumber(prisma, factoryId) {
  const factory = await prisma.factory.findUnique({
    where: {
      id: factoryId,
    },
    select: {
      code: true,
    },
  });
  const prefix = factory ? `SO-${factory.code}` : 'SO';
  const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '');
  const count = await prisma.salesOrder.count({
    where: {
      factoryId,
    },
  });
  const seq = String(count + 1).padStart(4, '0');
  const candidate = `${prefix}-${yearMonth}-${seq}`;
  const existing = await prisma.salesOrder.findUnique({
    where: {
      orderNumber: candidate,
    },
  });
  if (existing) {
    return `${prefix}-${yearMonth}-${String(count + 10).padStart(4, '0')}`;
  }
  return candidate;
}
export async function createSalesOrder(prisma, actorId, input) {
  if (!input.lines.length) {
    throw new OrderOperationError('Sales order must contain at least one line item.', 400);
  }
  const customer = await prisma.customer.findFirst({
    where: {
      id: input.customerId,
      factoryId: input.factoryId,
    },
  });
  if (!customer) {
    throw new OrderOperationError('Customer does not belong to the selected factory.', 400);
  }
  const productIds = input.lines.map((l) => l.productId);
  const products = await prisma.product.findMany({
    where: {
      id: {
        in: productIds,
      },
    },
  });
  if (products.length !== productIds.length) {
    throw new OrderOperationError('One or more selected products do not exist.', 400);
  }
  for (const product of products) {
    if (product.type !== ProductType.FINISHED_PRODUCT) {
      throw new OrderOperationError(
        `Product ${product.name} (${product.sku}) is a raw material. Only finished products can be added to sales orders.`,
        400
      );
    }
    if (product.status !== 'ACTIVE') {
      throw new OrderOperationError(
        `Product ${product.name} is inactive and cannot be ordered.`,
        400
      );
    }
  }
  const orderNumber = await generateOrderNumber(prisma, input.factoryId);
  let subtotal = 0;
  const preparedLines = input.lines.map((line) => {
    const lineTotal = Number((line.quantity * line.unitPrice).toFixed(2));
    subtotal += lineTotal;
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: lineTotal,
    };
  });
  const total = subtotal;
  const order = await prisma.salesOrder.create({
    data: {
      orderNumber,
      factoryId: input.factoryId,
      customerId: input.customerId,
      status: OrderStatus.DRAFT,
      orderDate: input.orderDate ?? new Date(),
      dueDate: input.dueDate,
      subtotal,
      total,
      deliveryAddress: input.deliveryAddress ?? customer.address,
      notes: input.notes ?? null,
      createdById: actorId,
      lines: {
        create: preparedLines,
      },
    },
    include: {
      customer: {
        select: {
          id: true,
          code: true,
          name: true,
          phone: true,
        },
      },
      factory: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              unit: true,
            },
          },
        },
      },
    },
  });
  void recordAudit(prisma, {
    userId: actorId,
    action: 'CREATE_SALES_ORDER',
    entity: 'SalesOrder',
    entityId: order.id,
    factoryId: input.factoryId,
    details: {
      orderNumber: order.orderNumber,
      total,
    },
  });
  return order;
}
export async function fulfillSalesOrder(prisma, orderId, actorId) {
  return await prisma.$transaction(
    async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: {
          id: orderId,
        },
        include: {
          lines: {
            include: {
              product: true,
            },
          },
          factory: true,
        },
      });
      if (!order) throw new OrderOperationError('Sales order not found.', 404);
      if (order.status === OrderStatus.FULFILLED) {
        throw new OrderOperationError('Order has already been fulfilled.', 400);
      }
      if (order.status === OrderStatus.CANCELLED) {
        throw new OrderOperationError('Cancelled orders cannot be fulfilled.', 400);
      }
      const defaultWarehouse = await tx.warehouse.findFirst({
        where: {
          factoryId: order.factoryId,
          isDefault: true,
        },
      });
      if (!defaultWarehouse) {
        throw new OrderOperationError('Factory default warehouse not configured.', 404);
      }
      const targetWarehouses = new Map();
      for (const line of order.lines) {
        let balance = await tx.inventoryBalance.findFirst({
          where: {
            factoryId: order.factoryId,
            productId: line.productId,
            quantity: {
              gte: Number(line.quantity),
            },
          },
        });
        if (!balance) {
          balance = await tx.inventoryBalance.findFirst({
            where: {
              factoryId: order.factoryId,
              productId: line.productId,
            },
          });
        }
        const targetWhId = balance?.warehouseId ?? defaultWarehouse.id;
        targetWarehouses.set(line.productId, targetWhId);
        const currentStock = balance ? Number(balance.quantity) : 0;
        const required = Number(line.quantity);
        if (currentStock < required) {
          throw new OrderOperationError(
            `Insufficient stock to fulfill order. Product: ${line.product.name} (${line.product.sku}). In stock: ${currentStock} ${line.product.unit}, Required: ${required} ${line.product.unit}.`,
            409
          );
        }
      }
      for (const line of order.lines) {
        const required = Number(line.quantity);
        const whId = targetWarehouses.get(line.productId) ?? defaultWarehouse.id;
        await recordInventoryMovement(
          prisma,
          actorId,
          {
            factoryId: order.factoryId,
            warehouseId: whId,
            productId: line.productId,
            type: InventoryMovementType.STOCK_OUT,
            quantity: required,
            reason: `Sales Order Fulfillment: ${order.orderNumber}`,
            reference: order.orderNumber,
            remarks: `Order line fulfillment for ${line.product.name}`,
          },
          tx
        );
      }
      const updated = await tx.salesOrder.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.FULFILLED,
          fulfilledAt: new Date(),
        },
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          lines: {
            include: {
              product: {
                select: {
                  id: true,
                  sku: true,
                  name: true,
                  unit: true,
                },
              },
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
export async function cancelSalesOrder(prisma, orderId, actorId, reason) {
  const order = await prisma.salesOrder.findUnique({
    where: {
      id: orderId,
    },
  });
  if (!order) throw new OrderOperationError('Sales order not found.', 404);
  if (order.status === OrderStatus.FULFILLED) {
    throw new OrderOperationError('Fulfilled orders cannot be cancelled.', 400);
  }
  if (order.status === OrderStatus.CANCELLED) {
    throw new OrderOperationError('Order is already cancelled.', 400);
  }
  const invoice = await prisma.invoice.findFirst({
    where: {
      orderId,
    },
  });
  if (invoice && invoice.status !== 'VOID') {
    throw new OrderOperationError('Cannot cancel an order that has an active invoice.', 400);
  }
  const updated = await prisma.salesOrder.update({
    where: {
      id: orderId,
    },
    data: {
      status: OrderStatus.CANCELLED,
      cancelledAt: new Date(),
      notes: reason
        ? `${order.notes ? order.notes + ' | ' : ''}Cancellation reason: ${reason}`
        : order.notes,
    },
  });
  void recordAudit(prisma, {
    userId: actorId,
    action: 'CANCEL_SALES_ORDER',
    entity: 'SalesOrder',
    entityId: order.id,
    factoryId: order.factoryId,
    details: {
      orderNumber: order.orderNumber,
      reason,
    },
  });
  return updated;
}
