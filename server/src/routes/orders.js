import { Router } from 'express';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createSalesOrder, fulfillSalesOrder, cancelSalesOrder } from '../services/orders.js';
import { recordAudit } from '../services/audit.js';
import {
  formatActor,
  getQueryClients,
  mergePaginatedLists,
  resolveBranchClientByFactory,
  resolveBranchClientByRecord,
} from '../federation.js';

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
        quantity: z.coerce
          .number()
          .int('Quantity must be an integer.')
          .positive('Quantity must be greater than zero.'),
        unitPrice: z.coerce.number().nonnegative('Unit price cannot be negative.'),
      })
    )
    .min(1, 'Order must contain at least one line item.'),
});

function formatOrderListItem(o) {
  return {
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
  };
}

export function createOrdersRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const status = req.query.status;
      const customerId = req.query.customerId;
      const search = (req.query.q || req.query.search)?.trim();
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
      }
      const where = {
        ...(factoryIds ? { factoryId: { in: factoryIds } } : {}),
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(customerId ? { customerId } : {}),
        ...(search
          ? {
              OR: [
                { orderNumber: { contains: search, mode: 'insensitive' } },
                { customer: { name: { contains: search, mode: 'insensitive' } } },
                { customer: { code: { contains: search, mode: 'insensitive' } } },
                { customer: { phone: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const include = {
        customer: { select: { id: true, code: true, name: true, phone: true } },
        factory: { select: { id: true, code: true, name: true } },
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            total: true,
            balanceDue: true,
          },
        },
        _count: { select: { lines: true } },
      };

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      const sortBy = req.query.sortBy;
      const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : req.query.sortOrder === 'desc' ? 'desc' : undefined;
      const orderBy = sortBy === 'total' && sortOrder ? { total: sortOrder } : { orderDate: 'desc' };

      if (clients.length <= 1) {
        const db = clients[0];
        if (!db) return res.json({ items: [], page, pageSize, total: 0, totalPages: 0 });
        const [items, total] = await Promise.all([
          db.salesOrder.findMany({
            where,
            include,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.salesOrder.count({ where }),
        ]);
        return res.json({
          items: items.map(formatOrderListItem),
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const lists = await Promise.all(
        clients.map(async (db) => {
          const items = await db.salesOrder.findMany({
            where,
            include,
            orderBy,
          });
          return items.map(formatOrderListItem);
        })
      );

      const comparator =
        sortBy === 'total' && sortOrder
          ? (a, b) => {
              const valA = Number(a.total || 0);
              const valB = Number(b.total || 0);
              return sortOrder === 'asc' ? valA - valB : valB - valA;
            }
          : (a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime();

      res.json(
        mergePaginatedLists(
          lists,
          page,
          pageSize,
          comparator
        )
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', req.params.id);
      if (!db) return res.status(404).json({ error: 'Sales order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: req.params.id },
        include: {
          customer: true,
          factory: { select: { id: true, code: true, name: true, location: true, address: true } },
          lines: {
            include: {
              product: { select: { id: true, sku: true, name: true, unit: true, category: true, type: true } },
            },
          },
          invoice: {
            include: {
              payments: {
                select: { id: true, receiptNo: true, amount: true, paidAt: true, method: true },
              },
            },
          },
          createdBy: { select: { id: true, name: true } },
        },
      });
      if (!order) return res.status(404).json({ error: 'Sales order not found.' });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({ error: 'Access denied.' });

      res.json({
        ...order,
        createdBy: formatActor(order.createdBy),
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
      let targetFactoryId = user.isSuperAdmin
        ? data.factoryId || user.factoryId
        : (user.factoryId ?? user.assignedFactoryIds[0]);

      let db = targetFactoryId
        ? await resolveBranchClientByFactory(prisma, dbManager, targetFactoryId)
        : null;

      if (!db && user.isSuperAdmin && data.customerId) {
        db = await resolveBranchClientByRecord(prisma, dbManager, 'customer', data.customerId);
        if (db) {
          const cust = await db.customer.findUnique({
            where: { id: data.customerId },
            select: { factoryId: true },
          });
          if (cust) targetFactoryId = cust.factoryId;
        }
      }

      if (!targetFactoryId || !user.canAccessFactory(targetFactoryId) || !db) {
        return res.status(403).json({
          error: 'Invalid or inaccessible factory assignment.',
        });
      }
      const order = await createSalesOrder(db, user.id, {
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
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', req.params.id);
      if (!db) return res.status(404).json({ error: 'Order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      if (order.status !== OrderStatus.DRAFT) {
        return res.status(400).json({ error: 'Only DRAFT orders can be edited.' });
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
      const updated = await db.$transaction(async (tx) => {
        await tx.salesOrderLine.deleteMany({
          where: { orderId: order.id },
        });
        return tx.salesOrder.update({
          where: { id: order.id },
          data: {
            customerId: data.customerId,
            dueDate: new Date(data.dueDate),
            deliveryAddress: data.deliveryAddress,
            notes: data.notes,
            subtotal,
            total: subtotal,
            lines: { create: preparedLines },
          },
          include: {
            customer: { select: { id: true, code: true, name: true } },
            lines: {
              include: {
                product: { select: { id: true, sku: true, name: true, unit: true } },
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
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', req.params.id);
      if (!db) return res.status(404).json({ error: 'Order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      if (order.status !== OrderStatus.DRAFT) {
        return res.status(400).json({ error: 'Only DRAFT orders can be confirmed.' });
      }
      const updated = await db.salesOrder.update({
        where: { id: order.id },
        data: { status: OrderStatus.CONFIRMED },
      });
      void recordAudit(db, {
        userId: user.id,
        action: 'CONFIRM_SALES_ORDER',
        entity: 'SalesOrder',
        entityId: order.id,
        factoryId: order.factoryId,
        details: { orderNumber: order.orderNumber },
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
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', req.params.id);
      if (!db) return res.status(404).json({ error: 'Order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      const fulfilled = await fulfillSalesOrder(db, order.id, user.id);
      void recordAudit(db, {
        userId: user.id,
        action: 'FULFILL_SALES_ORDER',
        entity: 'SalesOrder',
        entityId: order.id,
        factoryId: order.factoryId,
        details: { orderNumber: order.orderNumber },
      });
      res.json(fulfilled);
    } catch (err) {
      next(err);
    }
  });

  const handleCancel = async (req, res, next) => {
    try {
      const user = req.user;
      const { reason } = z.object({ reason: z.string().optional() }).parse(req.body || {});
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', req.params.id);
      if (!db) return res.status(404).json({ error: 'Order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: req.params.id },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      const cancelled = await cancelSalesOrder(db, order.id, user.id, reason);
      res.json(cancelled);
    } catch (err) {
      next(err);
    }
  };
  router.post('/:id/cancel', handleCancel);
  router.patch('/:id/cancel', handleCancel);

  const handleDelete = async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && !user.isManager) {
        return res
          .status(403)
          .json({ error: 'Access denied: Manager privileges required to delete orders.' });
      }
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', req.params.id);
      if (!db) return res.status(404).json({ error: 'Order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: req.params.id },
        include: { invoice: true, lines: true },
      });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!user.canAccessFactory(order.factoryId)) {
        return res
          .status(403)
          .json({ error: 'Access denied: You do not have permissions for this factory.' });
      }
      if (order.invoice && order.invoice.status !== 'VOID') {
        return res
          .status(400)
          .json({ error: 'Cannot delete order with an active invoice. Void the invoice first.' });
      }
      if (order.status === 'FULFILLED') {
        return res
          .status(400)
          .json({ error: 'Cannot delete a fulfilled order that already deducted inventory balances.' });
      }

      await db.$transaction(async (tx) => {
        await tx.trashItem.create({
          data: {
            entityType: 'SALES_ORDER',
            entityId: order.id,
            title: `Order ${order.orderNumber}`,
            subTitle: `${order.lines?.length || 0} line item(s) · BDT ${order.total}`,
            factoryId: order.factoryId,
            data: {
              order: {
                id: order.id,
                orderNumber: order.orderNumber,
                factoryId: order.factoryId,
                customerId: order.customerId,
                status: order.status,
                orderDate: order.orderDate,
                dueDate: order.dueDate,
                subtotal: order.subtotal,
                taxRate: order.taxRate,
                taxAmount: order.taxAmount,
                total: order.total,
                deliveryAddress: order.deliveryAddress,
                notes: order.notes,
              },
              lines: order.lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                subtotal: l.subtotal,
              })),
            },
            deletedById: user.id,
          },
        });

        if (order.invoice && order.invoice.status === 'VOID') {
          await tx.invoiceItem.deleteMany({ where: { invoiceId: order.invoice.id } });
          await tx.payment.deleteMany({ where: { invoiceId: order.invoice.id } });
          await tx.invoice.delete({ where: { id: order.invoice.id } });
        }
        await tx.salesOrderLine.deleteMany({ where: { orderId: order.id } });
        await tx.salesOrder.delete({ where: { id: order.id } });
      });

      void recordAudit(db, {
        userId: user.id,
        action: 'DELETE_SALES_ORDER',
        entity: 'SalesOrder',
        entityId: order.id,
        factoryId: order.factoryId,
        details: { orderNumber: order.orderNumber },
      });

      res.json({ message: 'Order deleted successfully.', id: order.id });
    } catch (err) {
      next(err);
    }
  };
  router.delete('/:id', handleDelete);

  return router;
}
