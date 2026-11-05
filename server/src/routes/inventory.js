import { Router } from 'express';
import { InventoryMovementType, ProductType, RecordStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordInventoryMovement } from '../services/inventory.js';
const movementBodySchema = z
  .object({
    factoryId: z.string().optional(),
    warehouseId: z.string().optional(),
    productId: z.string().min(1),
    type: z.nativeEnum(InventoryMovementType),
    quantity: z.number().finite().positive().optional(),
    adjustmentMode: z.enum(['SET', 'DELTA']).optional(),
    reason: z.string().trim().max(300).optional(),
    reference: z.string().trim().max(120).optional(),
    remarks: z.string().trim().max(1000).optional(),
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
    transactionDate: z.string().datetime().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === InventoryMovementType.ADJUSTMENT) {
      if (!val.reason)
        ctx.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'An adjustment reason is required.',
        });
      if (!val.adjustmentMode || val.quantity === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['quantity'],
          message: 'Choose an adjustment mode and quantity.',
        });
      }
    } else {
      if (!val.quantity || val.quantity <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['quantity'],
          message: 'Enter a positive quantity.',
        });
      }
      if (val.type === InventoryMovementType.STOCK_OUT && !val.reason && !val.reference) {
        ctx.addIssue({
          code: 'custom',
          path: ['reason'],
          message: 'Stock out requires a reason or reference.',
        });
      }
    }
  });
