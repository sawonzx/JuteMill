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

function generateTrendBuckets(period = '6month', customStart, customEnd) {
  const now = new Date();

  if (period === 'today') {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const buckets = [];
    for (let h = 0; h < 24; h += 3) {
      const bStart = new Date(startOfToday);
      bStart.setHours(h, 0, 0, 0);
      const bEnd = new Date(startOfToday);
      bEnd.setHours(h + 2, 59, 59, 999);
      buckets.push({
        label: `${String(h).padStart(2, '0')}:00`,
        startTime: bStart.getTime(),
        endTime: bEnd.getTime(),
        factoryA: 0,
        factoryB: 0,
        total: 0,
      });
    }
    return {
      buckets,
      startTime: startOfToday.getTime(),
      endTime: endOfToday.getTime(),
      periodLabel: 'Today',
    };
  }

  if (period === 'week') {
    const buckets = [];
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const bStart = new Date(d);
      bStart.setHours(0, 0, 0, 0);
      const bEnd = new Date(d);
      bEnd.setHours(23, 59, 59, 999);
      buckets.push({
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
        startTime: bStart.getTime(),
        endTime: bEnd.getTime(),
        factoryA: 0,
        factoryB: 0,
        total: 0,
      });
    }
    return {
      buckets,
      startTime: start.getTime(),
      endTime: end.getTime(),
      periodLabel: 'Last 7 Days',
    };
  }

  if (period === '15days') {
    const buckets = [];
    const start = new Date(now);
    start.setDate(start.getDate() - 14);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    for (let i = 0; i < 15; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const bStart = new Date(d);
      bStart.setHours(0, 0, 0, 0);
      const bEnd = new Date(d);
      bEnd.setHours(23, 59, 59, 999);
      buckets.push({
        label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        startTime: bStart.getTime(),
        endTime: bEnd.getTime(),
        factoryA: 0,
        factoryB: 0,
        total: 0,
      });
    }
    return {
      buckets,
      startTime: start.getTime(),
      endTime: end.getTime(),
      periodLabel: 'Last 15 Days',
    };
  }

  if (period === 'month') {
    const buckets = [];
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    for (let i = 0; i < 30; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const bStart = new Date(d);
      bStart.setHours(0, 0, 0, 0);
      const bEnd = new Date(d);
      bEnd.setHours(23, 59, 59, 999);
      buckets.push({
        label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        startTime: bStart.getTime(),
        endTime: bEnd.getTime(),
        factoryA: 0,
        factoryB: 0,
        total: 0,
      });
    }
    return {
      buckets,
      startTime: start.getTime(),
      endTime: end.getTime(),
      periodLabel: 'Last 30 Days',
    };
  }

  if (period === 'custom' && customStart && customEnd) {
    const start = new Date(customStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);

    const effectiveStart = start <= end ? start : end;
    const effectiveEnd = start <= end ? end : start;
    const diffDays = Math.max(
      1,
      Math.round((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24))
    );

    const buckets = [];
    if (diffDays <= 1) {
      for (let h = 0; h < 24; h += 3) {
        const bStart = new Date(effectiveStart);
        bStart.setHours(h, 0, 0, 0);
        const bEnd = new Date(effectiveStart);
        bEnd.setHours(h + 2, 59, 59, 999);
        buckets.push({
          label: `${String(h).padStart(2, '0')}:00`,
          startTime: bStart.getTime(),
          endTime: bEnd.getTime(),
          factoryA: 0,
          factoryB: 0,
          total: 0,
        });
      }
    } else if (diffDays <= 35) {
      for (let i = 0; i <= diffDays; i++) {
        const d = new Date(effectiveStart);
        d.setDate(effectiveStart.getDate() + i);
        if (d.getTime() > effectiveEnd.getTime() && i > 0) break;
        const bStart = new Date(d);
        bStart.setHours(0, 0, 0, 0);
        const bEnd = new Date(d);
        bEnd.setHours(23, 59, 59, 999);
        buckets.push({
          label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
          startTime: bStart.getTime(),
          endTime: bEnd.getTime(),
          factoryA: 0,
          factoryB: 0,
          total: 0,
        });
      }
    } else if (diffDays <= 120) {
      let curr = new Date(effectiveStart);
      while (curr.getTime() <= effectiveEnd.getTime()) {
        const bStart = new Date(curr);
        bStart.setHours(0, 0, 0, 0);
        const next = new Date(curr);
        next.setDate(curr.getDate() + 6);
        const bEnd =
          next.getTime() > effectiveEnd.getTime() ? new Date(effectiveEnd) : new Date(next);
        bEnd.setHours(23, 59, 59, 999);
        buckets.push({
          label: bStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
          startTime: bStart.getTime(),
          endTime: bEnd.getTime(),
          factoryA: 0,
          factoryB: 0,
          total: 0,
        });
        curr.setDate(curr.getDate() + 7);
      }
    } else {
      let curr = new Date(effectiveStart.getFullYear(), effectiveStart.getMonth(), 1);
      while (curr.getTime() <= effectiveEnd.getTime()) {
        const bStart = new Date(Math.max(curr.getTime(), effectiveStart.getTime()));
        const nextMonth = new Date(curr.getFullYear(), curr.getMonth() + 1, 0, 23, 59, 59, 999);
        const bEnd = new Date(Math.min(nextMonth.getTime(), effectiveEnd.getTime()));
        buckets.push({
          label: curr.toLocaleDateString('en', { month: 'short', year: '2-digit' }),
          startTime: bStart.getTime(),
          endTime: bEnd.getTime(),
          factoryA: 0,
          factoryB: 0,
          total: 0,
        });
        curr = new Date(curr.getFullYear(), curr.getMonth() + 1, 1);
      }
    }
    const formattedRange = `${effectiveStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${effectiveEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    return {
      buckets,
      startTime: effectiveStart.getTime(),
      endTime: effectiveEnd.getTime(),
      periodLabel: formattedRange,
    };
  }

  // Default: '6month'
  const buckets = Array.from({ length: 6 }, (_, idx) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
    const bStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
    const bEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      label: d.toLocaleDateString('en', { month: 'short' }),
      startTime: bStart.getTime(),
      endTime: bEnd.getTime(),
      factoryA: 0,
      factoryB: 0,
      total: 0,
    };
  });
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  return {
    buckets,
    startTime: firstBucket.startTime,
    endTime: lastBucket.endTime,
    periodLabel: 'Last 6 Months',
  };
}

export function createDashboardRouter(prisma, dbManager) {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      const period = (req.query.period || '6month').toLowerCase();
      const customStart = req.query.startDate;
      const customEnd = req.query.endDate;
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
      const allPayments = snapshots.flatMap((s) => s.payments);
      const payments = allPayments
        .slice()
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
      const { buckets, startTime, endTime, periodLabel } = generateTrendBuckets(
        period,
        customStart,
        customEnd
      );

      let periodRevenue = 0;
      const nowObj = new Date();
      const startOfCurrentMonth = new Date(nowObj.getFullYear(), nowObj.getMonth(), 1, 0, 0, 0, 0).getTime();
      const endOfCurrentMonth = new Date(nowObj.getFullYear(), nowObj.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
      const startOfLastMonth = new Date(nowObj.getFullYear(), nowObj.getMonth() - 1, 1, 0, 0, 0, 0).getTime();
      const endOfLastMonth = new Date(nowObj.getFullYear(), nowObj.getMonth(), 0, 23, 59, 59, 999).getTime();

      let thisMonthRevenue = 0;
      let lastMonthRevenue = 0;

      for (const pay of allPayments) {
        const payTime = new Date(pay.paidAt).getTime();
        const amt = Number(pay.amount);

        if (payTime >= startOfCurrentMonth && payTime <= endOfCurrentMonth) {
          thisMonthRevenue += amt;
        } else if (payTime >= startOfLastMonth && payTime <= endOfLastMonth) {
          lastMonthRevenue += amt;
        }

        if (payTime >= startTime && payTime <= endTime) {
          periodRevenue += amt;
          const bucket = buckets.find((b) => payTime >= b.startTime && payTime <= b.endTime);
          if (bucket) {
            const f = factories.find((fac) => fac.id === pay.factoryId);
            if (f?.code === 'F-B') {
              bucket.factoryB += amt;
            } else {
              bucket.factoryA += amt;
            }
            bucket.total += amt;
          }
        }
      }

      let monthGrowthPct = null;
      if (lastMonthRevenue > 0) {
        monthGrowthPct = Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 1000) / 10;
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

      const trendData = buckets.map(({ label, factoryA, factoryB, total }) => ({
        label,
        month: label,
        factoryA: Math.round(factoryA / 1000) / 1000,
        factoryB: Math.round(factoryB / 1000) / 1000,
        total: Math.round(total / 1000) / 1000,
      }));

      res.json({
        perspective: isConsolidated ? 'head-office' : 'factory',
        period,
        periodLabel,
        periodRevenue: Math.round(periodRevenue * 100) / 100,
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
          thisMonthRevenue: Math.round(thisMonthRevenue * 100) / 100,
          lastMonthRevenue: Math.round(lastMonthRevenue * 100) / 100,
          monthGrowthPct,
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
