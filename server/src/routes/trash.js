import { Router } from 'express';
import { requireAuth, requireAdminOrManager } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import {
  getQueryClients,
  mergePaginatedLists,
  resolveBranchClientByRecord,
} from '../federation.js';

async function restoreCustomerInDb(db, item) {
  const snapshot = item.data;
  const custData = snapshot.customer;

  const existing = await db.customer.findUnique({
    where: {
      factoryId_code: {
        factoryId: custData.factoryId,
        code: custData.code,
      },
    },
  });
  if (existing) {
    return {
      ok: false,
      status: 409,
      error: `Cannot restore: A customer with code '${custData.code}' already exists at this factory.`,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.customer.create({
      data: {
        id: custData.id,
        factoryId: custData.factoryId,
        name: custData.name,
        code: custData.code,
        contactPerson: custData.contactPerson,
        phone: custData.phone,
        email: custData.email,
        address: custData.address,
        city: custData.city,
        type: custData.type,
        status: custData.status || 'ACTIVE',
        notes: custData.notes,
        createdAt: custData.createdAt ? new Date(custData.createdAt) : undefined,
      },
    });

    if (Array.isArray(snapshot.orders) && snapshot.orders.length > 0) {
      for (const order of snapshot.orders) {
        const lines = Array.isArray(order.lines) ? order.lines : [];
        await tx.salesOrder.create({
          data: {
            id: order.id,
            orderNumber: order.orderNumber,
            factoryId: order.factoryId,
            customerId: custData.id,
            status: order.status,
            orderDate: order.orderDate ? new Date(order.orderDate) : new Date(),
            dueDate: order.dueDate ? new Date(order.dueDate) : new Date(),
            subtotal: order.subtotal,
            taxRate: order.taxRate,
            taxAmount: order.taxAmount,
            total: order.total,
            deliveryAddress: order.deliveryAddress,
            notes: order.notes,
            lines: {
              create: lines.map((l) => ({
                id: l.id,
                productId: l.productId,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                subtotal: l.subtotal,
              })),
            },
          },
        });
      }
    }

    await tx.trashItem.delete({
      where: { id: item.id },
    });
  });

  return { ok: true };
}

async function restoreOrderInDb(db, item) {
  const snapshot = item.data;
  const orderData = snapshot.order;

  const custExists = await db.customer.findUnique({
    where: { id: orderData.customerId },
  });
  if (!custExists) {
    return {
      ok: false,
      status: 409,
      error:
        'Cannot restore order: Associated customer no longer exists. Restore the customer first.',
    };
  }

  const orderNumExists = await db.salesOrder.findUnique({
    where: { orderNumber: orderData.orderNumber },
  });
  if (orderNumExists) {
    return {
      ok: false,
      status: 409,
      error: `Cannot restore: Sales Order #${orderData.orderNumber} already exists.`,
    };
  }

  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  await db.$transaction(async (tx) => {
    await tx.salesOrder.create({
      data: {
        id: orderData.id,
        orderNumber: orderData.orderNumber,
        factoryId: orderData.factoryId,
        customerId: orderData.customerId,
        status: orderData.status,
        orderDate: orderData.orderDate ? new Date(orderData.orderDate) : new Date(),
        dueDate: orderData.dueDate ? new Date(orderData.dueDate) : new Date(),
        subtotal: orderData.subtotal,
        taxRate: orderData.taxRate,
        taxAmount: orderData.taxAmount,
        total: orderData.total,
        deliveryAddress: orderData.deliveryAddress,
        notes: orderData.notes,
        lines: {
          create: lines.map((l) => ({
            id: l.id,
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            subtotal: l.subtotal,
          })),
        },
      },
    });

    await tx.trashItem.delete({
      where: { id: item.id },
    });
  });

  return { ok: true };
}