export function createInventoryRouter(prisma) {
  const router = Router();
  router.use(requireAuth);
  router.get('/warehouses', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      let factoryScope = user.accessibleFactoryIds
        ? {
            factoryId: {
              in: user.accessibleFactoryIds,
            },
          }
        : {};
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryScope = {
          factoryId: requestedFactoryId,
        };
      }
      const warehouses = await prisma.warehouse.findMany({
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
      });
      res.json(warehouses);
    } catch (err) {
      next(err);
    }
  });
  router.get('/summary', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
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
      const [productCount, balances, thresholds, recentMovements] = await Promise.all([
        prisma.product.count({
          where: {
            status: RecordStatus.ACTIVE,
          },
        }),
        prisma.inventoryBalance.findMany({
          where: factoryScope,
          include: {
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                type: true,
                unit: true,
              },
            },
          },
        }),
        prisma.factoryProductThreshold.findMany({
          where: factoryScope,
        }),
        prisma.inventoryMovement.findMany({
          where: factoryScope,
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
              },
            },
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
            transactionDate: 'desc',
          },
          take: 10,
        }),
      ]);
      const threshMap = new Map();
      for (const t of thresholds)
        threshMap.set(`${t.factoryId}:${t.productId}`, Number(t.minimumQuantity));
      let lowStockCount = 0;
      const lowStockList = [];
      const rawMap = new Map();
      const finMap = new Map();
      for (const bal of balances) {
        const qty = Number(bal.quantity);
        const unit = bal.product.unit;
        if (bal.product.type === ProductType.RAW_MATERIAL) {
          rawMap.set(unit, (rawMap.get(unit) ?? 0) + qty);
        } else {
          finMap.set(unit, (finMap.get(unit) ?? 0) + qty);
        }
        const min = threshMap.get(`${bal.factoryId}:${bal.productId}`);
        if (min !== undefined && min > 0 && qty <= min) {
          lowStockCount++;
          lowStockList.push({
            id: bal.id,
            factory: bal.factory,
            product: bal.product,
            quantity: qty,
            minimumQuantity: min,
            deficit: min - qty,
          });
        }
      }
      res.json({
        productCount,
        inventoryItemCount: balances.length,
        rawMaterialStock: Array.from(rawMap.entries()).map(([unit, quantity]) => ({
          unit,
          quantity,
        })),
        finishedGoodsStock: Array.from(finMap.entries()).map(([unit, quantity]) => ({
          unit,
          quantity,
        })),
        lowStockCount,
        lowStock: lowStockList.slice(0, 8),
        recentMovements: recentMovements.map((m) => ({
          ...m,
          quantity: Number(m.quantity),
          previousQuantity: Number(m.previousQuantity),
          resultingQuantity: Number(m.resultingQuantity),
        })),
      });
    } catch (err) {
      next(err);
    }
  });
  router.get('/balances', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const search = req.query.q?.trim();
      const category = req.query.category;
      const type = req.query.type;
      const stockStatus = req.query.stockStatus;
      const requestedFactoryId = req.query.factoryId;
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
      const productWhere = {
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
              ],
            }
          : {}),
      };
      const [balances, thresholds, defaultWarehouses, allProducts] = await Promise.all([
        prisma.inventoryBalance.findMany({
          where: {
            ...factoryScope,
            product: productWhere,
          },
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
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                category: true,
                type: true,
                unit: true,
                status: true,
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
              warehouse: {
                code: 'asc',
              },
            },
            {
              product: {
                name: 'asc',
              },
            },
          ],
        }),
        prisma.factoryProductThreshold.findMany({
          where: factoryScope,
        }),
        prisma.warehouse.findMany({
          where: {
            ...factoryScope,
            isDefault: true,
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
        }),
        prisma.product.findMany({
          where: productWhere,
          orderBy: {
            name: 'asc',
          },
        }),
      ]);
      const threshMap = new Map(
        thresholds.map((t) => [`${t.factoryId}:${t.productId}`, Number(t.minimumQuantity)])
      );
      const existingProductFactoryKeys = new Set(
        balances.map((b) => `${b.factoryId}:${b.productId}`)
      );
      let rows = balances.map((b) => {
        const qty = Number(b.quantity);
        const min = threshMap.get(`${b.factoryId}:${b.productId}`) ?? null;
        const isLow = min !== null && min > 0 && qty <= min;
        return {
          id: b.id,
          factory: b.factory,
          warehouse: {
            id: b.warehouse.id,
            code: b.warehouse.code,
            name: b.warehouse.name,
            isDefault: b.warehouse.isDefault,
          },
          product: b.product,
          quantity: qty,
          minimumQuantity: min,
          lowStock: isLow,
          updatedAt: b.updatedAt,
        };
      });
      for (const wh of defaultWarehouses) {
        for (const p of allProducts) {
          if (!existingProductFactoryKeys.has(`${wh.factoryId}:${p.id}`)) {
            const min = threshMap.get(`${wh.factoryId}:${p.id}`) ?? null;
            const isLow = min !== null && min > 0;
            rows.push({
              id: `zero-${wh.id}-${p.id}`,
              factory: wh.factory,
              warehouse: {
                id: wh.id,
                code: wh.code,
                name: wh.name,
                isDefault: wh.isDefault,
              },
              product: {
                id: p.id,
                sku: p.sku,
                name: p.name,
                category: p.category,
                type: p.type,
                unit: p.unit,
                status: p.status,
              },
              quantity: 0,
              minimumQuantity: min,
              lowStock: isLow,
              updatedAt: wh.createdAt,
            });
          }
        }
      }
      rows.sort((a, b) => {
        if (a.factory.code !== b.factory.code) return a.factory.code.localeCompare(b.factory.code);
        if (a.warehouse.code !== b.warehouse.code)
          return a.warehouse.code.localeCompare(b.warehouse.code);
        return a.product.name.localeCompare(b.product.name);
      });
      if (stockStatus === 'LOW') rows = rows.filter((r) => r.lowStock);
      if (stockStatus === 'HEALTHY') rows = rows.filter((r) => !r.lowStock);
      const total = rows.length;
      const paged = rows.slice((page - 1) * pageSize, page * pageSize);
      res.json({
        items: paged,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  });
  router.get('/movements', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const type = req.query.type;
      const productId = req.query.productId;
      const from = req.query.from;
      const to = req.query.to;
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
        ...(type
          ? {
              type,
            }
          : {}),
        ...(productId
          ? {
              productId,
            }
          : {}),
        ...(from || to
          ? {
              transactionDate: {
                ...(from
                  ? {
                      gte: new Date(from),
                    }
                  : {}),
                ...(to
                  ? {
                      lte: new Date(to),
                    }
                  : {}),
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.inventoryMovement.findMany({
          where,
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                unit: true,
              },
            },
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
            transactionDate: 'desc',
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.inventoryMovement.count({
          where,
        }),
      ]);
      res.json({
        items: items.map((m) => ({
          ...m,
          quantity: Number(m.quantity),
          previousQuantity: Number(m.previousQuantity),
          resultingQuantity: Number(m.resultingQuantity),
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
  router.post('/movements', async (req, res, next) => {
    try {
      const user = req.user;
      const body = movementBodySchema.parse(req.body);
      if (body.type === InventoryMovementType.ADJUSTMENT && !user.isSuperAdmin && !user.isManager) {
        return res.status(403).json({
          error: 'Only factory managers or admins can perform inventory adjustments.',
        });
      }
      const targetFactoryId = user.isSuperAdmin
        ? body.factoryId || user.factoryId
        : (user.factoryId ?? user.assignedFactoryIds[0]);
      if (!targetFactoryId || !user.canAccessFactory(targetFactoryId)) {
        return res.status(403).json({
          error: 'Invalid or inaccessible factory assignment.',
        });
      }
      const result = await recordInventoryMovement(prisma, user.id, {
        ...body,
        factoryId: targetFactoryId,
        transactionDate: body.transactionDate ? new Date(body.transactionDate) : undefined,
      });
      const fullMovement = await prisma.inventoryMovement.findUniqueOrThrow({
        where: {
          id: result.movement.id,
        },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              unit: true,
            },
          },
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
      res.status(result.duplicate ? 200 : 201).json({
        ...fullMovement,
        quantity: Number(fullMovement.quantity),
        previousQuantity: Number(fullMovement.previousQuantity),
        resultingQuantity: Number(fullMovement.resultingQuantity),
        duplicate: result.duplicate,
      });
    } catch (err) {
      next(err);
    }
  });
  router.put(
    '/thresholds',
    requireRole(UserRole.HEAD_OFFICE_ADMIN, UserRole.FACTORY_MANAGER),
    async (req, res, next) => {
      try {
        const user = req.user;
        const schema = z.object({
          factoryId: z.string().optional(),
          productId: z.string().min(1),
          minimumQuantity: z.number().finite().min(0).nullable(),
        });
        const { factoryId: reqFactoryId, productId, minimumQuantity } = schema.parse(req.body);
        const targetFactoryId = user.isSuperAdmin
          ? reqFactoryId || user.factoryId
          : (user.factoryId ?? user.assignedFactoryIds[0]);
        if (!targetFactoryId || !user.canAccessFactory(targetFactoryId)) {
          return res.status(403).json({
            error: 'Access denied for factory threshold update.',
          });
        }
        if (minimumQuantity === null) {
          await prisma.factoryProductThreshold.deleteMany({
            where: {
              factoryId: targetFactoryId,
              productId,
            },
          });
          return res.json({
            factoryId: targetFactoryId,
            productId,
            minimumQuantity: null,
          });
        }
        const threshold = await prisma.factoryProductThreshold.upsert({
          where: {
            factoryId_productId: {
              factoryId: targetFactoryId,
              productId,
            },
          },
          update: {
            minimumQuantity,
          },
          create: {
            factoryId: targetFactoryId,
            productId,
            minimumQuantity,
          },
        });
        res.json({
          ...threshold,
          minimumQuantity: Number(threshold.minimumQuantity),
        });
      } catch (err) {
        next(err);
      }
    }
  );
  return router;
}
