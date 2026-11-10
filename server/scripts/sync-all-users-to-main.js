import { PrismaClient } from '@prisma/client';

const dbUrlMain = 'postgresql://postgres:12345@localhost:5432/jute_mill_main?schema=public';
const dbUrlA = 'postgresql://postgres:12345@localhost:5432/jute_mill_fac_a?schema=public';
const dbUrlB = 'postgresql://postgres:12345@localhost:5432/jute_mill_fac_b?schema=public';

async function syncUsersToMain() {
  const prismaMain = new PrismaClient({ datasources: { db: { url: dbUrlMain } } });
  const prismaA = new PrismaClient({ datasources: { db: { url: dbUrlA } } });
  const prismaB = new PrismaClient({ datasources: { db: { url: dbUrlB } } });

  try {
    console.log('--- Syncing all branch users to Main Office Master Database ---');
    const usersA = await prismaA.user.findMany();
    const usersB = await prismaB.user.findMany();

    const allBranchUsers = [...usersA, ...usersB];

    for (const u of allBranchUsers) {
      console.log(`Syncing to Main: ${u.name} (${u.email}) [Factory: ${u.factoryId}]`);
      await prismaMain.user.upsert({
        where: { email: u.email },
        update: {
          name: u.name,
          role: u.role,
          permissions: u.permissions || [],
          factoryId: u.factoryId,
          active: u.active,
        },
        create: {
          id: u.id,
          name: u.name,
          email: u.email,
          passwordHash: u.passwordHash,
          role: u.role,
          permissions: u.permissions || [],
          factoryId: u.factoryId,
          active: u.active,
        },
      });

      if (u.factoryId) {
        await prismaMain.userFactoryAssignment.upsert({
          where: {
            userId_factoryId: {
              userId: u.id,
              factoryId: u.factoryId,
            },
          },
          update: {},
          create: {
            userId: u.id,
            factoryId: u.factoryId,
          },
        });
      }
    }

    const mainUsers = await prismaMain.user.findMany({
      select: { name: true, email: true, role: true, factoryId: true },
    });
    console.log('\nMaster Users in jute_mill_main:', mainUsers);
  } finally {
    await Promise.all([
      prismaMain.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
    ]);
  }
}

syncUsersToMain().catch((err) => {
  console.error('Failed syncing users to main:', err);
  process.exit(1);
});

