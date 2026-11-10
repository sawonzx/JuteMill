import { Router } from 'express';
import { ProductType, UserRole } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';
import { getQueryClients } from '../federation.js';

async function fetchBranchSnapshot(db, factoryIdFilter, factoryScope) {
  const [
    factories,
    orderStats,
    invoices,
    payments,
    balances,
    thresholds,
    recentOrders,
    productionBatches,
    recentBatches,
  ] = await Promise.all([
    db.factory.findMany({
      where: factoryIdFilter,
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
      },
      orderBy: {
        code: 'asc',
      },
    }),
    db.salesOrder.groupBy({
      by: ['status'],
      where: factoryScope,
      _count: {
        _all: true,
      },
      _sum: {
        total: true,
      },
    }),
    db.invoice.findMany({
      where: {
        ...factoryScope,
        status: {
          not: 'VOID',
        },
      },
      select: {
        id: true,
        total: true,
        paidAmount: true,
        balanceDue: true,
        factoryId: true,
        status: true,
        issueDate: true,
      },
    }),
    db.payment.findMany({
      where: factoryScope,
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
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
          },
        },
      },
      orderBy: {
        paidAt: 'desc',
      },
      take: 6,
    }),
    db.inventoryBalance.findMany({
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
    db.factoryProductThreshold.findMany({
      where: factoryScope,
    }),
    db.salesOrder.findMany({
      where: factoryScope,
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
        orderDate: 'desc',
      },
      take: 6,
    }),
    db.productionRecord.count({
      where: {
        ...factoryScope,
        status: {
          in: ['PLANNED', 'IN_PROGRESS', 'DRAFT'],
        },
      },
    }),
    db.productionRecord.findMany({
      where: factoryScope,
      include: {
        factory: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        finishedProduct: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
      },
      orderBy: {
        productionDate: 'desc',
      },
      take: 6,
    }),
  ]);

  return {
    factories,
    orderStats,
    invoices,
    payments,
    balances,
    thresholds,
    recentOrders,
    productionBatches,
    recentBatches,
  };
}

