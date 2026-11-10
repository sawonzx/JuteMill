import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createProductionRecord, completeProductionBatch } from '../services/production.js';
import { recordAudit } from '../services/audit.js';
import {
  getQueryClients,
  mergePaginatedLists,
  resolveBranchClientByFactory,
  resolveBranchClientByRecord,
} from '../federation.js';

const createBatchSchema = z.object({
  factoryId: z.string().optional(),
  rawMaterialId: z.string().min(1, 'Raw material is required'),
  rawMaterialQuantity: z
    .number()
    .finite()
    .positive('Raw material quantity must be greater than zero'),
  finishedProductId: z.string().min(1, 'Finished product is required'),
  finishedQuantity: z.number().finite().positive().optional(),
  plannedQuantity: z.number().finite().positive().optional(),
  wastageQuantity: z.number().finite().nonnegative().optional().nullable(),
  productionDate: z.string().optional(),
  scheduledDate: z.string().optional(),
  remarks: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const completeBatchSchema = z.object({
  actualQuantity: z.number().finite().positive().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(),
});

export function formatProductionRecord(b) {
  const rawQty = Number(b.rawMaterialQuantity);
  const finQty = Number(b.finishedQuantity);
  const isCompleted = b.status === 'COMPLETED';
  const prodDate = b.productionDate
    ? new Date(b.productionDate).toISOString()
    : new Date().toISOString();
  const compDate = b.completedAt ? new Date(b.completedAt).toISOString() : null;
  const supervisorName = b.createdBy?.name || 'Head Office Admin';
  const supervisorId = b.createdBy?.id || b.createdById || 'hq-admin';
  const factoryCode = b.factory?.code || (b.factoryId?.includes('F-A') ? 'F-A' : 'F-B');
  const factoryName =
    b.factory?.name || (factoryCode === 'F-A' ? 'Dhaka Jute Mill' : 'Khulna Jute Mill');
  return {
    ...b,
    id: b.id,
    batchNumber: b.batchNumber,
    factoryId: b.factoryId,
    factory: {
      id: b.factory?.id || b.factoryId,
      code: factoryCode,
      name: factoryName,
    },
    factoryCode,
    rawMaterialId: b.rawMaterialId,
    rawMaterial: b.rawMaterial
      ? {
          id: b.rawMaterial.id,
          sku: b.rawMaterial.sku,
          name: b.rawMaterial.name,
          unit: b.rawMaterial.unit || 'kg',
        }
      : {
          id: b.rawMaterialId,
          sku: 'RAW',
          name: 'Raw Jute Material',
          unit: 'kg',
        },
    rawMaterialQuantity: rawQty,
    finishedProductId: b.finishedProductId,
    finishedProduct: b.finishedProduct
      ? {
          id: b.finishedProduct.id,
          sku: b.finishedProduct.sku,
          name: b.finishedProduct.name,
          unit: b.finishedProduct.unit || 'MT',
        }
      : {
          id: b.finishedProductId,
          sku: 'FIN',
          name: 'Finished Jute Product',
          unit: 'MT',
        },
    finishedQuantity: finQty,
    plannedQuantity: finQty,
    actualQuantity: isCompleted ? finQty : null,
    wastageQuantity: b.wastageQuantity ? Number(b.wastageQuantity) : null,
    productionDate: prodDate,
    scheduledDate: prodDate,
    completedAt: compDate,
    completedDate: compDate,
    remarks: b.remarks ?? null,
    notes: b.remarks ?? null,
    createdById: b.createdById,
    createdBy: { id: supervisorId, name: supervisorName },
    supervisor: { id: supervisorId, name: supervisorName },
  };
}

export function createProductionRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const status = req.query.status;
      const search = (req.query.search || req.query.q)?.trim();
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
      }
      const where = {
        ...(factoryIds ? { factoryId: { in: factoryIds } } : {}),
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(search
          ? {
              OR: [
                { batchNumber: { contains: search, mode: 'insensitive' } },
                { rawMaterial: { name: { contains: search, mode: 'insensitive' } } },
                { finishedProduct: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };

      const include = {
        factory: { select: { id: true, code: true, name: true } },
        rawMaterial: { select: { id: true, sku: true, name: true, unit: true } },
        finishedProduct: { select: { id: true, sku: true, name: true, unit: true } },
        createdBy: { select: { id: true, name: true } },
      };

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);

      if (clients.length <= 1) {
        const db = clients[0];
        if (!db) return res.json({ items: [], page, pageSize, total: 0, totalPages: 0 });
        const [items, total] = await Promise.all([
          db.productionRecord.findMany({
            where,
            include,
            orderBy: { productionDate: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.productionRecord.count({ where }),
        ]);
        return res.json({
          items: items.map(formatProductionRecord),
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const lists = await Promise.all(
        clients.map(async (db) => {
          const items = await db.productionRecord.findMany({
            where,
            include,
            orderBy: { productionDate: 'desc' },
          });
          return items.map(formatProductionRecord);
        })
      );

      res.json(
        mergePaginatedLists(
          lists,
          page,
          pageSize,
          (a, b) => new Date(b.productionDate).getTime() - new Date(a.productionDate).getTime()
        )
      );
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const db = await resolveBranchClientByRecord(
        prisma,
        dbManager,
        'productionRecord',
        req.params.id
      );
      if (!db) return res.status(404).json({ error: 'Production record not found.' });

      const batch = await db.productionRecord.findUnique({
        where: { id: req.params.id },
        include: {
          factory: { select: { id: true, code: true, name: true, location: true } },
          rawMaterial: true,
          finishedProduct: true,
          createdBy: { select: { id: true, name: true } },
        },
      });
      if (!batch) return res.status(404).json({ error: 'Production record not found.' });
      if (!user.canAccessFactory(batch.factoryId))
        return res.status(403).json({ error: 'Access denied.' });

      const defaultWarehouse = await db.warehouse.findFirst({
        where: { factoryId: batch.factoryId, isDefault: true },
      });
      const balance = defaultWarehouse
        ? await db.inventoryBalance.findUnique({
            where: {
              warehouseId_productId: {
                warehouseId: defaultWarehouse.id,
                productId: batch.rawMaterialId,
              },
            },
          })
        : null;
      res.json({
        ...formatProductionRecord(batch),
        availableRawStock: balance ? Number(balance.quantity) : 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const user = req.user;
      const data = createBatchSchema.parse(req.body);
      const targetYield = data.finishedQuantity ?? data.plannedQuantity;
      if (!targetYield || targetYield <= 0) {
        return res.status(400).json({
          error: 'Target finished yield quantity must be greater than zero.',
        });
      }
      let targetFactoryId = user.isSuperAdmin
        ? data.factoryId || user.factoryId
        : (user.factoryId ?? user.assignedFactoryIds[0]);

      if (!targetFactoryId && dbManager) {
        const allFactories = await dbManager.getAllFactories();
        targetFactoryId = allFactories[0]?.id || null;
      }

      if (!targetFactoryId || !user.canAccessFactory(targetFactoryId)) {
        return res.status(403).json({
          error: 'Invalid or inaccessible factory assignment.',
        });
      }

      const db = await resolveBranchClientByFactory(prisma, dbManager, targetFactoryId);
      if (!db) {
        return res.status(404).json({ error: 'Target factory database not found.' });
      }

      const rawDate = data.productionDate || data.scheduledDate;
      const prodDate = rawDate ? new Date(rawDate) : new Date();
      const batch = await createProductionRecord(db, user.id, {
        factoryId: targetFactoryId,
        rawMaterialId: data.rawMaterialId,
        rawMaterialQuantity: data.rawMaterialQuantity,
        finishedProductId: data.finishedProductId,
        finishedQuantity: targetYield,
        wastageQuantity: data.wastageQuantity,
        productionDate: isNaN(prodDate.getTime()) ? new Date() : prodDate,
        remarks: data.remarks ?? data.notes ?? null,
      });
      res.status(201).json(formatProductionRecord(batch));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: err.errors.map((e) => e.message).join(', '),
        });
      }
      next(err);
    }
  });

  router.post('/:id/complete', async (req, res, next) => {
    try {
      const user = req.user;
      const body = completeBatchSchema.parse(req.body || {});
      const db = await resolveBranchClientByRecord(
        prisma,
        dbManager,
        'productionRecord',
        req.params.id
      );
      if (!db) return res.status(404).json({ error: 'Production batch not found.' });

      const batch = await db.productionRecord.findUnique({
        where: { id: req.params.id },
      });
      if (!batch) return res.status(404).json({ error: 'Production batch not found.' });
      if (!user.canAccessFactory(batch.factoryId))
        return res.status(403).json({ error: 'Access denied.' });

      const completed = await completeProductionBatch(db, batch.id, user.id, {
        actualQuantity: body.actualQuantity,
        notes: body.notes || undefined,
        remarks: body.remarks || undefined,
      });
      void recordAudit(db, {
        userId: user.id,
        action: 'COMPLETE_PRODUCTION_BATCH',
        entity: 'ProductionRecord',
        entityId: batch.id,
        factoryId: batch.factoryId,
        details: { batchNumber: batch.batchNumber },
      });
      res.json(formatProductionRecord(completed));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: err.errors.map((e) => e.message).join(', '),
        });
      }
      next(err);
    }
  });

  return router;
}
