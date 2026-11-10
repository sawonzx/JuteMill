import { Router } from 'express';
import { InvoiceStatus, UserRole } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getQueryClients } from '../federation.js';

export function createReportsRouter(prisma, dbManager) {
  const router = Router();
  router.use(
    requireAuth,
    requireRole(UserRole.HEAD_OFFICE_ADMIN, UserRole.FACTORY_MANAGER, UserRole.ACCOUNTANT)
  );

  router.get('/sales', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      const from = req.query.from
        ? new Date(req.query.from)
        : new Date(Date.now() - 180 * 86400000);
      const to = req.query.to ? new Date(req.query.to) : new Date();

      let factoryIds = user.accessibleFactoryIds;
      let targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
        targetFactoryId = requestedFactoryId;
      }

      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};
      const factoryIdFilter = factoryIds ? { id: { in: factoryIds } } : {};

      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      const perBranch = await Promise.all(
        clients.map((db) =>
          Promise.all([
            db.invoice.findMany({
              where: {
                ...factoryScope,
                status: { not: 'VOID' },
                issueDate: { gte: from, lte: to },
              },
              include: {
                factory: { select: { id: true, code: true, name: true } },
                customer: { select: { id: true, name: true, code: true } },
              },
            }),
            db.payment.findMany({
              where: {
                ...factoryScope,
                paidAt: { gte: from, lte: to },
              },
              include: {
                factory: { select: { id: true, code: true, name: true } },
              },
            }),
            db.factory.findMany({
              where: factoryIdFilter,
              select: { id: true, code: true, name: true },
            }),
          ])
        )
      );

      const invoices = perBranch.flatMap((r) => r[0]);
      const payments = perBranch.flatMap((r) => r[1]);
      const factories = perBranch
        .flatMap((r) => r[2])
        .sort((a, b) => a.code.localeCompare(b.code));

      const totalInvoiced = invoices.reduce((sum, inv) => sum + Number(inv.total), 0);
      const totalCollected = payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const totalOutstanding = invoices.reduce((sum, inv) => sum + Number(inv.balanceDue), 0);
      const paidInvoiceCount = invoices.filter((i) => i.status === 'PAID').length;

      const factoryBreakdown = factories.map((f) => {
        const fInvoices = invoices.filter((inv) => inv.factoryId === f.id);
        const fPayments = payments.filter((p) => p.factoryId === f.id);
        const invoiced = fInvoices.reduce((s, inv) => s + Number(inv.total), 0);
        const collected = fPayments.reduce((s, p) => s + Number(p.amount), 0);
        const outstanding = fInvoices.reduce((s, inv) => s + Number(inv.balanceDue), 0);
        return {
          factoryId: f.id,
          factoryCode: f.code,
          factoryName: f.name,
          invoiceCount: fInvoices.length,
          totalInvoiced: Math.round(invoiced * 100) / 100,
          totalCollected: Math.round(collected * 100) / 100,
          totalOutstanding: Math.round(outstanding * 100) / 100,
        };
      });

      const monthBuckets = Array.from({ length: 6 }, (_, idx) => {
        const d = new Date();
        d.setUTCDate(1);
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCMonth(d.getUTCMonth() - (5 - idx));
        return {
          month: d.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' }),
          year: d.getUTCFullYear(),
          monthNum: d.getUTCMonth(),
          factoryA: 0,
          factoryB: 0,
          total: 0,
        };
      });

      for (const p of payments) {
        const pDate = new Date(p.paidAt);
        const bucket = monthBuckets.find(
          (b) => b.monthNum === pDate.getUTCMonth() && b.year === pDate.getUTCFullYear()
        );
        if (bucket) {
          const amt = Number(p.amount);
          if (p.factory?.code === 'F-B') {
            bucket.factoryB += amt;
          } else {
            bucket.factoryA += amt;
          }
          bucket.total += amt;
        }
      }

      const custMap = new Map();
      for (const inv of invoices) {
        const existing = custMap.get(inv.customerId) ?? {
          id: inv.customerId,
          name: inv.customer.name,
          factoryCode: inv.factory.code,
          totalSales: 0,
          invoiceCount: 0,
        };
        existing.totalSales += Number(inv.total);
        existing.invoiceCount += 1;
        custMap.set(inv.customerId, existing);
      }

      const topCustomers = Array.from(custMap.values())
        .map((c) => ({
          ...c,
          totalSales: Math.round(c.totalSales * 100) / 100,
        }))
        .sort((a, b) => b.totalSales - a.totalSales)
        .slice(0, 10);

      res.json({
        period: { from, to },
        summary: {
          totalRevenue: Math.round(totalCollected * 100) / 100,
          totalInvoiced: Math.round(totalInvoiced * 100) / 100,
          totalOutstanding: Math.round(totalOutstanding * 100) / 100,
          invoiceCount: invoices.length,
          paidInvoiceCount,
        },
        totalInvoiced: Math.round(totalInvoiced * 100) / 100,
        totalCollected: Math.round(totalCollected * 100) / 100,
        totalOutstanding: Math.round(totalOutstanding * 100) / 100,
        factoryBreakdown,
        monthly: monthBuckets.map(({ month, factoryA, factoryB, total }) => ({
          month,
          factoryA: Math.round(factoryA * 100) / 100,
          factoryB: Math.round(factoryB * 100) / 100,
          total: Math.round(total * 100) / 100,
        })),
        topCustomers,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/orders', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      let targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
        targetFactoryId = requestedFactoryId;
      }

      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};
      const factoryIdFilter = factoryIds ? { id: { in: factoryIds } } : {};

      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      const perBranch = await Promise.all(
        clients.map((db) =>
          Promise.all([
            db.salesOrder.groupBy({
              by: ['status'],
              where: factoryScope,
              _count: { _all: true },
              _sum: { total: true },
            }),
            db.factory.findMany({
              where: factoryIdFilter,
              select: { id: true, code: true, name: true },
            }),
            db.salesOrder.findMany({
              where: factoryScope,
              select: { id: true, factoryId: true, total: true, status: true },
            }),
            db.salesOrder.count({ where: factoryScope }),
          ])
        )
      );

      const statusMap = new Map();
      for (const r of perBranch) {
        for (const s of r[0]) {
          const prev = statusMap.get(s.status) || { status: s.status, count: 0, value: 0 };
          prev.count += s._count._all;
          prev.value += Number(s._sum.total ?? 0);
          statusMap.set(s.status, prev);
        }
      }

      const factories = perBranch
        .flatMap((r) => r[1])
        .sort((a, b) => a.code.localeCompare(b.code));
      const allOrders = perBranch.flatMap((r) => r[2]);
      const totalCount = perBranch.reduce((acc, r) => acc + r[3], 0);

      const totalValue = allOrders.reduce((sum, o) => sum + Number(o.total), 0);
      const byFactory = factories.map((f) => {
        const fOrders = allOrders.filter((o) => o.factoryId === f.id);
        return {
          factoryId: f.id,
          factoryName: f.name,
          factoryCode: f.code,
          count: fOrders.length,
          totalValue: Math.round(fOrders.reduce((s, o) => s + Number(o.total), 0) * 100) / 100,
        };
      });

      res.json({
        totalOrders: totalCount,
        totalValue: Math.round(totalValue * 100) / 100,
        byStatus: Array.from(statusMap.values()).map((s) => ({
          status: s.status,
          count: s.count,
          value: Math.round(s.value * 100) / 100,
        })),
        byFactory,
        factories,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/receivables', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      let targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
        targetFactoryId = requestedFactoryId;
      }

      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};
      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      const branchInvoices = await Promise.all(
        clients.map((db) =>
          db.invoice.findMany({
            where: {
              ...factoryScope,
              status: {
                in: [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID, InvoiceStatus.OVERDUE],
              },
            },
            include: {
              customer: { select: { id: true, code: true, name: true, phone: true } },
              factory: { select: { id: true, code: true, name: true } },
            },
            orderBy: { dueDate: 'asc' },
          })
        )
      );

      const invoices = branchInvoices
        .flat()
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      const now = new Date();
      let current = 0;
      let overdue1to30 = 0;
      let overdue31to60 = 0;
      let overdue60plus = 0;
      const customerMap = new Map();

      for (const inv of invoices) {
        const bal = Number(inv.balanceDue);
        const diffDays = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
        if (diffDays <= 0) current += bal;
        else if (diffDays <= 30) overdue1to30 += bal;
        else if (diffDays <= 60) overdue31to60 += bal;
        else overdue60plus += bal;

        const cust = customerMap.get(inv.customerId) ?? {
          id: inv.customer.id,
          code: inv.customer.code,
          name: inv.customer.name,
          phone: inv.customer.phone,
          factory: inv.factory.name,
          totalBalance: 0,
          invoiceCount: 0,
        };
        cust.totalBalance += bal;
        cust.invoiceCount += 1;
        customerMap.set(inv.customerId, cust);
      }

      const totalReceivables = current + overdue1to30 + overdue31to60 + overdue60plus;
      const formattedCustomers = Array.from(customerMap.values())
        .map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          phone: c.phone,
          factory: c.factory,
          outstandingBalance: Math.round(c.totalBalance * 100) / 100,
          totalBalance: Math.round(c.totalBalance * 100) / 100,
          overdueInvoices: c.invoiceCount,
          invoiceCount: c.invoiceCount,
        }))
        .sort((a, b) => b.outstandingBalance - a.outstandingBalance);

      res.json({
        totalReceivables: Math.round(totalReceivables * 100) / 100,
        totalOutstanding: Math.round(totalReceivables * 100) / 100,
        customerCount: formattedCustomers.length,
        aging: {
          current: Math.round(current * 100) / 100,
          days30: Math.round(overdue1to30 * 100) / 100,
          days60: Math.round(overdue31to60 * 100) / 100,
          days90Plus: Math.round(overdue60plus * 100) / 100,
          overdue1to30: Math.round(overdue1to30 * 100) / 100,
          overdue31to60: Math.round(overdue31to60 * 100) / 100,
          overdue60plus: Math.round(overdue60plus * 100) / 100,
        },
        customers: formattedCustomers,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/production', async (req, res, next) => {
    try {
      const user = req.user;
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      let targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
        targetFactoryId = requestedFactoryId;
      }

      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};
      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      const branchBatches = await Promise.all(
        clients.map((db) =>
          db.productionRecord.findMany({
            where: factoryScope,
            include: {
              factory: { select: { id: true, code: true, name: true } },
              rawMaterial: { select: { id: true, sku: true, name: true, unit: true } },
              finishedProduct: { select: { id: true, sku: true, name: true, unit: true } },
            },
            orderBy: { productionDate: 'desc' },
          })
        )
      );

      const batches = branchBatches
        .flat()
        .sort((a, b) => new Date(b.productionDate) - new Date(a.productionDate));

      const completed = batches.filter((b) => b.status === 'COMPLETED');
      const draft = batches.filter((b) => b.status === 'DRAFT');
      const rawConsumedByUnit = new Map();
      const finProducedByUnit = new Map();
      const byProductMap = new Map();

      for (const b of completed) {
        const rawUnit = b.rawMaterial.unit;
        const finUnit = b.finishedProduct.unit;
        const rawQty = Number(b.rawMaterialQuantity);
        const finQty = Number(b.finishedQuantity);

        rawConsumedByUnit.set(rawUnit, (rawConsumedByUnit.get(rawUnit) ?? 0) + rawQty);
        finProducedByUnit.set(finUnit, (finProducedByUnit.get(finUnit) ?? 0) + finQty);

        const prod = byProductMap.get(b.finishedProductId) ?? {
          productId: b.finishedProductId,
          productName: b.finishedProduct.name,
          unit: finUnit,
          totalProduced: 0,
          batchCount: 0,
        };
        prod.totalProduced += finQty;
        prod.batchCount += 1;
        byProductMap.set(b.finishedProductId, prod);
      }

      const totalRawConsumedObj = {};
      for (const [unit, qty] of rawConsumedByUnit.entries()) {
        totalRawConsumedObj[unit] = Math.round(qty * 100) / 100;
      }
      const totalFinishedProducedObj = {};
      for (const [unit, qty] of finProducedByUnit.entries()) {
        totalFinishedProducedObj[unit] = Math.round(qty * 100) / 100;
      }

      res.json({
        totalBatches: batches.length,
        completedBatches: completed.length,
        draftBatches: draft.length,
        totalRawConsumed: totalRawConsumedObj,
        totalFinishedProduced: totalFinishedProducedObj,
        rawConsumed: Array.from(rawConsumedByUnit.entries()).map(([unit, qty]) => ({
          unit,
          quantity: Math.round(qty * 100) / 100,
        })),
        finishedProduced: Array.from(finProducedByUnit.entries()).map(([unit, qty]) => ({
          unit,
          quantity: Math.round(qty * 100) / 100,
        })),
        byProduct: Array.from(byProductMap.values()).map((p) => ({
          ...p,
          totalProduced: Math.round(p.totalProduced * 100) / 100,
        })),
        recentBatches: batches.slice(0, 10).map((b) => ({
          ...b,
          rawMaterialQuantity: Number(b.rawMaterialQuantity),
          finishedQuantity: Number(b.finishedQuantity),
          wastageQuantity: b.wastageQuantity ? Number(b.wastageQuantity) : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/export/:type', async (req, res, next) => {
    try {
      const user = req.user;
      const type = req.params.type;
      const requestedFactoryId = req.query.factoryId;
      let factoryIds = user.accessibleFactoryIds;
      let targetFactoryId = user.isSuperAdmin ? null : user.factoryId;
      if (requestedFactoryId && user.canAccessFactory(requestedFactoryId)) {
        factoryIds = [requestedFactoryId];
        targetFactoryId = requestedFactoryId;
      }

      const factoryScope = factoryIds ? { factoryId: { in: factoryIds } } : {};
      const clients = await getQueryClients(prisma, dbManager, targetFactoryId);

      let csv = '';
      const filename = `export-${type}-${Date.now()}.csv`;

      if (type === 'customers') {
        const lists = await Promise.all(
          clients.map((db) =>
            db.customer.findMany({
              where: factoryScope,
              include: { factory: true },
              orderBy: { name: 'asc' },
            })
          )
        );
        const items = lists.flat().sort((a, b) => a.name.localeCompare(b.name));
        csv = 'Code,Name,Contact Person,Phone,Email,Type,Factory,Address,City\n';
        for (const c of items) {
          csv += `"${c.code}","${c.name}","${c.contactPerson}","${c.phone}","${c.email ?? ''}","${c.type}","${c.factory.name}","${c.address}","${c.city}"\n`;
        }
      } else if (type === 'sales') {
        const lists = await Promise.all(
          clients.map((db) =>
            db.invoice.findMany({
              where: { ...factoryScope, status: { not: 'VOID' } },
              include: { factory: true, customer: true },
              orderBy: { issueDate: 'desc' },
            })
          )
        );
        const items = lists.flat().sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
        csv =
          'Invoice Number,Date,Due Date,Customer,Factory,Status,Total (BDT),Paid (BDT),Balance Due (BDT)\n';
        for (const inv of items) {
          csv += `"${inv.invoiceNumber}","${inv.issueDate.toISOString().split('T')[0]}","${inv.dueDate.toISOString().split('T')[0]}","${inv.customer.name}","${inv.factory.name}","${inv.status}","${inv.total}","${inv.paidAmount}","${inv.balanceDue}"\n`;
        }
      } else if (type === 'orders') {
        const lists = await Promise.all(
          clients.map((db) =>
            db.salesOrder.findMany({
              where: factoryScope,
              include: { factory: true, customer: true },
              orderBy: { orderDate: 'desc' },
            })
          )
        );
        const items = lists.flat().sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
        csv = 'Order Number,Date,Due Date,Customer,Factory,Status,Total (BDT)\n';
        for (const o of items) {
          csv += `"${o.orderNumber}","${o.orderDate.toISOString().split('T')[0]}","${o.dueDate.toISOString().split('T')[0]}","${o.customer.name}","${o.factory.name}","${o.status}","${o.total}"\n`;
        }
      } else if (type === 'inventory') {
        const lists = await Promise.all(
          clients.map((db) =>
            db.inventoryBalance.findMany({
              where: factoryScope,
              include: { factory: true, warehouse: true, product: true },
              orderBy: [{ factoryId: 'asc' }, { productId: 'asc' }],
            })
          )
        );
        const items = lists.flat().sort((a, b) => {
          const fc = a.factory.code.localeCompare(b.factory.code);
          return fc !== 0 ? fc : a.product.name.localeCompare(b.product.name);
        });
        csv = 'Factory,Warehouse,SKU,Product Name,Category,Type,Unit,Quantity\n';
        for (const b of items) {
          csv += `"${b.factory.name}","${b.warehouse.name}","${b.product.sku}","${b.product.name}","${b.product.category}","${b.product.type}","${b.product.unit}","${b.quantity}"\n`;
        }
      } else if (type === 'receivables') {
        const lists = await Promise.all(
          clients.map((db) =>
            db.invoice.findMany({
              where: {
                ...factoryScope,
                status: { in: ['ISSUED', 'PART_PAID', 'OVERDUE'] },
              },
              include: { factory: true, customer: true },
              orderBy: { dueDate: 'asc' },
            })
          )
        );
        const items = lists.flat().sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
        csv =
          'Invoice Number,Customer,Phone,Factory,Issue Date,Due Date,Total (BDT),Balance Due (BDT)\n';
        for (const inv of items) {
          csv += `"${inv.invoiceNumber}","${inv.customer.name}","${inv.customer.phone}","${inv.factory.name}","${inv.issueDate.toISOString().split('T')[0]}","${inv.dueDate.toISOString().split('T')[0]}","${inv.total}","${inv.balanceDue}"\n`;
        }
      } else if (type === 'production') {
        const lists = await Promise.all(
          clients.map((db) =>
            db.productionRecord.findMany({
              where: factoryScope,
              include: { factory: true, rawMaterial: true, finishedProduct: true },
              orderBy: { productionDate: 'desc' },
            })
          )
        );
        const items = lists
          .flat()
          .sort((a, b) => new Date(b.productionDate) - new Date(a.productionDate));
        csv =
          'Batch Number,Date,Status,Factory,Raw Material,Raw Consumed,Finished Good,Finished Output\n';
        for (const p of items) {
          csv += `"${p.batchNumber}","${p.productionDate.toISOString().split('T')[0]}","${p.status}","${p.factory.name}","${p.rawMaterial.name}","${p.rawMaterialQuantity} ${p.rawMaterial.unit}","${p.finishedProduct.name}","${p.finishedQuantity} ${p.finishedProduct.unit}"\n`;
        }
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
