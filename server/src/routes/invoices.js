import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { createInvoiceFromOrder, voidInvoice } from '../services/invoices.js';
import { recordAudit } from '../services/audit.js';
import {
  formatActor,
  getQueryClients,
  mergePaginatedLists,
  resolveBranchClientByRecord,
} from '../federation.js';

const createInvoiceSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required.'),
  dueDate: z
    .string()
    .min(1, 'Due date is required.')
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid due date format.'),
  notes: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(500).optional(),
});

function formatInvoiceListItem(inv) {
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    total: Number(inv.total),
    paidAmount: Number(inv.paidAmount),
    balanceDue: Number(inv.balanceDue),
  };
}

export function createInvoicesRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth, requirePermission('invoices:view', 'invoices:create', 'invoices:void'));

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
                { invoiceNumber: { contains: search, mode: 'insensitive' } },
                { customer: { name: { contains: search, mode: 'insensitive' } } },
                { customer: { code: { contains: search, mode: 'insensitive' } } },
                { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const include = {
        customer: { select: { id: true, code: true, name: true, phone: true } },
        factory: { select: { id: true, code: true, name: true } },
        order: { select: { id: true, orderNumber: true } },
        _count: { select: { payments: true } },
      };

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      const sortBy = req.query.sortBy;
      const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : req.query.sortOrder === 'desc' ? 'desc' : undefined;
      const orderBy =
        sortBy === 'total' && sortOrder
          ? { total: sortOrder }
          : sortBy === 'balanceDue' && sortOrder
            ? { balanceDue: sortOrder }
            : { issueDate: 'desc' };

      if (clients.length <= 1) {
        const db = clients[0];
        if (!db) return res.json({ items: [], page, pageSize, total: 0, totalPages: 0 });
        const [items, total] = await Promise.all([
          db.invoice.findMany({
            where,
            include,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.invoice.count({ where }),
        ]);
        return res.json({
          items: items.map(formatInvoiceListItem),
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const lists = await Promise.all(
        clients.map(async (db) => {
          const items = await db.invoice.findMany({
            where,
            include,
            orderBy,
          });
          return items.map(formatInvoiceListItem);
        })
      );

      const comparator =
        sortBy === 'total' && sortOrder
          ? (a, b) => {
              const valA = Number(a.total || 0);
              const valB = Number(b.total || 0);
              return sortOrder === 'asc' ? valA - valB : valB - valA;
            }
          : sortBy === 'balanceDue' && sortOrder
            ? (a, b) => {
                const valA = Number(a.balanceDue || 0);
                const valB = Number(b.balanceDue || 0);
                return sortOrder === 'asc' ? valA - valB : valB - valA;
              }
            : (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime();

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
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'invoice', req.params.id);
      if (!db) return res.status(404).json({ error: 'Invoice not found.' });

      const invoice = await db.invoice.findUnique({
        where: { id: req.params.id },
        include: {
          customer: true,
          factory: true,
          order: { select: { id: true, orderNumber: true, orderDate: true, status: true } },
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true, unit: true } },
            },
          },
          payments: {
            orderBy: { paidAt: 'desc' },
            include: {
              createdBy: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
      if (!user.canAccessFactory(invoice.factoryId))
        return res.status(403).json({ error: 'Access denied.' });

      const companyClient = dbManager?.primaryClient || db;
      const company = await companyClient.company.findFirst();
      res.json({
        ...invoice,
        subtotal: Number(invoice.subtotal),
        total: Number(invoice.total),
        paidAmount: Number(invoice.paidAmount),
        balanceDue: Number(invoice.balanceDue),
        items: invoice.items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          total: Number(item.total),
        })),
        payments: invoice.payments.map((p) => ({
          ...p,
          createdBy: formatActor(p.createdBy),
          receiptNumber: p.receiptNo,
          paymentDate: p.paidAt,
          paymentMethod: p.method,
          amount: Number(p.amount),
        })),
        company: company ?? {
          name: 'Bengal Jute Industries Ltd.',
          currency: 'BDT',
          email: 'info@bengaljute.demo',
          phone: '+880 2-9887766',
          address: 'Bengal House, 45 Dilkusha C/A, Dhaka, Bangladesh',
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const user = req.user;
      const data = createInvoiceSchema.parse(req.body);
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'salesOrder', data.orderId);
      if (!db) return res.status(404).json({ error: 'Sales order not found.' });

      const order = await db.salesOrder.findUnique({
        where: { id: data.orderId },
      });
      if (!order) return res.status(404).json({ error: 'Sales order not found.' });
      if (!user.canAccessFactory(order.factoryId))
        return res.status(403).json({ error: 'Access denied.' });

      const invoice = await createInvoiceFromOrder(db, user.id, {
        orderId: data.orderId,
        dueDate: new Date(data.dueDate),
        notes: data.notes,
        terms: data.terms,
      });
      void recordAudit(db, {
        userId: user.id,
        action: 'CREATE_INVOICE',
        entity: 'Invoice',
        entityId: invoice.id,
        factoryId: invoice.factoryId,
        details: {
          invoiceNumber: invoice.invoiceNumber,
          total: Number(invoice.total),
        },
      });
      res.status(201).json({
        ...invoice,
        subtotal: Number(invoice.subtotal),
        total: Number(invoice.total),
        paidAmount: Number(invoice.paidAmount),
        balanceDue: Number(invoice.balanceDue),
      });
    } catch (err) {
      next(err);
    }
  });

  const handleUpdate = async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && !user.isManager) {
        return res.status(403).json({
          error: 'Access denied: Manager privileges required to edit invoices.',
        });
      }
      const updateInvoiceSchema = z.object({
        dueDate: z.string().optional(),
        notes: z.string().nullable().optional(),
        terms: z.string().nullable().optional(),
      });
      const data = updateInvoiceSchema.parse(req.body);
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'invoice', req.params.id);
      if (!db) return res.status(404).json({ error: 'Invoice not found.' });

      const invoice = await db.invoice.findUnique({
        where: { id: req.params.id },
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
      if (!user.canAccessFactory(invoice.factoryId)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (invoice.status === 'VOID') {
        return res.status(400).json({ error: 'Cannot edit a void invoice.' });
      }

      const updated = await db.invoice.update({
        where: { id: invoice.id },
        data: {
          ...(data.dueDate ? { dueDate: new Date(data.dueDate) } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.terms !== undefined ? { terms: data.terms } : {}),
        },
        include: {
          customer: true,
          factory: true,
          items: { include: { product: true } },
          payments: true,
        },
      });

      void recordAudit(db, {
        userId: user.id,
        action: 'UPDATE_INVOICE',
        entity: 'Invoice',
        entityId: invoice.id,
        factoryId: invoice.factoryId,
        details: { invoiceNumber: invoice.invoiceNumber, changes: data },
      });

      res.json({
        ...updated,
        subtotal: Number(updated.subtotal),
        total: Number(updated.total),
        paidAmount: Number(updated.paidAmount),
        balanceDue: Number(updated.balanceDue),
      });
    } catch (err) {
      next(err);
    }
  };
  router.put('/:id', handleUpdate);
  router.patch('/:id', handleUpdate);

  const handleVoid = async (req, res, next) => {
    try {
      const user = req.user;
      const { reason } = z.object({ reason: z.string().optional() }).parse(req.body || {});
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'invoice', req.params.id);
      if (!db) return res.status(404).json({ error: 'Invoice not found.' });

      const invoice = await db.invoice.findUnique({
        where: { id: req.params.id },
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
      if (!user.canAccessFactory(invoice.factoryId))
        return res.status(403).json({ error: 'Access denied.' });
      const voided = await voidInvoice(db, invoice.id, user.id, reason);
      res.json(voided);
    } catch (err) {
      next(err);
    }
  };
  router.post('/:id/void', handleVoid);
  router.patch('/:id/void', handleVoid);

  return router;
}
