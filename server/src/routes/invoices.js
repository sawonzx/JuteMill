import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createInvoiceFromOrder, voidInvoice } from '../services/invoices.js';
import { recordAudit } from '../services/audit.js';
const createInvoiceSchema = z.object({
  orderId: z.string().min(1),
  dueDate: z.string().datetime(),
  notes: z.string().trim().max(1000).optional(),
  terms: z.string().trim().max(500).optional(),
});
export function createInvoicesRouter(prisma) {
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
                  invoiceNumber: {
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
        prisma.invoice.findMany({
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
            order: {
              select: {
                id: true,
                orderNumber: true,
              },
            },
            _count: {
              select: {
                payments: true,
              },
            },
          },
          orderBy: {
            issueDate: 'desc',
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.invoice.count({
          where,
        }),
      ]);
      res.json({
        items: items.map((inv) => ({
          ...inv,
          subtotal: Number(inv.subtotal),
          total: Number(inv.total),
          paidAmount: Number(inv.paidAmount),
          balanceDue: Number(inv.balanceDue),
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
      const invoice = await prisma.invoice.findUnique({
        where: {
          id: req.params.id,
        },
        include: {
          customer: true,
          factory: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              orderDate: true,
              status: true,
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
          payments: {
            orderBy: {
              paidAt: 'desc',
            },
            include: {
              createdBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
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
      const company = await prisma.company.findFirst();
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
      const order = await prisma.salesOrder.findUnique({
        where: {
          id: data.orderId,
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
      const invoice = await createInvoiceFromOrder(prisma, user.id, {
        orderId: data.orderId,
        dueDate: new Date(data.dueDate),
        notes: data.notes,
        terms: data.terms,
      });
      void recordAudit(prisma, {
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
  router.patch('/:id/void', async (req, res, next) => {
    try {
      const user = req.user;
      const { reason } = z
        .object({
          reason: z.string().optional(),
        })
        .parse(req.body);
      const invoice = await prisma.invoice.findUnique({
        where: {
          id: req.params.id,
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
      const voided = await voidInvoice(prisma, invoice.id, user.id, reason);
      res.json(voided);
    } catch (err) {
      next(err);
    }
  });
  return router;
}
