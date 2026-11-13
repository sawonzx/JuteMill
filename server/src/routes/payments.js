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

  router.get('/stats', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      const period = req.query.period || '6month';

      let factoryIds = user.accessibleFactoryIds;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
      }
      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};

      const now = new Date();
      let fromDate;
      const bucketConfig = [];

      if (period === '30days') {
        fromDate = new Date(now.getTime() - 30 * 86400000);
        for (let i = 5; i >= 0; i--) {
          const bStart = new Date(now.getTime() - (i + 1) * 5 * 86400000);
          const bEnd = i === 0 ? new Date(now.getTime() + 86400000) : new Date(now.getTime() - i * 5 * 86400000);
          const startLabel = bStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const endLabel = new Date(now.getTime() - i * 5 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          bucketConfig.push({
            key: `d-${5 - i}`,
            label: `${startLabel} - ${endLabel}`,
            shortLabel: `${startLabel}`,
            start: bStart,
            end: bEnd,
          });
        }
      } else if (period === 'year') {
        fromDate = new Date();
        fromDate.setUTCDate(1);
        fromDate.setUTCHours(0, 0, 0, 0);
        fromDate.setUTCMonth(fromDate.getUTCMonth() - 11);

        for (let idx = 0; idx < 12; idx++) {
          const d = new Date();
          d.setUTCDate(1);
          d.setUTCHours(0, 0, 0, 0);
          d.setUTCMonth(d.getUTCMonth() - (11 - idx));
          const nextD = new Date(d);
          nextD.setUTCMonth(nextD.getUTCMonth() + 1);

          const monthName = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
          const fullLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
          bucketConfig.push({
            key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
            label: fullLabel,
            shortLabel: monthName,
            start: d,
            end: nextD,
          });
        }
      } else {
        // Default 6month
        fromDate = new Date();
        fromDate.setUTCDate(1);
        fromDate.setUTCHours(0, 0, 0, 0);
        fromDate.setUTCMonth(fromDate.getUTCMonth() - 5);

        for (let idx = 0; idx < 6; idx++) {
          const d = new Date();
          d.setUTCDate(1);
          d.setUTCHours(0, 0, 0, 0);
          d.setUTCMonth(d.getUTCMonth() - (5 - idx));
          const nextD = new Date(d);
          nextD.setUTCMonth(nextD.getUTCMonth() + 1);

          const monthName = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
          const fullLabel = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
          bucketConfig.push({
            key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
            label: fullLabel,
            shortLabel: monthName,
            start: d,
            end: nextD,
          });
        }
      }

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      const paymentsNested = await Promise.all(
        clients.map((db) =>
          db.payment.findMany({
            where: {
              ...factoryScope,
              paidAt: { gte: fromDate },
            },
            select: {
              id: true,
              amount: true,
              method: true,
              paidAt: true,
              factoryId: true,
            },
          })
        )
      );

      const allPayments = paymentsNested.flatMap((p) => p);

      const methodMetadata = [
        { key: 'BANK_TRANSFER', label: 'Bank Transfer', color: '#247351' },
        { key: 'CHEQUE', label: 'Cheque', color: '#c79a65' },
        { key: 'CASH', label: 'Cash', color: '#529977' },
        { key: 'MOBILE_BANKING', label: 'Mobile Banking', color: '#0d9488' },
        { key: 'OTHER', label: 'Other', color: '#94a3b8' },
      ];

      const byMethod = {};
      methodMetadata.forEach((m) => {
        byMethod[m.key] = {
          key: m.key,
          label: m.label,
          color: m.color,
          amount: 0,
          count: 0,
          pct: 0,
        };
      });

      let totalAmount = 0;
      let totalCount = 0;

      const timeline = bucketConfig.map((b) => ({
        key: b.key,
        label: b.label,
        shortLabel: b.shortLabel,
        total: 0,
        count: 0,
        BANK_TRANSFER: 0,
        CHEQUE: 0,
        CASH: 0,
        MOBILE_BANKING: 0,
        OTHER: 0,
      }));

      for (const p of allPayments) {
        const amt = Number(p.amount) || 0;
        const methodKey = byMethod[p.method] ? p.method : 'OTHER';
        const pDate = new Date(p.paidAt);

        totalAmount += amt;
        totalCount += 1;

        byMethod[methodKey].amount += amt;
        byMethod[methodKey].count += 1;

        const bucketIdx = bucketConfig.findIndex((b) => pDate >= b.start && pDate < b.end);
        if (bucketIdx !== -1) {
          timeline[bucketIdx].total += amt;
          timeline[bucketIdx].count += 1;
          timeline[bucketIdx][methodKey] += amt;
        }
      }

      methodMetadata.forEach((m) => {
        byMethod[m.key].amount = Math.round(byMethod[m.key].amount * 100) / 100;
        byMethod[m.key].pct = totalAmount > 0 ? Math.round((byMethod[m.key].amount / totalAmount) * 1000) / 10 : 0;
      });

      timeline.forEach((item) => {
        item.total = Math.round(item.total * 100) / 100;
        methodMetadata.forEach((m) => {
          item[m.key] = Math.round(item[m.key] * 100) / 100;
        });
      });

      res.json({
        period,
        totalAmount: Math.round(totalAmount * 100) / 100,
        totalCount,
        byMethod,
        timeline,
        methods: methodMetadata,
      });
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

      // Monthly Debit & Credit Aggregation
      const monthsCount = Math.min(24, Math.max(3, parseInt(req.query.months) || 6));
      const monthlyBuckets = Array.from({ length: monthsCount }, (_, idx) => {
        const d = new Date();
        d.setUTCDate(1);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCMonth(d.getUTCMonth() - (monthsCount - 1 - idx));
        const nextD = new Date(d);
        nextD.setUTCMonth(nextD.getUTCMonth() + 1);
        return {
          key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
          month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
          year: d.getUTCFullYear(),
          label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
          start: d,
          end: nextD,
          debit: 0,
          credit: 0,
          net: 0,
          invoicesCount: 0,
          paymentsCount: 0,
        };
      });

      for (const item of combined) {
        const amt = item.kind === 'INVOICE' ? Number(item.invoice.total) : Number(item.payment.amount);
        const b = monthlyBuckets.find((mb) => item.date >= mb.start && item.date < mb.end);
        if (b) {
          if (item.kind === 'INVOICE') {
            b.debit += amt;
            b.invoicesCount += 1;
          } else {
            b.credit += amt;
            b.paymentsCount += 1;
          }
        }
      }

      monthlyBuckets.forEach((b) => {
        b.debit = Math.round(b.debit * 100) / 100;
        b.credit = Math.round(b.credit * 100) / 100;
        b.net = Math.round((b.debit - b.credit) * 100) / 100;
      });

      res.json({
        customer: selectedCustomer ?? null,
        entries: entries.reverse(),
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        currentOutstanding: netBalance,
        outstandingBalance: netBalance,
        monthly: monthlyBuckets,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
