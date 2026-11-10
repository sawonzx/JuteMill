import '../src/load-env.js';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

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

async function clearBranchDatabase(url, label) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    console.log(`  Clearing previous rows in ${label} before fresh partition...`);
    await prisma.trashItem.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.invoiceItem.deleteMany();
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
    await prisma.userFactoryAssignment.deleteMany();
    await prisma.user.deleteMany();
    await prisma.factory.deleteMany();
    await prisma.company.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log('--- Seeding & Strictly Partitioning All 3 Databases ---');

  console.log('\n1. Resetting & seeding initial dataset into staging (MAIN)...');
  execSync('node prisma/reset.js', {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: urlMain,
    },
    stdio: 'inherit',
  });

  console.log('\n2. Clearing branch databases for clean partitioned import...');
  await clearBranchDatabase(urlFacA, 'FAC-A');
  await clearBranchDatabase(urlFacB, 'FAC-B');

  console.log('\n3. Partitioning F-A -> FAC-A, F-B -> FAC-B, and purging branch data from MAIN...');
  execSync('node scripts/migrate-strict-isolation.js', {
    cwd: serverDir,
    env: { ...process.env },
    stdio: 'inherit',
  });

  console.log('\nAll 3 databases seeded and strictly partitioned with shared master Product IDs!');
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
