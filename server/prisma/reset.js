import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run reset in production environment.');
    process.exitCode = 1;
    return;
  }
  console.log('\n⚠️  DEVELOPMENT RESET — Wiping all data…\n');
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesOrderLine.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.productionRecord.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.inventoryBalance.deleteMany();
  await prisma.factoryProductThreshold.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.factory.deleteMany();
  console.log('  ✓ All tables cleared\n');
  console.log('Now re-seeding…\n');
  await import('./seed.js');
}
main()
  .catch((error) => {
    console.error('\n❌ Reset failed:\n', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
