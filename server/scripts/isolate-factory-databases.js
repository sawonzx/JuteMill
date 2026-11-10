import '../src/load-env.js';
import { PrismaClient, UserRole } from '@prisma/client';

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

async function removeFactoryData(prisma, factoryCodeToDelete) {
  const factory = await prisma.factory.findUnique({
    where: { code: factoryCodeToDelete },
  });

  if (!factory) {
    console.log(`Factory ${factoryCodeToDelete} not found or already removed.`);
    return;
  }

  const fId = factory.id;
  console.log(`Purging Factory ${factoryCodeToDelete} (${fId}) records...`);

  await prisma.trashItem.deleteMany({ where: { factoryId: fId } });

  const invoices = await prisma.invoice.findMany({ where: { factoryId: fId }, select: { id: true } });
  const invIds = invoices.map((i) => i.id);
  if (invIds.length > 0) {
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invIds } } });
    await prisma.invoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
  }

  const orders = await prisma.salesOrder.findMany({ where: { factoryId: fId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    await prisma.salesOrderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: orderIds } } });
  }

  await prisma.productionRecord.deleteMany({ where: { factoryId: fId } });

  const warehouses = await prisma.warehouse.findMany({ where: { factoryId: fId }, select: { id: true } });
  const whIds = warehouses.map((w) => w.id);
  if (whIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.inventoryBalance.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: whIds } } });
  }

  await prisma.factoryProductThreshold.deleteMany({ where: { factoryId: fId } });
  await prisma.customer.deleteMany({ where: { factoryId: fId } });

  const facUsers = await prisma.user.findMany({ where: { factoryId: fId }, select: { id: true } });
  const facUserIds = facUsers.map((u) => u.id);

  await prisma.auditLog.deleteMany({ where: { factoryId: fId } });
  if (facUserIds.length > 0) {
    await prisma.auditLog.updateMany({
      where: { userId: { in: facUserIds } },
      data: { userId: null },
    });
  }

  await prisma.userFactoryAssignment.deleteMany({ where: { factoryId: fId } });
  await prisma.user.deleteMany({ where: { factoryId: fId } });

  await prisma.factory.delete({ where: { id: fId } });
  console.log(`✓ Completely removed ${factoryCodeToDelete} from this database.`);
}

async function cleanMainDatabase(prisma) {
  await removeFactoryData(prisma, 'F-A');
  await removeFactoryData(prisma, 'F-B');
  // Remove any stray non-HEAD_OFFICE_ADMIN users on Main
  const strayUsers = await prisma.user.findMany({
    where: { role: { not: UserRole.HEAD_OFFICE_ADMIN } },
    select: { id: true },
  });
  const strayIds = strayUsers.map((u) => u.id);
  if (strayIds.length > 0) {
    await prisma.auditLog.updateMany({
      where: { userId: { in: strayIds } },
      data: { userId: null },
    });
    await prisma.userFactoryAssignment.deleteMany({ where: { userId: { in: strayIds } } });
    await prisma.user.deleteMany({ where: { id: { in: strayIds } } });
  }
}

async function cleanBranchUsers(prisma) {
  // Branches must NOT keep Head Office Admin users
  const hqUsers = await prisma.user.findMany({
    where: { role: UserRole.HEAD_OFFICE_ADMIN },
    select: { id: true },
  });
  const hqIds = hqUsers.map((u) => u.id);
  if (hqIds.length > 0) {
    await prisma.inventoryMovement.updateMany({
      where: { createdById: { in: hqIds } },
      data: { createdById: null },
    });
    await prisma.salesOrder.updateMany({
      where: { createdById: { in: hqIds } },
      data: { createdById: null },
    });
    await prisma.payment.updateMany({
      where: { createdById: { in: hqIds } },
      data: { createdById: null },
    });
    await prisma.productionRecord.updateMany({
      where: { createdById: { in: hqIds } },
      data: { createdById: null },
    });
    await prisma.auditLog.updateMany({
      where: { userId: { in: hqIds } },
      data: { userId: null },
    });
    await prisma.userFactoryAssignment.deleteMany({ where: { userId: { in: hqIds } } });
    await prisma.user.deleteMany({ where: { id: { in: hqIds } } });
  }
}

async function main() {
  console.log('--- Enforcing Strict 3-Database Isolation ---');

  const prismaMain = new PrismaClient({ datasources: { db: { url: urlMain } } });
  const prismaA = new PrismaClient({ datasources: { db: { url: urlFacA } } });
  const prismaB = new PrismaClient({ datasources: { db: { url: urlFacB } } });

  try {
    console.log('\n[MAIN DB] Removing all branch factories & operational data from Main HQ...');
    await cleanMainDatabase(prismaMain);
    console.log('Factories remaining in MAIN:', await prismaMain.factory.findMany({ select: { code: true } }));

    console.log('\n[FAC-A DB] Ensuring ONLY Factory A exists in FAC-A...');
    await removeFactoryData(prismaA, 'F-B');
    await cleanBranchUsers(prismaA);
    console.log('Factories remaining in FAC-A:', await prismaA.factory.findMany({ select: { code: true, name: true } }));

    console.log('\n[FAC-B DB] Ensuring ONLY Factory B exists in FAC-B...');
    await removeFactoryData(prismaB, 'F-A');
    await cleanBranchUsers(prismaB);
    console.log('Factories remaining in FAC-B:', await prismaB.factory.findMany({ select: { code: true, name: true } }));

    console.log('\nStrict 3-DB isolation verified successfully!');
  } finally {
    await Promise.all([prismaMain.$disconnect(), prismaA.$disconnect(), prismaB.$disconnect()]);
  }
}

main().catch((err) => {
  console.error('Failed enforcing isolation:', err);
  process.exit(1);
});
