import '../src/load-env.js';
import { PrismaClient } from '@prisma/client';

const urlMain =
  process.env.DATABASE_URL_MAIN ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:12345@localhost:5432/jute_mill_main?schema=public';
const urlFacA =
  process.env.DATABASE_URL_FAC_A ||
  'postgresql://postgres:12345@localhost:5432/jute_mill_fac_a?schema=public';
const urlFacB =
  process.env.DATABASE_URL_FAC_B ||
  'postgresql://postgres:12345@localhost:5432/jute_mill_fac_b?schema=public';

async function syncSharedCatalog(mainDb, branchDb, label) {
  const [companies, products] = await Promise.all([
    mainDb.company.findMany(),
    mainDb.product.findMany(),
  ]);

  if (companies.length > 0) {
    for (const c of companies) {
      await branchDb.company.upsert({
        where: { id: c.id },
        update: {
          name: c.name,
          code: c.code,
          currency: c.currency,
          email: c.email,
          phone: c.phone,
          address: c.address,
        },
        create: c,
      });
    }
  }

  if (products.length > 0) {
    // Upsert by SKU in case product exists with a different id, otherwise preserve Main's ID
    for (const p of products) {
      await branchDb.product.upsert({
        where: { id: p.id },
        update: {
          sku: p.sku,
          name: p.name,
          category: p.category,
          type: p.type,
          unit: p.unit,
          description: p.description,
          status: p.status,
          standardPrice: p.standardPrice,
        },
        create: p,
      });
    }
  }

  console.log(`  [${label}] Synced ${companies.length} company profile(s) and ${products.length} master product(s).`);
}

async function copyFactoryPartition(mainDb, branchDb, factory, label) {
  const fId = factory.id;
  console.log(`\nPartitioning Factory ${factory.code} (${fId}) -> [${label}]...`);

  const [
    users,
    assignments,
    warehouses,
    thresholds,
    customers,
    balances,
    movements,
    orders,
    invoices,
    payments,
    productions,
    trashItems,
    auditLogs,
  ] = await Promise.all([
    mainDb.user.findMany({ where: { factoryId: fId } }),
    mainDb.userFactoryAssignment.findMany({ where: { factoryId: fId } }),
    mainDb.warehouse.findMany({ where: { factoryId: fId } }),
    mainDb.factoryProductThreshold.findMany({ where: { factoryId: fId } }),
    mainDb.customer.findMany({ where: { factoryId: fId } }),
    mainDb.inventoryBalance.findMany({ where: { factoryId: fId } }),
    mainDb.inventoryMovement.findMany({ where: { factoryId: fId } }),
    mainDb.salesOrder.findMany({ where: { factoryId: fId } }),
    mainDb.invoice.findMany({ where: { factoryId: fId } }),
    mainDb.payment.findMany({ where: { factoryId: fId } }),
    mainDb.productionRecord.findMany({ where: { factoryId: fId } }),
    mainDb.trashItem.findMany({ where: { factoryId: fId } }),
    mainDb.auditLog.findMany({ where: { factoryId: fId } }),
  ]);

  const orderIds = orders.map((o) => o.id);
  const invoiceIds = invoices.map((i) => i.id);

  const [orderLines, invoiceItems] = await Promise.all([
    orderIds.length > 0
      ? mainDb.salesOrderLine.findMany({ where: { orderId: { in: orderIds } } })
      : [],
    invoiceIds.length > 0
      ? mainDb.invoiceItem.findMany({ where: { invoiceId: { in: invoiceIds } } })
      : [],
  ]);

  const localUserIds = new Set(users.map((u) => u.id));

  await branchDb.factory.upsert({
    where: { id: factory.id },
    update: {
      code: factory.code,
      name: factory.name,
      location: factory.location,
      address: factory.address,
      phone: factory.phone,
      email: factory.email,
      active: factory.active,
    },
    create: factory,
  });

  if (users.length > 0) {
    await branchDb.user.createMany({ data: users, skipDuplicates: true });
  }
  const validAssignments = assignments.filter((a) => localUserIds.has(a.userId));
  if (validAssignments.length > 0) {
    await branchDb.userFactoryAssignment.createMany({
      data: validAssignments,
      skipDuplicates: true,
    });
  }
  if (warehouses.length > 0) {
    await branchDb.warehouse.createMany({ data: warehouses, skipDuplicates: true });
  }
  if (thresholds.length > 0) {
    await branchDb.factoryProductThreshold.createMany({
      data: thresholds,
      skipDuplicates: true,
    });
  }
  if (customers.length > 0) {
    await branchDb.customer.createMany({ data: customers, skipDuplicates: true });
  }
  if (balances.length > 0) {
    await branchDb.inventoryBalance.createMany({ data: balances, skipDuplicates: true });
  }
  if (movements.length > 0) {
    await branchDb.inventoryMovement.createMany({
      data: movements.map((m) => ({
        ...m,
        createdById: m.createdById && localUserIds.has(m.createdById) ? m.createdById : null,
      })),
      skipDuplicates: true,
    });
  }
  if (orders.length > 0) {
    await branchDb.salesOrder.createMany({
      data: orders.map((o) => ({
        ...o,
        createdById: o.createdById && localUserIds.has(o.createdById) ? o.createdById : null,
      })),
      skipDuplicates: true,
    });
  }
  if (orderLines.length > 0) {
    await branchDb.salesOrderLine.createMany({ data: orderLines, skipDuplicates: true });
  }
  if (invoices.length > 0) {
    await branchDb.invoice.createMany({ data: invoices, skipDuplicates: true });
  }
  if (invoiceItems.length > 0) {
    await branchDb.invoiceItem.createMany({ data: invoiceItems, skipDuplicates: true });
  }
  if (payments.length > 0) {
    await branchDb.payment.createMany({
      data: payments.map((p) => ({
        ...p,
        createdById: p.createdById && localUserIds.has(p.createdById) ? p.createdById : null,
      })),
      skipDuplicates: true,
    });
  }
  if (productions.length > 0) {
    await branchDb.productionRecord.createMany({
      data: productions.map((pr) => ({
        ...pr,
        createdById: pr.createdById && localUserIds.has(pr.createdById) ? pr.createdById : null,
      })),
      skipDuplicates: true,
    });
  }
  if (trashItems.length > 0) {
    await branchDb.trashItem.createMany({ data: trashItems, skipDuplicates: true });
  }
  if (auditLogs.length > 0) {
    await branchDb.auditLog.createMany({
      data: auditLogs.map((l) => ({
        ...l,
        userId: l.userId && localUserIds.has(l.userId) ? l.userId : null,
      })),
      skipDuplicates: true,
    });
  }

  // Verify branch integrity before continuing
  const [vFac, vCust, vOrders, vInv, vBal] = await Promise.all([
    branchDb.factory.count({ where: { id: fId } }),
    branchDb.customer.count({ where: { factoryId: fId } }),
    branchDb.salesOrder.count({ where: { factoryId: fId } }),
    branchDb.invoice.count({ where: { factoryId: fId } }),
    branchDb.inventoryBalance.count({ where: { factoryId: fId } }),
  ]);

  if (
    vFac !== 1 ||
    vCust < customers.length ||
    vOrders < orders.length ||
    vInv < invoices.length ||
    vBal < balances.length
  ) {
    throw new Error(
      `Verification mismatch for ${label}: fac=${vFac}, cust=${vCust}/${customers.length}, orders=${vOrders}/${orders.length}, inv=${vInv}/${invoices.length}, bal=${vBal}/${balances.length}`
    );
  }

  console.log(
    `  [${label}] Verified: users=${users.length}, wh=${warehouses.length}, customers=${vCust}, orders=${vOrders}, invoices=${vInv}, payments=${payments.length}, invBal=${vBal}, mov=${movements.length}, prod=${productions.length}`
  );
}

