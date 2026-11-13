import { Router } from 'express';
import { ProductType, RecordStatus, UserRole } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { getQueryClients } from '../federation.js';

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
    .union([z.string().trim().max(2000), z.literal(''), z.null()])
    .optional()
    .transform((v) => v || null),
  standardPrice: z.number().finite().min(0).max(9999999999.99).nullable().optional(),
  status: z.nativeEnum(RecordStatus).default(RecordStatus.ACTIVE),
});

export function createProductsRouter(prisma, dbManager) {
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
      const requestedFactoryId = req.query.factoryId;
      const sortBy = req.query.sortBy;
      const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : req.query.sortOrder === 'desc' ? 'desc' : undefined;
      const isPriceSort = (sortBy === 'standardPrice' || sortBy === 'price') && sortOrder;
      const productOrderBy = isPriceSort
        ? [{ standardPrice: sortOrder }, { name: 'asc' }]
        : [{ type: 'asc' }, { name: 'asc' }];

      const where = {
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(category ? { category } : {}),
        ...(type ? { type } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
                { category: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      let factoryScope = user.accessibleFactoryIds
        ? { factoryId: { in: user.accessibleFactoryIds } }
        : {};
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryScope = { factoryId: requestedFactoryId };
      }

      if (!dbManager || !dbManager.isFederated) {
        const [items, total, warehouses] = await Promise.all([
          prisma.product.findMany({
            where,
            include: {
              inventory: {
                where: factoryScope,
                include: {
                  factory: { select: { id: true, code: true, name: true } },
                  warehouse: { select: { id: true, code: true, name: true, isDefault: true } },
                },
              },
              thresholds: {
                where: factoryScope,
                include: { factory: { select: { id: true, code: true, name: true } } },
              },
            },
            orderBy: productOrderBy,
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.product.count({ where }),
          prisma.warehouse.findMany({
            where: factoryScope,
            include: { factory: { select: { id: true, code: true, name: true } } },
            orderBy: [{ factory: { code: 'asc' } }, { name: 'asc' }],
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

        return res.json({
          items: mapped,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      // Federated mode on main node:
      const branchClients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      const catalogClients = [dbManager.primaryClient, ...branchClients];

      const [catalogLists, branchDetails] = await Promise.all([
        Promise.all(
          catalogClients.map((db) =>
            db.product.findMany({
              where,
              orderBy: productOrderBy,
            })
          )
        ),
        Promise.all(
          branchClients.map((db) =>
            Promise.all([
              db.inventoryBalance.findMany({
                where: factoryScope,
                include: {
                  factory: { select: { id: true, code: true, name: true } },
                  warehouse: { select: { id: true, code: true, name: true, isDefault: true } },
                },
              }),
              db.factoryProductThreshold.findMany({
                where: factoryScope,
                include: { factory: { select: { id: true, code: true, name: true } } },
              }),
              db.warehouse.findMany({
                where: factoryScope,
                include: { factory: { select: { id: true, code: true, name: true } } },
              }),
            ])
          )
        ),
      ]);

      // Deduplicate products across main + branches by ID (preferring primaryClient or latest)
      const productMap = new Map();
      for (const list of catalogLists) {
        for (const p of list) {
          if (!productMap.has(p.id)) {
            productMap.set(p.id, p);
          }
        }
      }

      const allProducts = Array.from(productMap.values()).sort((a, b) => {
        if (isPriceSort) {
          const priceA = a.standardPrice != null ? Number(a.standardPrice) : 0;
          const priceB = b.standardPrice != null ? Number(b.standardPrice) : 0;
          if (priceA !== priceB) {
            return sortOrder === 'asc' ? priceA - priceB : priceB - priceA;
          }
        }
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
      });

      const allInventory = branchDetails.flatMap((d) => d[0]);
      const allThresholds = branchDetails.flatMap((d) => d[1]);
      const warehouses = branchDetails
        .flatMap((d) => d[2])
        .sort((a, b) => {
          if (a.factory.code !== b.factory.code) return a.factory.code.localeCompare(b.factory.code);
          return a.name.localeCompare(b.name);
        });

      const total = allProducts.length;
      const pagedProducts = allProducts.slice((page - 1) * pageSize, page * pageSize);

      const mapped = pagedProducts.map((product) => {
        const pInv = allInventory.filter((b) => b.productId === product.id);
        const pThresh = allThresholds.filter((t) => t.productId === product.id);
        const balMap = new Map(pInv.map((b) => [b.warehouseId, Number(b.quantity)]));
        const threshMap = new Map(pThresh.map((t) => [t.factoryId, Number(t.minimumQuantity)]));
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
          inventory: pInv,
          thresholds: pThresh,
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
        ? { factoryId: { in: user.accessibleFactoryIds } }
        : {};

      if (!dbManager || !dbManager.isFederated) {
        const [product, warehouses] = await Promise.all([
          prisma.product.findUnique({
            where: { id: req.params.id },
            include: {
              inventory: {
                where: factoryScope,
                include: {
                  factory: { select: { id: true, code: true, name: true } },
                  warehouse: { select: { id: true, code: true, name: true, isDefault: true } },
                },
              },
              thresholds: {
                where: factoryScope,
                include: { factory: { select: { id: true, code: true, name: true } } },
              },
            },
          }),
          prisma.warehouse.findMany({
            where: factoryScope,
            include: { factory: { select: { id: true, code: true, name: true } } },
          }),
        ]);
        if (!product) return res.status(404).json({ error: 'Product not found.' });

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
        return res.json({
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
      }

      const branchClients = await getQueryClients(prisma, dbManager, null);
      const [mainProd, branchProdA, branchProdB, branchDetails] = await Promise.all([
        dbManager.primaryClient.product.findUnique({ where: { id: req.params.id } }),
        dbManager.clientA.product.findUnique({ where: { id: req.params.id } }),
        dbManager.clientB.product.findUnique({ where: { id: req.params.id } }),
        Promise.all(
          branchClients.map((db) =>
            Promise.all([
              db.inventoryBalance.findMany({
                where: { ...factoryScope, productId: req.params.id },
                include: {
                  factory: { select: { id: true, code: true, name: true } },
                  warehouse: { select: { id: true, code: true, name: true, isDefault: true } },
                },
              }),
              db.factoryProductThreshold.findMany({
                where: { ...factoryScope, productId: req.params.id },
                include: { factory: { select: { id: true, code: true, name: true } } },
              }),
              db.warehouse.findMany({
                where: factoryScope,
                include: { factory: { select: { id: true, code: true, name: true } } },
              }),
            ])
          )
        ),
      ]);

      const product = mainProd || branchProdA || branchProdB;
      if (!product) return res.status(404).json({ error: 'Product not found.' });

      const inventory = branchDetails.flatMap((d) => d[0]);
      const thresholds = branchDetails.flatMap((d) => d[1]);
      const warehouses = branchDetails
        .flatMap((d) => d[2])
        .sort((a, b) => {
          if (a.factory.code !== b.factory.code) return a.factory.code.localeCompare(b.factory.code);
          return a.name.localeCompare(b.name);
        });

      const balMap = new Map(inventory.map((b) => [b.warehouseId, Number(b.quantity)]));
      const threshMap = new Map(thresholds.map((t) => [t.factoryId, Number(t.minimumQuantity)]));
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
        inventory,
        thresholds,
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

        if (!dbManager || !dbManager.isFederated) {
          const existing = await prisma.product.findUnique({ where: { sku: data.sku } });
          if (existing)
            return res.status(409).json({ error: `Product with SKU '${data.sku}' already exists.` });
          const product = await prisma.product.create({
            data: { ...data, standardPrice: data.standardPrice ?? null },
          });
          void recordAudit(prisma, {
            userId: user.id,
            action: 'CREATE_PRODUCT',
            entity: 'Product',
            entityId: product.id,
            details: { sku: product.sku, name: product.name, type: product.type },
          });
          return res.status(201).json(product);
        }

        // On main HQ node: check SKU uniqueness across main + branches, create in main & replicate to branches
        const [exMain, exA, exB] = await Promise.all([
          dbManager.primaryClient.product.findUnique({ where: { sku: data.sku } }),
          dbManager.clientA.product.findUnique({ where: { sku: data.sku } }),
          dbManager.clientB.product.findUnique({ where: { sku: data.sku } }),
        ]);
        if (exMain || exA || exB) {
          return res.status(409).json({
            error: `Product with SKU '${data.sku}' already exists.`,
          });
        }

        const product = await dbManager.primaryClient.product.create({
          data: { ...data, standardPrice: data.standardPrice ?? null },
        });

        await Promise.all([
          dbManager.clientA.product.upsert({
            where: { id: product.id },
            create: {
              id: product.id,
              sku: product.sku,
              name: product.name,
              category: product.category,
              type: product.type,
              unit: product.unit,
              description: product.description,
              standardPrice: product.standardPrice,
              status: product.status,
            },
            update: {
              sku: product.sku,
              name: product.name,
              category: product.category,
              type: product.type,
              unit: product.unit,
              description: product.description,
              standardPrice: product.standardPrice,
              status: product.status,
            },
          }),
          dbManager.clientB.product.upsert({
            where: { id: product.id },
            create: {
              id: product.id,
              sku: product.sku,
              name: product.name,
              category: product.category,
              type: product.type,
              unit: product.unit,
              description: product.description,
              standardPrice: product.standardPrice,
              status: product.status,
            },
            update: {
              sku: product.sku,
              name: product.name,
              category: product.category,
              type: product.type,
              unit: product.unit,
              description: product.description,
              standardPrice: product.standardPrice,
              status: product.status,
            },
          }),
        ]);

        void recordAudit(dbManager.primaryClient, {
          userId: user.id,
          action: 'CREATE_PRODUCT',
          entity: 'Product',
          entityId: product.id,
          details: { sku: product.sku, name: product.name, type: product.type },
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
        const id = String(req.params.id);
        const data = productSchema.parse(req.body);

        if (!dbManager || !dbManager.isFederated) {
          const existing = await prisma.product.findUnique({ where: { id } });
          if (!existing) return res.status(404).json({ error: 'Product not found.' });
          if (data.sku !== existing.sku) {
            const dup = await prisma.product.findUnique({ where: { sku: data.sku } });
            if (dup)
              return res.status(409).json({
                error: `Product with SKU '${data.sku}' already exists.`,
              });
          }
          const updated = await prisma.product.update({
            where: { id: existing.id },
            data: { ...data, standardPrice: data.standardPrice ?? null },
          });
          return res.json(updated);
        }

        const clientsToCheck = [dbManager.primaryClient, dbManager.clientA, dbManager.clientB];
        const foundList = await Promise.all(
          clientsToCheck.map((db) => db.product.findUnique({ where: { id } }))
        );
        const existingAny = foundList.find(Boolean);
        if (!existingAny) return res.status(404).json({ error: 'Product not found.' });

        if (data.sku !== existingAny.sku) {
          const dups = await Promise.all(
            clientsToCheck.map((db) => db.product.findUnique({ where: { sku: data.sku } }))
          );
          if (dups.some((d) => d && d.id !== id)) {
            return res.status(409).json({
              error: `Product with SKU '${data.sku}' already exists.`,
            });
          }
        }

        let updatedResult = null;
        await Promise.all(
          clientsToCheck.map(async (db, idx) => {
            if (foundList[idx]) {
              const resItem = await db.product.update({
                where: { id },
                data: { ...data, standardPrice: data.standardPrice ?? null },
              });
              if (!updatedResult) updatedResult = resItem;
            }
          })
        );
        res.json(updatedResult);
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
          .object({ status: z.nativeEnum(RecordStatus) })
          .parse(req.body);

        if (!dbManager || !dbManager.isFederated) {
          const updated = await prisma.product.update({
            where: { id },
            data: { status },
          });
          return res.json(updated);
        }

        const clientsToCheck = [dbManager.primaryClient, dbManager.clientA, dbManager.clientB];
        const foundList = await Promise.all(
          clientsToCheck.map((db) => db.product.findUnique({ where: { id } }))
        );
        if (!foundList.some(Boolean)) {
          return res.status(404).json({ error: 'Product not found.' });
        }
        let updatedResult = null;
        await Promise.all(
          clientsToCheck.map(async (db, idx) => {
            if (foundList[idx]) {
              const resItem = await db.product.update({ where: { id }, data: { status } });
              if (!updatedResult) updatedResult = resItem;
            }
          })
        );
        res.json(updatedResult);
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
