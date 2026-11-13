import { Router } from 'express';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { recordCustomerPayment } from '../services/payments.js';
import { recordAudit } from '../services/audit.js';
import {
  formatActor,
  getQueryClients,
  mergePaginatedLists,
  resolveBranchClientByRecord,
} from '../federation.js';

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.number().finite().positive(),
  method: z.nativeEnum(PaymentMethod).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  reference: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(),
  paidAt: z.string().optional().nullable(),
  paymentDate: z.string().optional().nullable(),
});

function formatPaymentListItem(p) {
  return {
    ...p,
    receiptNumber: p.receiptNo,
    paymentMethod: p.method,
    paymentDate: p.paidAt.toISOString(),
    reference: p.reference,
    remarks: p.notes,
    amount: Number(p.amount),
    recordedBy: formatActor(p.createdBy, 'Head Office Admin'),
    invoice: {
      ...p.invoice,
      total: Number(p.invoice.total),
      balanceDue: Number(p.invoice.balanceDue),
    },
  };
}

export function createPaymentsRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth, requirePermission('payments:view', 'payments:create'));

  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const customerId = req.query.customerId;
      const invoiceId = req.query.invoiceId;
      const method = req.query.method;
      const search = (req.query.q || req.query.search)?.trim();
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
      }
      const where = {
        ...(factoryIds ? { factoryId: { in: factoryIds } } : {}),
        ...(customerId ? { customerId } : {}),
        ...(invoiceId ? { invoiceId } : {}),
        ...(method ? { method } : {}),
        ...(search
          ? {
              OR: [
                { receiptNo: { contains: search, mode: 'insensitive' } },
                { reference: { contains: search, mode: 'insensitive' } },
                { customer: { name: { contains: search, mode: 'insensitive' } } },
                { customer: { code: { contains: search, mode: 'insensitive' } } },
                { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const include = {
        customer: { select: { id: true, code: true, name: true } },
        factory: { select: { id: true, code: true, name: true } },
        invoice: {
          select: { id: true, invoiceNumber: true, total: true, balanceDue: true, status: true },
        },
        createdBy: { select: { id: true, name: true } },
      };

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      const sortBy = req.query.sortBy;
      const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : req.query.sortOrder === 'desc' ? 'desc' : undefined;
      const orderBy = sortBy === 'amount' && sortOrder ? { amount: sortOrder } : { paidAt: 'desc' };

      if (clients.length <= 1) {
        const db = clients[0];
        if (!db) return res.json({ items: [], page, pageSize, total: 0, totalPages: 0 });
        const [items, total] = await Promise.all([
          db.payment.findMany({
            where,
            include,
            orderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.payment.count({ where }),
        ]);
        return res.json({
          items: items.map(formatPaymentListItem),
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const lists = await Promise.all(
        clients.map(async (db) => {
          const items = await db.payment.findMany({
            where,
            include,
            orderBy,
          });
          return items.map(formatPaymentListItem);
        })
      );

      const comparator =
        sortBy === 'amount' && sortOrder
          ? (a, b) => {
              const valA = Number(a.amount || 0);
              const valB = Number(b.amount || 0);
              return sortOrder === 'asc' ? valA - valB : valB - valA;
            }
          : (a, b) => new Date(b.paymentDate).getTime() - new Date(a.paymentDate).getTime();

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

  router.post('/', async (req, res, next) => {
    try {
      const user = req.user;
      const data = paymentSchema.parse(req.body);
      const db = await resolveBranchClientByRecord(prisma, dbManager, 'invoice', data.invoiceId);
      if (!db) return res.status(404).json({ error: 'Invoice not found.' });

      const invoice = await db.invoice.findUnique({
        where: { id: data.invoiceId },
      });
      if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
      if (!user.canAccessFactory(invoice.factoryId))
        return res.status(403).json({ error: 'Access denied.' });

      const resolvedMethod = data.paymentMethod ?? data.method ?? PaymentMethod.BANK_TRANSFER;
      const resolvedNotes = data.remarks ?? data.notes ?? undefined;
      const resolvedDate = data.paymentDate
        ? new Date(data.paymentDate)
        : data.paidAt
          ? new Date(data.paidAt)
          : undefined;

      const result = await recordCustomerPayment(db, user.id, {
        invoiceId: data.invoiceId,
        amount: data.amount,
        method: resolvedMethod,
        reference: data.reference ?? undefined,
        notes: resolvedNotes,
        paidAt: resolvedDate,
      });

      void recordAudit(db, {
        userId: user.id,
        action: 'RECORD_PAYMENT',
        entity: 'Payment',
        entityId: result.payment.id,
        factoryId: invoice.factoryId,
        details: {
          receiptNo: result.payment.receiptNo,
          amount: data.amount,
          invoice: invoice.invoiceNumber,
        },
      });

      res.status(201).json({
        payment: {
          ...result.payment,
          amount: Number(result.payment.amount),
        },
        invoice: {
          ...result.invoice,
          total: Number(result.invoice.total),
          paidAmount: Number(result.invoice.paidAmount),
          balanceDue: Number(result.invoice.balanceDue),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/ledger', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      const customerId = req.query.customerId?.trim();
      let factoryIds = user.accessibleFactoryIds;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
      }
      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};
      const customerScope = customerId ? { customerId } : {};

      let clients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      if (customerId && clients.length > 1) {
        const custClient = await resolveBranchClientByRecord(prisma, dbManager, 'customer', customerId);
        if (custClient) {
          clients = [custClient];
        }
      }

      const branchResults = await Promise.all(
        clients.map(async (db) => {
          const [invoices, payments, selectedCustomer] = await Promise.all([
            db.invoice.findMany({
              where: {
                ...factoryScope,
                ...customerScope,
                status: { not: 'VOID' },
              },
              include: {
                customer: { select: { id: true, name: true, code: true } },
                factory: { select: { id: true, code: true, name: true } },
              },
              orderBy: { issueDate: 'asc' },
            }),
            db.payment.findMany({
              where: { ...factoryScope, ...customerScope },
              include: {
                customer: { select: { id: true, name: true, code: true } },
                invoice: { select: { id: true, invoiceNumber: true } },
                factory: { select: { id: true, code: true, name: true } },
              },
              orderBy: { paidAt: 'asc' },
            }),
            customerId
              ? db.customer.findUnique({
                  where: { id: customerId },
                  select: { id: true, name: true, code: true },
                })
              : null,
          ]);
          return { invoices, payments, selectedCustomer };
        })
      );

      const invoices = branchResults.flatMap((r) => r.invoices);
      const payments = branchResults.flatMap((r) => r.payments);
      const selectedCustomer = branchResults.find((r) => r.selectedCustomer)?.selectedCustomer ?? null;

      const combined = [
        ...invoices.map((inv) => ({
          kind: 'INVOICE',
          date: new Date(inv.issueDate),
          invoice: inv,
        })),
        ...payments.map((p) => ({
          kind: 'PAYMENT',
          date: new Date(p.paidAt),
          payment: p,
        })),
      ];
      combined.sort((a, b) => a.date.getTime() - b.date.getTime());
      let running = 0;
      let totalInvoiced = 0;
      let totalPaid = 0;
      const entries = combined.map((item) => {
        if (item.kind === 'INVOICE') {
          const amt = Number(item.invoice.total);
          totalInvoiced += amt;
          running += amt;
          return {
            id: item.invoice.id,
            date: item.date,
            type: 'INVOICE',
            reference: item.invoice.invoiceNumber,
            customer: item.invoice.customer,
            factory: item.invoice.factory,
            description: `Invoice ${item.invoice.invoiceNumber}`,
            debit: amt,
            credit: 0,
            balance: Math.round(running * 100) / 100,
            status: item.invoice.status,
          };
        } else {
          const amt = Number(item.payment.amount);
          totalPaid += amt;
          running -= amt;
          return {
            id: item.payment.id,
            date: item.date,
            type: 'PAYMENT',
            reference: item.payment.receiptNo,
            customer: item.payment.customer,
            factory: item.payment.factory,
            description: `Payment for ${item.payment.invoice?.invoiceNumber || item.payment.receiptNo} (${item.payment.method})`,
            debit: 0,
            credit: amt,
            balance: Math.round(running * 100) / 100,
          };
        }
      });
      const netBalance = Math.round((totalInvoiced - totalPaid) * 100) / 100;
      res.json({
        customer: selectedCustomer ?? null,
        entries: entries.reverse(),
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        currentOutstanding: netBalance,
        outstandingBalance: netBalance,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
