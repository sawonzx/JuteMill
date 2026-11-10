import '../src/load-env.js';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverDir = path.resolve(__dirname, '..');

const targets = [
  {
    label: 'MAIN',
    url:
      process.env.DATABASE_URL_MAIN ||
      process.env.DATABASE_URL ||
      'postgresql://postgres:12345@localhost:5432/jute_mill_main?schema=public',
  },
  {
    label: 'FAC-A',
    url:
      process.env.DATABASE_URL_FAC_A ||
      'postgresql://postgres:12345@localhost:5432/jute_mill_fac_a?schema=public',
  },
  {
    label: 'FAC-B',
    url:
      process.env.DATABASE_URL_FAC_B ||
      'postgresql://postgres:12345@localhost:5432/jute_mill_fac_b?schema=public',
  },
];

async function ensureLocalDatabaseIfNeeded(targetUrl) {
  const parsed = new URL(targetUrl);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (!parsed.hostname.includes('localhost') && parsed.hostname !== '127.0.0.1') {
    return dbName;
  }

  const adminUrl = `${parsed.protocol}//${parsed.username}:${parsed.password}@${parsed.host}/postgres?schema=public`;
  const adminClient = new PrismaClient({
    datasources: { db: { url: adminUrl } },
  });

  try {
    await adminClient.$connect();
    const existing = await adminClient.$queryRawUnsafe(
      `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`
    );
    if (!existing || existing.length === 0) {
      console.log(`Creating local database: ${dbName}...`);
      await adminClient.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database: ${dbName}`);
    } else {
      console.log(`Database "${dbName}" already exists.`);
    }
  } finally {
    await adminClient.$disconnect();
  }
  return dbName;
}

function pushSchema(label, targetUrl) {
  const parsed = new URL(targetUrl);
  const dbName = parsed.pathname.replace(/^\//, '');
  console.log(`\nPushing Prisma schema to [${label}] ${dbName} (${parsed.hostname})...`);
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    cwd: serverDir,
    env: {
      ...process.env,
      DATABASE_URL: targetUrl,
    },
    stdio: 'inherit',
  });
  console.log(`Schema successfully synced for [${label}] ${dbName}.`);
}

async function main() {
  console.log('--- Provisioning & Pushing Schema to 3 Independent Databases ---');
  for (const t of targets) {
    await ensureLocalDatabaseIfNeeded(t.url);
    pushSchema(t.label, t.url);
  }
  console.log('\nAll 3 databases provisioned and migrated successfully!');
}

main().catch((err) => {
  console.error('Database provisioning failed:', err);
  process.exit(1);
});
