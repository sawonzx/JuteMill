import { Router } from 'express';
import { CustomerType, RecordStatus } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getCustomerLedger } from '../services/payments.js';
import { recordAudit } from '../services/audit.js';
import {
  getQueryClients,
  mergePaginatedLists,
  resolveBranchClientByFactory,
  resolveBranchClientByRecord,
} from '../federation.js';

const customerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z
    .union([z.string().trim().email().max(180), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  address: z.string().trim().min(3).max(250),
  city: z.string().trim().min(2).max(100),
  type: z.nativeEnum(CustomerType).default(CustomerType.BUSINESS),
  status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE),
  notes: z
    .union([z.string().trim().max(2000), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  factoryId: z.string().nullable().optional(),
});

async function enrichCustomerList(client, items) {
  if (items.length === 0) return [];
  const customerIds = items.map((c) => c.id);
  const invoices = await client.invoice.findMany({
    where: {
      customerId: { in: customerIds },
      status: { not: 'VOID' },
    },
    select: {
      customerId: true,
      balanceDue: true,
    },
  });
  const balanceMap = new Map();
  for (const inv of invoices) {
    const bal = balanceMap.get(inv.customerId) ?? 0;
    balanceMap.set(inv.customerId, bal + Number(inv.balanceDue));
  }
  return items.map((c) => ({
    ...c,
    outstandingBalance: Math.round((balanceMap.get(c.id) ?? 0) * 100) / 100,
  }));
}

export function createCustomersRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const search = req.query.q?.trim();
      const status = req.query.status;
      const requestedFactoryId = req.query.factoryId;
      let factoryFilter;
      if (user.isSuperAdmin) {
        if (requestedFactoryId) factoryFilter = [requestedFactoryId];
      } else {
        if (requestedFactoryId && !user.canAccessFactory(requestedFactoryId)) {
          return res.status(403).json({
            error: 'You do not have permission to view customers of this factory.',
          });
        }
        factoryFilter = requestedFactoryId
          ? [requestedFactoryId]
          : (user.accessibleFactoryIds ?? undefined);
      }

      const where = {
        ...(factoryFilter ? { factoryId: { in: factoryFilter } } : {}),
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { code: { contains: search, mode: 'insensitive' } },
                { contactPerson: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);

      if (clients.length <= 1) {
        const db = clients[0];
        if (!db) {
          return res.json({ items: [], page, pageSize, total: 0, totalPages: 0 });
        }
        const [items, total] = await Promise.all([
          db.customer.findMany({
            where,
            include: {
              factory: { select: { id: true, code: true, name: true, location: true } },
              _count: { select: { orders: true, invoices: true } },
            },
            orderBy: [{ name: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.customer.count({ where }),
        ]);
        const enriched = await enrichCustomerList(db, items);
        return res.json({
          items: enriched,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const perBranchLists = await Promise.all(
        clients.map(async (db) => {
          const items = await db.customer.findMany({
            where,
            include: {
              factory: { select: { id: true, code: true, name: true, location: true } },
              _count: { select: { orders: true, invoices: true } },
            },
            orderBy: [{ name: 'asc' }],
          });
          return enrichCustomerList(db, items);
        })
      );

      res.json(
        mergePaginatedLists(perBranchLists, page, pageSize, (a, b) =>
          a.name.localeCompare(b.name)
        )
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'customer', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      const customer = await db.customer.findUnique({
        where: { id: req.params.id },
        include: {
          factory: { select: { id: true, code: true, name: true, location: true } },
          orders: {
            orderBy: { orderDate: 'desc' },
            take: 20,
            select: {
              id: true,
              orderNumber: true,
              status: true,
              orderDate: true,
              dueDate: true,
              total: true,
            },
          },
          invoices: {
            orderBy: { issueDate: 'desc' },
            take: 20,
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              issueDate: true,
              dueDate: true,
              total: true,
              paidAmount: true,
              balanceDue: true,
            },
          },
          _count: { select: { orders: true, invoices: true } },
        },
      });
      if (!customer) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      if (!user.canAccessFactory(customer.factoryId)) {
        return res.status(403).json({
          error: 'Access denied: Customer belongs to another factory.',
        });
      }
      const outstandingBalance = customer.invoices
        .filter((inv) => inv.status !== 'VOID')
        .reduce((sum, inv) => sum + Number(inv.balanceDue), 0);
      res.json({
        ...customer,
        outstandingBalance: Math.round(outstandingBalance * 100) / 100,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const user = req.user;
      const data = customerSchema.parse(req.body);
      if (user.isSuperAdmin && !data.factoryId && !user.factoryId) {
        return res.status(400).json({
          error: 'Please select a target factory for this customer.',
        });
      }
      const targetFactoryId = user.isSuperAdmin
        ? data.factoryId || user.factoryId
        : (user.factoryId ?? user.assignedFactoryIds[0]);
      if (!targetFactoryId || !user.canAccessFactory(targetFactoryId)) {
        return res.status(403).json({
          error: 'Invalid or inaccessible factory assignment.',
        });
      }
      const db = await resolveBranchClientByFactory(prisma, dbManager, targetFactoryId);
      if (!db) {
        return res.status(404).json({ error: 'Target factory database not found.' });
      }
      const existing = await db.customer.findUnique({
        where: {
          factoryId_code: {
            factoryId: targetFactoryId,
            code: data.code,
          },
        },
      });
      if (existing) {
        return res.status(409).json({
          error: `Customer code '${data.code}' is already used at this factory.`,
        });
      }
      const customer = await db.customer.create({
        data: {
          ...data,
          factoryId: targetFactoryId,
        },
        include: {
          factory: { select: { id: true, code: true, name: true } },
        },
      });
      void recordAudit(db, {
        userId: user.id,
        action: 'CREATE_CUSTOMER',
        entity: 'Customer',
        entityId: customer.id,
        factoryId: targetFactoryId,
        details: { name: customer.name, code: customer.code },
      });
      res.status(201).json(customer);
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'customer', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      const existing = await db.customer.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: 'Customer not found.' });
      if (!user.canAccessFactory(existing.factoryId)) {
        return res.status(403).json({
          error: 'Access denied: Customer belongs to another factory.',
        });
      }
      const data = customerSchema.parse(req.body);
      if (data.code !== existing.code) {
        const dup = await db.customer.findUnique({
          where: {
            factoryId_code: {
              factoryId: existing.factoryId,
              code: data.code,
            },
          },
        });
        if (dup)
          return res.status(409).json({
            error: `Customer code '${data.code}' is already used at this factory.`,
          });
      }
      const updated = await db.customer.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          code: data.code,
          contactPerson: data.contactPerson,
          phone: data.phone,
          email: data.email,
          address: data.address,
          city: data.city,
          type: data.type,
          status: data.status,
          notes: data.notes,
        },
        include: {
          factory: { select: { id: true, code: true, name: true } },
        },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/status', async (req, res, next) => {
    try {
      const user = req.user;
      const { status } = z
        .object({
          status: z.nativeEnum(RecordStatus),
        })
        .parse(req.body);
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'customer', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      const customer = await db.customer.findUnique({
        where: { id: req.params.id },
      });
      if (!customer) return res.status(404).json({ error: 'Customer not found.' });
      if (!user.canAccessFactory(customer.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      const updated = await db.customer.update({
        where: { id: customer.id },
        data: { status },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/ledger', async (req, res, next) => {
    try {
      const user = req.user;
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'customer', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      const customer = await db.customer.findUnique({
        where: { id: req.params.id },
      });
      if (!customer) return res.status(404).json({ error: 'Customer not found.' });
      if (!user.canAccessFactory(customer.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      const ledger = await getCustomerLedger(db, customer.id);
      res.json(ledger);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && user.role !== 'FACTORY_MANAGER') {
        return res.status(403).json({
          error: 'Only administrators and factory managers can delete customers.',
        });
      }
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'customer', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      const fullCustomer = await db.customer.findUnique({
        where: { id: req.params.id },
        include: {
          orders: {
            include: { lines: true },
          },
        },
      });
      if (!fullCustomer) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
      if (!user.canAccessFactory(fullCustomer.factoryId)) {
        return res.status(403).json({ error: 'Access denied: Customer belongs to another factory.' });
      }

      const orderCount = fullCustomer.orders?.length ?? 0;

      await db.$transaction(async (tx) => {
        await tx.trashItem.create({
          data: {
            entityType: 'CUSTOMER',
            entityId: fullCustomer.id,
            title: `${fullCustomer.name} (${fullCustomer.code})`,
            subTitle: `${orderCount} consequent order(s) linked · ${fullCustomer.city}`,
            factoryId: fullCustomer.factoryId,
            data: {
              customer: {
                id: fullCustomer.id,
                factoryId: fullCustomer.factoryId,
                name: fullCustomer.name,
                code: fullCustomer.code,
                contactPerson: fullCustomer.contactPerson,
                phone: fullCustomer.phone,
                email: fullCustomer.email,
                address: fullCustomer.address,
                city: fullCustomer.city,
                type: fullCustomer.type,
                status: fullCustomer.status,
                notes: fullCustomer.notes,
                createdAt: fullCustomer.createdAt,
              },
              orders: fullCustomer.orders.map((o) => ({
                id: o.id,
                orderNumber: o.orderNumber,
                factoryId: o.factoryId,
                customerId: o.customerId,
                status: o.status,
                orderDate: o.orderDate,
                dueDate: o.dueDate,
                subtotal: o.subtotal,
                taxRate: o.taxRate,
                taxAmount: o.taxAmount,
                total: o.total,
                deliveryAddress: o.deliveryAddress,
                notes: o.notes,
                lines: o.lines.map((l) => ({
                  id: l.id,
                  productId: l.productId,
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  subtotal: l.subtotal,
                })),
              })),
            },
            deletedById: user.id,
          },
        });

        await tx.payment.deleteMany({
          where: { customerId: fullCustomer.id },
        });

        const invoices = await tx.invoice.findMany({
          where: { customerId: fullCustomer.id },
          select: { id: true },
        });
        if (invoices.length > 0) {
          const invoiceIds = invoices.map((inv) => inv.id);
          await tx.invoiceItem.deleteMany({
            where: { invoiceId: { in: invoiceIds } },
          });
          await tx.invoice.deleteMany({
            where: { id: { in: invoiceIds } },
          });
        }

        const orders = await tx.salesOrder.findMany({
          where: { customerId: fullCustomer.id },
          select: { id: true },
        });
        if (orders.length > 0) {
          const orderIds = orders.map((o) => o.id);
          await tx.salesOrderLine.deleteMany({
            where: { orderId: { in: orderIds } },
          });
          await tx.salesOrder.deleteMany({
            where: { id: { in: orderIds } },
          });
        }

        await tx.customer.delete({
          where: { id: fullCustomer.id },
        });
      });

      void recordAudit(db, {
        userId: user.id,
        action: 'DELETE_CUSTOMER',
        entity: 'Customer',
        entityId: fullCustomer.id,
        factoryId: fullCustomer.factoryId,
        details: {
          name: fullCustomer.name,
          code: fullCustomer.code,
          consequentOrdersCount: orderCount,
        },
      });

      res.json({
        success: true,
        message: `Customer ${fullCustomer.name} and ${orderCount} associated order(s) moved to trash.`,
        deletedOrdersCount: orderCount,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