export function createDashboardRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      if (user.isSuperAdmin) {
        if (requestedFactoryId) {
          factoryIds = [requestedFactoryId];
        } else {
          factoryIds = null;
        }
      } else {
        if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
          factoryIds = [requestedFactoryId];
        }
      }
      const factoryScope = factoryIds
        ? {
            factoryId: {
              in: factoryIds,
            },
          }
        : {};
      const factoryIdFilter = factoryIds
        ? {
            id: {
              in: factoryIds,
            },
          }
        : {};
      const isConsolidated = user.isSuperAdmin && !requestedFactoryId;

      const clients = await getQueryClients(prisma, dbManager, requestedFactoryId);
      const snapshots = await Promise.all(
        clients.map((client) => fetchBranchSnapshot(client, factoryIdFilter, factoryScope))
      );

      const factories = snapshots
        .flatMap((s) => s.factories)
        .sort((a, b) => a.code.localeCompare(b.code));

      const orderStatsMap = new Map();
      for (const s of snapshots) {
        for (const row of s.orderStats) {
          const existing = orderStatsMap.get(row.status) || {
            status: row.status,
            _count: { _all: 0 },
            _sum: { total: 0 },
          };
          existing._count._all += row._count._all;
          existing._sum.total += Number(row._sum.total ?? 0);
          orderStatsMap.set(row.status, existing);
        }
      }
      const orderStats = Array.from(orderStatsMap.values());

      const invoices = snapshots.flatMap((s) => s.invoices);
      const payments = snapshots
        .flatMap((s) => s.payments)
        .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
        .slice(0, 6);
      const balances = snapshots.flatMap((s) => s.balances);
      const thresholds = snapshots.flatMap((s) => s.thresholds);
      const recentOrders = snapshots
        .flatMap((s) => s.recentOrders)
        .sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate))
        .slice(0, 6);
      const productionBatches = snapshots.reduce((sum, s) => sum + s.productionBatches, 0);
      const recentBatches = snapshots
        .flatMap((s) => s.recentBatches)
        .sort((a, b) => new Date(b.productionDate) - new Date(a.productionDate))
        .slice(0, 6);

      const totalSales = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
      const totalCollected = invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0);
      const totalReceivables = invoices.reduce((sum, inv) => sum + Number(inv.balanceDue), 0);
      const activeOrderCount = orderStats
        .filter((s) => s.status !== 'CANCELLED' && s.status !== 'FULFILLED')
        .reduce((sum, s) => sum + s._count._all, 0);
      const finStockMap = new Map();
      const rawStockMap = new Map();
      for (const b of balances) {
        const qty = Number(b.quantity);
        if (b.product.type === ProductType.FINISHED_PRODUCT) {
          finStockMap.set(b.product.unit, (finStockMap.get(b.product.unit) ?? 0) + qty);
        } else {
          rawStockMap.set(b.product.unit, (rawStockMap.get(b.product.unit) ?? 0) + qty);
        }
      }
      const threshMap = new Map();
      for (const t of thresholds)
        threshMap.set(`${t.factoryId}:${t.productId}`, Number(t.minimumQuantity));
      const lowStockItems = balances
        .filter((b) => {
          const min = threshMap.get(`${b.factoryId}:${b.productId}`);
          return min !== undefined && min > 0 && Number(b.quantity) <= min;
        })
        .map((b) => ({
          id: b.id,
          factory: b.factory.name,
          factoryCode: b.factory.code,
          product: b.product.name,
          unit: b.product.unit,
          quantity: Number(b.quantity),
          reorderLevel: threshMap.get(`${b.factoryId}:${b.productId}`),
          minimumQuantity: threshMap.get(`${b.factoryId}:${b.productId}`),
        }));
      const monthBuckets = Array.from(
        {
          length: 6,
        },
        (_, idx) => {
          const d = new Date();
          d.setUTCDate(1);
          d.setUTCHours(0, 0, 0, 0);
          d.setUTCMonth(d.getUTCMonth() - (5 - idx));
          return {
            month: d.toLocaleDateString('en', {
              month: 'short',
              timeZone: 'UTC',
            }),
            year: d.getUTCFullYear(),
            monthNum: d.getUTCMonth(),
            factoryA: 0,
            factoryB: 0,
            total: 0,
          };
        }
      );
      for (const inv of invoices) {
        const d = new Date(inv.issueDate);
        const bucket = monthBuckets.find(
          (b) => b.year === d.getUTCFullYear() && b.monthNum === d.getUTCMonth()
        );
        if (bucket) {
          const amt = Number(inv.total);
          const f = factories.find((fac) => fac.id === inv.factoryId);
          if (f?.code === 'F-B') {
            bucket.factoryB += amt;
          } else {
            bucket.factoryA += amt;
          }
          bucket.total += amt;
        }
      }
      const factoryPerformance = factories.map((fac) => {
        const fInvoices = invoices.filter((inv) => inv.factoryId === fac.id);
        const fOrders = recentOrders.filter((o) => o.factoryId === fac.id);
        const orderValue =
          Math.round(fInvoices.reduce((sum, inv) => sum + Number(inv.total), 0) * 100) / 100;
        return {
          factoryId: fac.id,
          code: fac.code,
          name: fac.name,
          location: fac.location,
          sales: orderValue,
          orderValue,
          collected:
            Math.round(fInvoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0) * 100) / 100,
          receivables:
            Math.round(fInvoices.reduce((sum, inv) => sum + Number(inv.balanceDue), 0) * 100) / 100,
          orderCount: fOrders.length,
        };
      });
      const trendData = monthBuckets.map(({ month, factoryA, factoryB, total }) => ({
        month,
        factoryA: Math.round(factoryA / 1000) / 1000,
        factoryB: Math.round(factoryB / 1000) / 1000,
        total: Math.round(total / 1000) / 1000,
      }));
      res.json({
        perspective: isConsolidated ? 'head-office' : 'factory',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          factoryId: user.factoryId,
          factory: user.factory,
        },
        permissions: {
          finance:
            user.isSuperAdmin ||
            user.role === UserRole.ACCOUNTANT ||
            user.role === UserRole.FACTORY_MANAGER,
          sales:
            user.isSuperAdmin ||
            user.role === UserRole.FACTORY_MANAGER ||
            user.role === UserRole.STAFF ||
            user.role === UserRole.ACCOUNTANT,
          operations: true,
        },
        factories,
        metrics: {
          revenue: Math.round(totalCollected * 100) / 100,
          receivables: Math.round(totalReceivables * 100) / 100,
          orderCount: activeOrderCount,
          productionBatches,
          activeFactories: factories.length,
          totalSales: Math.round(totalSales * 100) / 100,
          totalCollected: Math.round(totalCollected * 100) / 100,
          totalReceivables: Math.round(totalReceivables * 100) / 100,
          activeOrders: activeOrderCount,
          activeProductionBatches: productionBatches,
          lowStockCount: lowStockItems.length,
        },
        finishedGoodsStock: Array.from(finStockMap.entries()).map(([unit, qty]) => ({
          unit,
          quantity: qty,
        })),
        rawMaterialStock: Array.from(rawStockMap.entries()).map(([unit, qty]) => ({
          unit,
          quantity: qty,
        })),
        monthlyTrend: trendData,
        cashTrend: trendData,
        ordersByStatus: orderStats.map((s) => ({
          status: s.status,
          count: s._count._all,
          value: Number(s._sum.total ?? 0),
        })),
        production: recentBatches.map((b) => ({
          batchNumber: b.batchNumber,
          factory: b.factory.name,
          product: b.finishedProduct.name,
          status: b.status,
          plannedQuantity: Number(b.finishedQuantity),
          actualQuantity: Number(b.finishedQuantity),
        })),
        factoryPerformance,
        lowStock: lowStockItems.slice(0, 6),
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customer: o.customer.name,
          factory: o.factory.name,
          factoryCode: o.factory.code,
          status: o.status,
          orderDate: o.orderDate,
          dueDate: o.dueDate,
          total: Number(o.total),
        })),
        recentPayments: payments.map((p) => ({
          id: p.id,
          receiptNo: p.receiptNo,
          customer: p.customer.name,
          factory: p.factory.name,
          invoiceNumber: p.invoice.invoiceNumber,
          amount: Number(p.amount),
          method: p.method,
          paidAt: p.paidAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
