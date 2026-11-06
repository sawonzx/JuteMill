import { Router } from 'express';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createSalesOrder, fulfillSalesOrder, cancelSalesOrder } from '../services/orders.js';
import { recordAudit } from '../services/audit.js';
const createOrderSchema = z.object({
  factoryId: z.string().optional(),
  customerId: z.string().min(1, 'Please select a customer.'),
  orderDate: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), 'Invalid order date format.'),
  dueDate: z
    .string()
    .min(1, 'Please specify a due date.')
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid due date format.'),
  deliveryAddress: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, 'Please select a product.'),
        quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
        unitPrice: z.coerce.number().nonnegative('Unit price cannot be negative.'),
      })
    )
    .min(1, 'Order must contain at least one line item.'),
});
export function createOrdersRouter(prisma) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const status = req.query.status;
      const customerId = req.query.customerId;
      const search = req.query.q?.trim();
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
      }
      const where = {
        ...(factoryIds
          ? {
              factoryId: {
                in: factoryIds,
              },
            }
          : {}),
        ...(status && status !== 'ALL'
          ? {
              status,
            }
          : {}),
        ...(customerId
          ? {
              customerId,
            }
          : {}),
        ...(search
          ? {
              OR: [
                {
                  orderNumber: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  customer: {
                    name: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.salesOrder.findMany({
          where,
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
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                status: true,
                total: true,
                balanceDue: true,
              },
            },
            _count: {
              select: {
                lines: true,
              },
            },
          },
          orderBy: {
            orderDate: 'desc',
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.salesOrder.count({
          where,
        }),
      ]);
      res.json({
        items: items.map((o) => ({
          ...o,
          subtotal: Number(o.subtotal),
          total: Number(o.total),
          invoice: o.invoice
            ? {
                ...o.invoice,
                total: Number(o.invoice.total),
                balanceDue: Number(o.invoice.balanceDue),
              }
            : null,
        })),
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  });
  router.get('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const order = await prisma.salesOrder.findUnique({
        where: {
          id: req.params.id,
        },
        include: {
          customer: true,
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
              location: true,
              address: true,
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
                  category: true,
                  type: true,
                },
              },
            },
          },
          invoice: {
            include: {
              payments: {
                select: {
                  id: true,
                  receiptNo: true,
                  amount: true,
                  paidAt: true,
                  method: true,
                },
              },
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
      if (!order)
        return res.status(404).json({
          error: 'Sales order not found.',
        });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      res.json({
        ...order,
        subtotal: Number(order.subtotal),
        total: Number(order.total),
        lines: order.lines.map((l) => ({
          ...l,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          subtotal: Number(l.subtotal),
        })),
        invoice: order.invoice
          ? {
              ...order.invoice,
              total: Number(order.invoice.total),
              paidAmount: Number(order.invoice.paidAmount),
              balanceDue: Number(order.invoice.balanceDue),
              payments: order.invoice.payments.map((p) => ({
                ...p,
                amount: Number(p.amount),
              })),
            }
          : null,
      });
    } catch (err) {
      next(err);
    }
  });
  router.post('/', async (req, res, next) => {
    try {
      const user = req.user;
      const data = createOrderSchema.parse(req.body);
      const targetFactoryId = user.isSuperAdmin
        ? data.factoryId || user.factoryId
        : (user.factoryId ?? user.assignedFactoryIds[0]);
      if (!targetFactoryId || !user.canAccessFactory(targetFactoryId)) {
        return res.status(403).json({
          error: 'Invalid or inaccessible factory assignment.',
        });
      }
      const order = await createSalesOrder(prisma, user.id, {
        factoryId: targetFactoryId,
        customerId: data.customerId,
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        dueDate: new Date(data.dueDate),
        deliveryAddress: data.deliveryAddress,
        notes: data.notes,
        lines: data.lines,
      });
      res.status(201).json({
        ...order,
        subtotal: Number(order.subtotal),
        total: Number(order.total),
      });
    } catch (err) {
      next(err);
    }
  });
  router.put('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const order = await prisma.salesOrder.findUnique({
        where: {
          id: req.params.id,
        },
        include: {
          lines: true,
        },
      });
      if (!order)
        return res.status(404).json({
          error: 'Order not found.',
        });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      if (order.status !== OrderStatus.DRAFT) {
        return res.status(400).json({
          error: 'Only DRAFT orders can be edited.',
        });
      }
      const data = createOrderSchema.parse(req.body);
      let subtotal = 0;
      const preparedLines = data.lines.map((line) => {
        const lineTotal = Number((line.quantity * line.unitPrice).toFixed(2));
        subtotal += lineTotal;
        return {
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotal: lineTotal,
        };
      });
      const updated = await prisma.$transaction(async (tx) => {
        await tx.salesOrderLine.deleteMany({
          where: {
            orderId: order.id,
          },
        });
        return tx.salesOrder.update({
          where: {
            id: order.id,
          },
          data: {
            customerId: data.customerId,
            dueDate: new Date(data.dueDate),
            deliveryAddress: data.deliveryAddress,
            notes: data.notes,
            subtotal,
            total: subtotal,
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
      });
      res.json({
        ...updated,
        subtotal: Number(updated.subtotal),
        total: Number(updated.total),
      });
    } catch (err) {
      next(err);
    }
  });
  const handleConfirm = async (req, res, next) => {
    try {
      const user = req.user;
      const order = await prisma.salesOrder.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!order)
        return res.status(404).json({
          error: 'Order not found.',
        });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      if (order.status !== OrderStatus.DRAFT) {
        return res.status(400).json({
          error: 'Only DRAFT orders can be confirmed.',
        });
      }
      const updated = await prisma.salesOrder.update({
        where: {
          id: order.id,
        },
        data: {
          status: OrderStatus.CONFIRMED,
        },
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'CONFIRM_SALES_ORDER',
        entity: 'SalesOrder',
        entityId: order.id,
        factoryId: order.factoryId,
        details: {
          orderNumber: order.orderNumber,
        },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  };
  router.post('/:id/confirm', handleConfirm);
  router.patch('/:id/confirm', handleConfirm);
  router.post('/:id/fulfill', async (req, res, next) => {
    try {
      const user = req.user;
      const order = await prisma.salesOrder.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!order)
        return res.status(404).json({
          error: 'Order not found.',
        });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      const fulfilled = await fulfillSalesOrder(prisma, order.id, user.id);
      void recordAudit(prisma, {
        userId: user.id,
        action: 'FULFILL_SALES_ORDER',
        entity: 'SalesOrder',
        entityId: order.id,
        factoryId: order.factoryId,
        details: {
          orderNumber: order.orderNumber,
        },
      });
      res.json(fulfilled);
    } catch (err) {
      next(err);
    }
  });
  const handleCancel = async (req, res, next) => {
    try {
      const user = req.user;
      const { reason } = z
        .object({
          reason: z.string().optional(),
        })
        .parse(req.body || {});
      const order = await prisma.salesOrder.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!order)
        return res.status(404).json({
          error: 'Order not found.',
        });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      const cancelled = await cancelSalesOrder(prisma, order.id, user.id, reason);
      res.json(cancelled);
    } catch (err) {
      next(err);
    }
  };
  router.post('/:id/cancel', handleCancel);
  router.patch('/:id/cancel', handleCancel);
  return router;
}