export function createTrashRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth, requireAdminOrManager);

  // GET /api/trash - list trashed items with pagination, search, and type filter
  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
      const search = (req.query.q || req.query.search)?.trim();
      const entityType = req.query.type;
      const requestedFactoryId = req.query.factoryId;

      let factoryFilter;
      let targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      if (user.isSuperAdmin) {
        if (requestedFactoryId) {
          factoryFilter = [requestedFactoryId];
          targetFactoryId = requestedFactoryId;
        }
      } else {
        if (requestedFactoryId && !user.canAccessFactory(requestedFactoryId)) {
          return res
            .status(403)
            .json({ error: 'You do not have permission to view trash for this factory.' });
        }
        factoryFilter = requestedFactoryId
          ? [requestedFactoryId]
          : (user.accessibleFactoryIds ?? undefined);
        if (requestedFactoryId) targetFactoryId = requestedFactoryId;
      }

      const where = {
        ...(factoryFilter ? { factoryId: { in: factoryFilter } } : {}),
        ...(entityType && entityType !== 'ALL' ? { entityType } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { subTitle: { contains: search, mode: 'insensitive' } },
                { entityType: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      if (clients.length <= 1) {
        const db = clients[0] || prisma;
        const [items, total] = await Promise.all([
          db.trashItem.findMany({
            where,
            orderBy: { deletedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          db.trashItem.count({ where }),
        ]);

        return res.json({
          items,
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const lists = await Promise.all(
        clients.map((db) =>
          db.trashItem.findMany({
            where,
            orderBy: { deletedAt: 'desc' },
          })
        )
      );

      res.json(
        mergePaginatedLists(
          lists,
          page,
          pageSize,
          (a, b) => new Date(b.deletedAt) - new Date(a.deletedAt)
        )
      );
    } catch (err) {
      next(err);
    }
  });

  // POST /api/trash/:id/restore - Recover/restore an item from the trash
  router.post('/:id/restore', async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && user.role !== 'FACTORY_MANAGER') {
        return res
          .status(403)
          .json({ error: 'Only administrators and factory managers can restore items.' });
      }

      const db = await resolveBranchClientByRecord(prisma, dbManager, 'trashItem', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Trash item not found.' });
      }

      const item = await db.trashItem.findUnique({
        where: { id: req.params.id },
      });
      if (!item) {
        return res.status(404).json({ error: 'Trash item not found.' });
      }
      if (item.factoryId && !user.canAccessFactory(item.factoryId)) {
        return res.status(403).json({ error: 'Access denied: Item belongs to another factory.' });
      }

      if (item.entityType === 'CUSTOMER') {
        const result = await restoreCustomerInDb(db, item);
        if (!result.ok) {
          return res.status(result.status).json({ error: result.error });
        }

        void recordAudit(db, {
          userId: user.id,
          action: 'RESTORE_CUSTOMER',
          entity: 'Customer',
          entityId: item.entityId,
          factoryId: item.factoryId,
          details: { title: item.title },
        });

        return res.json({
          success: true,
          message: `Customer '${item.title}' recovered successfully.`,
        });
      }

      if (item.entityType === 'SALES_ORDER') {
        const result = await restoreOrderInDb(db, item);
        if (!result.ok) {
          return res.status(result.status).json({ error: result.error });
        }

        void recordAudit(db, {
          userId: user.id,
          action: 'RESTORE_ORDER',
          entity: 'SalesOrder',
          entityId: item.entityId,
          factoryId: item.factoryId,
          details: { title: item.title },
        });

        return res.json({
          success: true,
          message: `Sales Order '${item.title}' recovered successfully.`,
        });
      }

      return res.status(400).json({ error: `Unsupported entity type: ${item.entityType}` });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/trash/batch-restore - Recover/restore multiple selected items across branches
  router.post('/batch-restore', async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && user.role !== 'FACTORY_MANAGER') {
        return res
          .status(403)
          .json({ error: 'Only administrators and factory managers can restore items.' });
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Please provide a non-empty array of IDs to restore.' });
      }

      const targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      const foundPairs = (
        await Promise.all(
          clients.map(async (db) => {
            const list = await db.trashItem.findMany({ where: { id: { in: ids } } });
            return list.map((item) => ({ db, item }));
          })
        )
      ).flat();

      if (foundPairs.length === 0) {
        return res.status(404).json({ error: 'No matching trash items found.' });
      }

      for (const { item } of foundPairs) {
        if (item.factoryId && !user.canAccessFactory(item.factoryId)) {
          return res
            .status(403)
            .json({ error: `Access denied to item from another factory: ${item.title}` });
        }
      }

      const sortedPairs = [...foundPairs].sort((a, b) => {
        if (a.item.entityType === 'CUSTOMER' && b.item.entityType !== 'CUSTOMER') return -1;
        if (a.item.entityType !== 'CUSTOMER' && b.item.entityType === 'CUSTOMER') return 1;
        return 0;
      });

      let restoredCount = 0;
      const errors = [];
      const touchedBranches = new Set();

      for (const { db, item } of sortedPairs) {
        try {
          if (item.entityType === 'CUSTOMER') {
            const result = await restoreCustomerInDb(db, item);
            if (!result.ok) {
              errors.push(`${item.title}: ${result.error}`);
              continue;
            }
            restoredCount++;
            touchedBranches.add(db);
          } else if (item.entityType === 'SALES_ORDER') {
            const result = await restoreOrderInDb(db, item);
            if (!result.ok) {
              errors.push(`${item.title}: ${result.error}`);
              continue;
            }
            restoredCount++;
            touchedBranches.add(db);
          }
        } catch (err) {
          errors.push(`${item.title}: ${err.message}`);
        }
      }

      for (const db of touchedBranches) {
        void recordAudit(db, {
          userId: user.id,
          action: 'BATCH_RESTORE_TRASH',
          entity: 'TrashItem',
          factoryId: user.factoryId,
          details: { requestedCount: ids.length, restoredCount, errors },
        });
      }

      res.json({
        success: true,
        restoredCount,
        errors: errors.length > 0 ? errors : undefined,
        message: `Successfully recovered ${restoredCount} of ${ids.length} item(s).${errors.length ? ' Some items could not be restored: ' + errors.join('; ') : ''}`,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/trash/batch-delete - Permanently delete multiple selected items
  router.post('/batch-delete', async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && user.role !== 'FACTORY_MANAGER') {
        return res
          .status(403)
          .json({ error: 'Only administrators and factory managers can permanently delete items.' });
      }

      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Please provide an array of IDs to delete.' });
      }

      const where = {
        id: { in: ids },
        ...(user.isSuperAdmin ? {} : { factoryId: { in: user.accessibleFactoryIds } }),
      };

      const targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      let totalDeleted = 0;
      await Promise.all(
        clients.map(async (db) => {
          const count = await db.trashItem.count({ where });
          if (count > 0) {
            await db.trashItem.deleteMany({ where });
            totalDeleted += count;
            void recordAudit(db, {
              userId: user.id,
              action: 'BATCH_PERMANENT_DELETE',
              entity: 'TrashItem',
              factoryId: user.factoryId,
              details: { deletedCount: count },
            });
          }
        })
      );

      res.json({
        success: true,
        deletedCount: totalDeleted,
        message: `Permanently deleted ${totalDeleted} selected item(s) from trash.`,
      });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/trash/:id - Permanently delete a single item from trash
  router.delete('/:id', async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && user.role !== 'FACTORY_MANAGER') {
        return res
          .status(403)
          .json({ error: 'Only administrators and factory managers can permanently delete items.' });
      }

      const db = await resolveBranchClientByRecord(prisma, dbManager, 'trashItem', req.params.id);
      if (!db) {
        return res.status(404).json({ error: 'Trash item not found.' });
      }

      const item = await db.trashItem.findUnique({
        where: { id: req.params.id },
      });
      if (!item) {
        return res.status(404).json({ error: 'Trash item not found.' });
      }
      if (item.factoryId && !user.canAccessFactory(item.factoryId)) {
        return res.status(403).json({ error: 'Access denied: Item belongs to another factory.' });
      }

      await db.trashItem.delete({ where: { id: item.id } });

      void recordAudit(db, {
        userId: user.id,
        action: 'PERMANENT_DELETE',
        entity: item.entityType,
        entityId: item.entityId,
        factoryId: item.factoryId,
        details: { title: item.title },
      });

      res.json({ success: true, message: `Permanently deleted '${item.title}' from trash.` });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/trash/empty - Empty all items in trash
  router.post('/empty', async (req, res, next) => {
    try {
      const user = req.user;
      if (!user.isSuperAdmin && user.role !== 'FACTORY_MANAGER') {
        return res
          .status(403)
          .json({ error: 'Only administrators and factory managers can empty trash.' });
      }

      const requestedFactoryId = req.body?.factoryId || req.query?.factoryId || null;
      if (requestedFactoryId && !user.canAccessFactory(requestedFactoryId)) {
        return res.status(403).json({ error: 'Access denied to this factory trash.' });
      }

      const targetFactoryId = requestedFactoryId || (user.isSuperAdmin ? null : user.factoryId);
      const where = targetFactoryId
        ? { factoryId: targetFactoryId }
        : user.isSuperAdmin
          ? {}
          : { factoryId: { in: user.accessibleFactoryIds } };

      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      let totalDeleted = 0;
      await Promise.all(
        clients.map(async (db) => {
          const count = await db.trashItem.count({ where });
          if (count > 0) {
            await db.trashItem.deleteMany({ where });
            totalDeleted += count;
            void recordAudit(db, {
              userId: user.id,
              action: 'EMPTY_TRASH',
              entity: 'TrashItem',
              factoryId: user.factoryId,
              details: { deletedItemsCount: count },
            });
          }
        })
      );

      res.json({ success: true, message: `Emptied ${totalDeleted} item(s) from trash.` });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
