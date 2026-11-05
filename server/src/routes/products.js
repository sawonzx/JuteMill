import { Router } from 'express';
import { ProductType, RecordStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
const productSchema = z.object({
  name: z.string().trim().min(2).max(150),
  sku: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
  category: z.string().trim().min(2).max(80),
  type: z.nativeEnum(ProductType),
  unit: z.enum(['kg', 'MT', 'Bale', 'Piece', 'Meter']),
  description: z
    .union([z.string().trim().max(2000), z.literal('')])
    .optional()
    .transform((v) => v || null),
  standardPrice: z.number().finite().min(0).max(9999999999.99).nullable().optional(),
  status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE),
});
export function createProductsRouter(prisma) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50));
      const search = req.query.q?.trim();
      const category = req.query.category?.trim();
      const type = req.query.type;
      const status = req.query.status;
      const where = {
        ...(status && status !== 'ALL'
          ? {
              status,
            }
          : {}),
        ...(category
          ? {
              category,
            }
          : {}),
        ...(type
          ? {
              type,
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
                  sku: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  category: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      };
      const factoryScope = user.accessibleFactoryIds
        ? {
            factoryId: {
              in: user.accessibleFactoryIds,
            },
          }
        : {};
      const [items, total, warehouses] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            inventory: {
              where: factoryScope,
              include: {
                factory: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
                warehouse: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    isDefault: true,
                  },
                },
              },
            },
            thresholds: {
              where: factoryScope,
              include: {
                factory: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: [
            {
              type: 'asc',
            },
            {
              name: 'asc',
            },
          ],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.product.count({
          where,
        }),
        prisma.warehouse.findMany({
          where: factoryScope,
          include: {
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
          orderBy: [
            {
              factory: {
                code: 'asc',
              },
            },
            {
              name: 'asc',
            },
          ],
        }),
      ]);
      const mapped = items.map((product) => {
        const balMap = new Map(product.inventory.map((b) => [b.warehouseId, Number(b.quantity)]));
        const threshMap = new Map(
          product.thresholds.map((t) => [t.factoryId, Number(t.minimumQuantity)])
        );
        const factoryMap = new Map();
        for (const wh of warehouses) {
          const existing = factoryMap.get(wh.factoryId) || {
            factory: wh.factory,
            quantity: 0,
            minimumQuantity: threshMap.get(wh.factoryId) ?? null,
          };
          existing.quantity += balMap.get(wh.id) ?? 0;
          factoryMap.set(wh.factoryId, existing);
        }
        return {
          ...product,
          standardPrice: product.standardPrice ? Number(product.standardPrice) : null,
          stockByFactory: Array.from(factoryMap.values()),
          stockByWarehouse: warehouses.map((wh) => ({
            factory: wh.factory,
            warehouse: {
              id: wh.id,
              code: wh.code,
              name: wh.name,
              isDefault: wh.isDefault,
            },
            quantity: balMap.get(wh.id) ?? 0,
            minimumQuantity: threshMap.get(wh.factoryId) ?? null,
          })),
        };
      });
      res.json({
        items: mapped,
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
      const factoryScope = user.accessibleFactoryIds
        ? {
            factoryId: {
              in: user.accessibleFactoryIds,
            },
          }
        : {};
      const [product, warehouses] = await Promise.all([
        prisma.product.findUnique({
          where: {
            id: req.params.id,
          },
          include: {
            inventory: {
              where: factoryScope,
              include: {
                factory: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
                warehouse: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    isDefault: true,
                  },
                },
              },
            },
            thresholds: {
              where: factoryScope,
              include: {
                factory: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.warehouse.findMany({
          where: factoryScope,
          include: {
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        }),
      ]);
      if (!product)
        return res.status(404).json({
          error: 'Product not found.',
        });
      const balMap = new Map(product.inventory.map((b) => [b.warehouseId, Number(b.quantity)]));
      const threshMap = new Map(
        product.thresholds.map((t) => [t.factoryId, Number(t.minimumQuantity)])
      );
      const factoryMap = new Map();
      for (const wh of warehouses) {
        const existing = factoryMap.get(wh.factoryId) || {
          factory: wh.factory,
          quantity: 0,
          minimumQuantity: threshMap.get(wh.factoryId) ?? null,
        };
        existing.quantity += balMap.get(wh.id) ?? 0;
        factoryMap.set(wh.factoryId, existing);
      }
      res.json({
        ...product,
        standardPrice: product.standardPrice ? Number(product.standardPrice) : null,
        stockByFactory: Array.from(factoryMap.values()),
        stockByWarehouse: warehouses.map((wh) => ({
          factory: wh.factory,
          warehouse: {
            id: wh.id,
            code: wh.code,
            name: wh.name,
            isDefault: wh.isDefault,
          },
          quantity: balMap.get(wh.id) ?? 0,
          minimumQuantity: threshMap.get(wh.factoryId) ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });
  router.post(
    '/',
    requireRole(UserRole.HEAD_OFFICE_ADMIN, UserRole.FACTORY_MANAGER),
    async (req, res, next) => {
      try {
        const user = req.user;
        const data = productSchema.parse(req.body);
        const existing = await prisma.product.findUnique({
          where: {
            sku: data.sku,
          },
        });
        if (existing)
          return res.status(409).json({
            error: `Product with SKU '${data.sku}' already exists.`,
          });
        const product = await prisma.product.create({
          data: {
            ...data,
            standardPrice: data.standardPrice ?? null,
          },
        });
        void recordAudit(prisma, {
          userId: user.id,
          action: 'CREATE_PRODUCT',
          entity: 'Product',
          entityId: product.id,
          details: {
            sku: product.sku,
            name: product.name,
            type: product.type,
          },
        });
        res.status(201).json(product);
      } catch (err) {
        next(err);
      }
    }
  );
  router.put(
    '/:id',
    requireRole(UserRole.HEAD_OFFICE_ADMIN, UserRole.FACTORY_MANAGER),
    async (req, res, next) => {
      try {
        const user = req.user;
        const id = String(req.params.id);
        const existing = await prisma.product.findUnique({
          where: {
            id,
          },
        });
        if (!existing)
          return res.status(404).json({
            error: 'Product not found.',
          });
        const data = productSchema.parse(req.body);
        if (data.sku !== existing.sku) {
          const dup = await prisma.product.findUnique({
            where: {
              sku: data.sku,
            },
          });
          if (dup)
            return res.status(409).json({
              error: `Product with SKU '${data.sku}' already exists.`,
            });
        }
        const updated = await prisma.product.update({
          where: {
            id: existing.id,
          },
          data: {
            ...data,
            standardPrice: data.standardPrice ?? null,
          },
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );
  router.patch(
    '/:id/status',
    requireRole(UserRole.HEAD_OFFICE_ADMIN, UserRole.FACTORY_MANAGER),
    async (req, res, next) => {
      try {
        const id = String(req.params.id);
        const { status } = z
          .object({
            status: z.nativeEnum(RecordStatus),
          })
          .parse(req.body);
        const updated = await prisma.product.update({
          where: {
            id,
          },
          data: {
            status,
          },
        });
        res.json(updated);
      } catch (err) {
        next(err);
      }
    }
  );
  return router;
}
