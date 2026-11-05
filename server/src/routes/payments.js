import { Router } from 'express';
import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { recordCustomerPayment } from '../services/payments.js';
import { recordAudit } from '../services/audit.js';
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
export function createPaymentsRouter(prisma) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const customerId = req.query.customerId;
      const invoiceId = req.query.invoiceId;
      const method = req.query.method;
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
        ...(customerId
          ? {
              customerId,
            }
          : {}),
        ...(invoiceId
          ? {
              invoiceId,
            }
          : {}),
        ...(method
          ? {
              method,
            }
          : {}),
        ...(search
          ? {
              OR: [
                {
                  receiptNo: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  reference: {
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
                {
                  invoice: {
                    invoiceNumber: {
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
        prisma.payment.findMany({
          where,
          include: {
            customer: {
              select: {
                id: true,
                code: true,
                name: true,
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
                total: true,
                balanceDue: true,
                status: true,
              },
            },
            createdBy: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            paidAt: 'desc',
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.payment.count({
          where,
        }),
      ]);
      res.json({
        items: items.map((p) => ({
          ...p,
          receiptNumber: p.receiptNo,
          paymentMethod: p.method,
          paymentDate: p.paidAt.toISOString(),
          reference: p.reference,
          remarks: p.notes,
          amount: Number(p.amount),
          recordedBy: p.createdBy
            ? {
                id: p.createdBy.id,
                name: p.createdBy.name,
              }
            : {
                id: 'sys',
                name: 'System',
              },
          invoice: {
            ...p.invoice,
            total: Number(p.invoice.total),
            balanceDue: Number(p.invoice.balanceDue),
          },
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
  router.post('/', async (req, res, next) => {
    try {
      const user = req.user;
      const data = paymentSchema.parse(req.body);
      const invoice = await prisma.invoice.findUnique({
        where: {
          id: data.invoiceId,
        },
      });
      if (!invoice)
        return res.status(404).json({
          error: 'Invoice not found.',
        });
      if (!user.canAccessFactory(invoice.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      const resolvedMethod = data.paymentMethod ?? data.method ?? PaymentMethod.BANK_TRANSFER;
      const resolvedNotes = data.remarks ?? data.notes ?? undefined;
      const resolvedDate = data.paymentDate
        ? new Date(data.paymentDate)
        : data.paidAt
          ? new Date(data.paidAt)
          : undefined;
      const result = await recordCustomerPayment(prisma, user.id, {
        invoiceId: data.invoiceId,
        amount: data.amount,
        method: resolvedMethod,
        reference: data.reference ?? undefined,
        notes: resolvedNotes,
        paidAt: resolvedDate,
      });
      void recordAudit(prisma, {
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
      const factoryScope = factoryIds
        ? {
            factoryId: {
              in: factoryIds,
            },
          }
        : {};
      const customerScope = customerId
        ? {
            customerId,
          }
        : {};
      const [invoices, payments, selectedCustomer] = await Promise.all([
        prisma.invoice.findMany({
          where: {
            ...factoryScope,
            ...customerScope,
            status: {
              not: 'VOID',
            },
          },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
          orderBy: {
            issueDate: 'asc',
          },
        }),
        prisma.payment.findMany({
          where: {
            ...factoryScope,
            ...customerScope,
          },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
              },
            },
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
          orderBy: {
            paidAt: 'asc',
          },
        }),
        customerId
          ? prisma.customer.findUnique({
              where: {
                id: customerId,
              },
              select: {
                id: true,
                name: true,
                code: true,
              },
            })
          : null,
      ]);
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
