import { InvoiceStatus, OrderStatus } from '@prisma/client';
import { recordAudit } from './audit.js';
export class InvoiceOperationError extends Error {
  status;
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function generateInvoiceNumber(prisma, factoryId) {
  const factory = await prisma.factory.findUnique({
    where: {
      id: factoryId,
    },
    select: {
      code: true,
    },
  });
  const prefix = factory ? `INV-${factory.code}` : 'INV';
  const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '');
  const count = await prisma.invoice.count({
    where: {
      factoryId,
    },
  });
  const seq = String(count + 1).padStart(4, '0');
  const candidate = `${prefix}-${yearMonth}-${seq}`;
  const existing = await prisma.invoice.findUnique({
    where: {
      invoiceNumber: candidate,
    },
  });
  if (existing) {
    return `${prefix}-${yearMonth}-${String(count + 10).padStart(4, '0')}`;
  }
  return candidate;
}
export async function createInvoiceFromOrder(prisma, actorId, input) {
  return await prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUnique({
      where: {
        id: input.orderId,
      },
      include: {
        lines: {
          include: {
            product: true,
          },
        },
        invoice: true,
        customer: true,
        factory: true,
      },
    });
    if (!order) throw new InvoiceOperationError('Sales order not found.', 404);
    if (order.status === OrderStatus.CANCELLED) {
      throw new InvoiceOperationError('Cannot create an invoice for a cancelled order.', 400);
    }
    if (order.status === OrderStatus.DRAFT) {
      throw new InvoiceOperationError(
        'Order must be confirmed or fulfilled before an invoice can be issued.',
        400
      );
    }
    if (order.invoice && order.invoice.status !== InvoiceStatus.VOID) {
      throw new InvoiceOperationError(
        `An active invoice (${order.invoice.invoiceNumber}) already exists for this order.`,
        400
      );
    }
    const invoiceNumber = await generateInvoiceNumber(prisma, order.factoryId);
    const invoiceItems = order.lines.map((line) => ({
      productId: line.productId,
      description: `${line.product.name} (${line.product.sku}) - ${line.quantity} ${line.product.unit}`,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.subtotal,
    }));
    const total = Number(order.total);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber,
        factoryId: order.factoryId,
        customerId: order.customerId,
        orderId: order.id,
        status: InvoiceStatus.ISSUED,
        issueDate: new Date(),
        dueDate: input.dueDate,
        subtotal: order.subtotal,
        total: order.total,
        paidAmount: 0,
        balanceDue: order.total,
        notes: input.notes ?? order.notes,
        terms: input.terms ?? 'Net 30 days. Payment due upon agreed terms.',
        items: {
          create: invoiceItems,
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            city: true,
          },
        },
        factory: {
          select: {
            id: true,
            code: true,
            name: true,
            location: true,
            address: true,
          },
        },
        items: {
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
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
          },
        },
      },
    });
    return invoice;
  });
}
export async function voidInvoice(prisma, invoiceId, actorId, reason) {
  const invoice = await prisma.invoice.findUnique({
    where: {
      id: invoiceId,
    },
    include: {
      payments: true,
    },
  });
  if (!invoice) throw new InvoiceOperationError('Invoice not found.', 404);
  if (invoice.status === InvoiceStatus.VOID) {
    throw new InvoiceOperationError('Invoice is already void.', 400);
  }
  if (invoice.payments.length > 0) {
    throw new InvoiceOperationError(
      'Cannot void an invoice that has recorded payments. Reverse or adjust payments first.',
      400
    );
  }
  const updated = await prisma.invoice.update({
    where: {
      id: invoiceId,
    },
    data: {
      status: InvoiceStatus.VOID,
      notes: reason
        ? `${invoice.notes ? invoice.notes + ' | ' : ''}Voided reason: ${reason}`
        : invoice.notes,
    },
  });
  void recordAudit(prisma, {
    userId: actorId,
    action: 'VOID_INVOICE',
    entity: 'Invoice',
    entityId: invoice.id,
    factoryId: invoice.factoryId,
    details: {
      invoiceNumber: invoice.invoiceNumber,
      reason,
    },
  });
  return updated;
}