async function purgeBranchDataFromMain(mainDb) {
  console.log('\nPurging Factory A & B operational data, Factories, and Branch Users from [MAIN]...');

  await mainDb.trashItem.deleteMany({ where: { factoryId: { not: null } } });
  await mainDb.payment.deleteMany();
  await mainDb.invoiceItem.deleteMany();
  await mainDb.invoice.deleteMany();
  await mainDb.salesOrderLine.deleteMany();
  await mainDb.salesOrder.deleteMany();
  await mainDb.productionRecord.deleteMany();
  await mainDb.inventoryMovement.deleteMany();
  await mainDb.inventoryBalance.deleteMany();
  await mainDb.factoryProductThreshold.deleteMany();
  await mainDb.warehouse.deleteMany();
  await mainDb.customer.deleteMany();

  const nonHqUsers = await mainDb.user.findMany({
    where: { role: { not: 'HEAD_OFFICE_ADMIN' } },
    select: { id: true },
  });
  const nonHqIds = nonHqUsers.map((u) => u.id);

  await mainDb.auditLog.deleteMany({ where: { factoryId: { not: null } } });
  if (nonHqIds.length > 0) {
    await mainDb.auditLog.updateMany({
      where: { userId: { in: nonHqIds } },
      data: { userId: null },
    });
  }

  await mainDb.userFactoryAssignment.deleteMany();
  await mainDb.user.deleteMany({ where: { role: { not: 'HEAD_OFFICE_ADMIN' } } });
  await mainDb.factory.deleteMany();

  // Ensure remaining HEAD_OFFICE_ADMIN users have factoryId: null
  await mainDb.user.updateMany({
    where: { role: 'HEAD_OFFICE_ADMIN', factoryId: { not: null } },
    data: { factoryId: null },
  });

  console.log('  [MAIN] Successfully cleaned. Only Company, HQ Admins, Master Products, and HQ AuditLogs remain.');
}

async function main() {
  const mainDb = new PrismaClient({ datasources: { db: { url: urlMain } } });
  const facADb = new PrismaClient({ datasources: { db: { url: urlFacA } } });
  const facBDb = new PrismaClient({ datasources: { db: { url: urlFacB } } });

  try {
    console.log('=== Strict 3-Database Partitioning & Migration ===');

    await syncSharedCatalog(mainDb, facADb, 'FAC-A');
    await syncSharedCatalog(mainDb, facBDb, 'FAC-B');

    const mainFactories = await mainDb.factory.findMany();
    const facA = mainFactories.find((f) => f.code === 'F-A');
    const facB = mainFactories.find((f) => f.code === 'F-B');

    if (facA) {
      await copyFactoryPartition(mainDb, facADb, facA, 'FAC-A');
    } else {
      console.log('\n[MAIN] No F-A factory found in MAIN (already migrated or empty).');
    }

    if (facB) {
      await copyFactoryPartition(mainDb, facBDb, facB, 'FAC-B');
    } else {
      console.log('\n[MAIN] No F-B factory found in MAIN (already migrated or empty).');
    }

    if (mainFactories.length > 0) {
      await purgeBranchDataFromMain(mainDb);
    }

    console.log('\n✅ Strict 3-database separation complete!');
  } finally {
    await Promise.all([mainDb.$disconnect(), facADb.$disconnect(), facBDb.$disconnect()]);
  }
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});

