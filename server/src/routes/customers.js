import { Router } from 'express';
import { CustomerType, RecordStatus } from '@prisma/client';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getCustomerLedger } from '../services/payments.js';
import { recordAudit } from '../services/audit.js';
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
    .union([z.string().trim().email().max(180), z.literal('')])
    .optional()
    .transform((v) => v || null),
  address: z.string().trim().min(3).max(250),
  city: z.string().trim().min(2).max(100),
  type: z.nativeEnum(CustomerType).default(CustomerType.BUSINESS),
  status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE),
  notes: z
    .union([z.string().trim().max(2000), z.literal('')])
    .optional()
    .transform((v) => v || null),
  factoryId: z.string().optional(),
});
export function createCustomersRouter(prisma) {
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
        ...(factoryFilter
          ? {
              factoryId: {
                in: factoryFilter,
              },
            }
          : {}),
        ...(status && status !== 'ALL'
          ? {
              status,
            }
          : {}),
        ...(search
          ? {
              OR: [
                {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  code: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  contactPerson: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  phone: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  city: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          include: {
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
                location: true,
              },
            },
            _count: {
              select: {
                orders: true,
                invoices: true,
              },
            },
          },
          orderBy: [
            {
              name: 'asc',
            },
          ],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.customer.count({
          where,
        }),
      ]);
      const customerIds = items.map((c) => c.id);
      const invoices = await prisma.invoice.findMany({
        where: {
          customerId: {
            in: customerIds,
          },
          status: {
            not: 'VOID',
          },
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
      const enriched = items.map((c) => ({
        ...c,
        outstandingBalance: Math.round((balanceMap.get(c.id) ?? 0) * 100) / 100,
      }));
      res.json({
        items: enriched,
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
      const customer = await prisma.customer.findUnique({
        where: {
          id: req.params.id,
        },
        include: {
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
              location: true,
            },
          },
          orders: {
            orderBy: {
              orderDate: 'desc',
            },
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
            orderBy: {
              issueDate: 'desc',
            },
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
        },
      });
      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found.',
        });
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
      const targetFactoryId = user.isSuperAdmin
        ? data.factoryId || user.factoryId
        : (user.factoryId ?? user.assignedFactoryIds[0]);
      if (!targetFactoryId || !user.canAccessFactory(targetFactoryId)) {
        return res.status(403).json({
          error: 'Invalid or inaccessible factory assignment.',
        });
      }
      const existing = await prisma.customer.findUnique({
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
      const customer = await prisma.customer.create({
        data: {
          ...data,
          factoryId: targetFactoryId,
        },
        include: {
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'CREATE_CUSTOMER',
        entity: 'Customer',
        entityId: customer.id,
        factoryId: targetFactoryId,
        details: {
          name: customer.name,
          code: customer.code,
        },
      });
      res.status(201).json(customer);
    } catch (err) {
      next(err);
    }
  });
  router.put('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const existing = await prisma.customer.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!existing)
        return res.status(404).json({
          error: 'Customer not found.',
        });
      if (!user.canAccessFactory(existing.factoryId)) {
        return res.status(403).json({
          error: 'Access denied: Customer belongs to another factory.',
        });
      }
      const data = customerSchema.parse(req.body);
      if (data.code !== existing.code) {
        const dup = await prisma.customer.findUnique({
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
      const updated = await prisma.customer.update({
        where: {
          id: existing.id,
        },
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
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
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
      const customer = await prisma.customer.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!customer)
        return res.status(404).json({
          error: 'Customer not found.',
        });
      if (!user.canAccessFactory(customer.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      const updated = await prisma.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          status,
        },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.get('/:id/ledger', async (req, res, next) => {
    try {
      const user = req.user;
      const customer = await prisma.customer.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!customer)
        return res.status(404).json({
          error: 'Customer not found.',
        });
      if (!user.canAccessFactory(customer.factoryId))
        return res.status(403).json({
          error: 'Access denied.',
        });
      const ledger = await getCustomerLedger(prisma, customer.id);
      res.json(ledger);
    } catch (err) {
      next(err);
    }
  });
  return router;
}
