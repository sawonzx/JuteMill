import '../src/load-env.js';
import { PrismaClient } from '@prisma/client';

const urlA =
  process.env.DATABASE_URL_FAC_A ||
  'postgresql://postgres:12345@localhost:5432/jute_mill_fac_a?schema=public';
const urlB =
  process.env.DATABASE_URL_FAC_B ||
  'postgresql://postgres:12345@localhost:5432/jute_mill_fac_b?schema=public';

async function syncFactoryId(dbUrl, targetCode, targetId) {
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const f = await prisma.factory.findUnique({ where: { code: targetCode } });
    if (!f || f.id === targetId) return;

    const oldId = f.id;
    console.log(`Syncing ${targetCode}: ${oldId} -> ${targetId}`);

    await prisma.$executeRawUnsafe(
      `UPDATE "Factory" SET "id" = $1 WHERE "id" = $2`,
      targetId,
      oldId
    );
    console.log(`Updated ${targetCode} to ${targetId}`);
  } catch (err) {
    console.error(`Error syncing ${targetCode}:`, err.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await syncFactoryId(urlA, 'F-A', 'factory-dhaka-fa');
  await syncFactoryId(urlB, 'F-B', 'factory-khulna-fb');
  console.log('Factory IDs synchronized across branch databases.');
}

main();
