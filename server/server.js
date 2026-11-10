import './src/load-env.js';
import { createDatabaseManager } from './src/db-manager.js';
import { createApp } from './src/app.js';

function dbLabel(envUrl, fallback) {
  try {
    if (!envUrl) return fallback;
    return new URL(envUrl).pathname.replace(/^\//, '') || fallback;
  } catch {
    return fallback;
  }
}

const arg = (process.argv[2] || '').toLowerCase();

if (arg === 'fac-a' || arg === 'a' || arg === 'fac_a') {
  import('./server-fac-a.js');
} else if (arg === 'fac-b' || arg === 'b' || arg === 'fac_b') {
  import('./server-fac-b.js');
} else if (arg === 'main') {
  import('./server-main.js');
} else {
  const mainName = dbLabel(process.env.DATABASE_URL_MAIN || process.env.DATABASE_URL, 'jute_mill_main');
  const facAName = dbLabel(process.env.DATABASE_URL_FAC_A, 'jute_mill_fac_a');
  const facBName = dbLabel(process.env.DATABASE_URL_FAC_B, 'jute_mill_fac_b');

  console.log(`\n======================================================`);
  console.log(`🚀 Starting JuteMill ERP Multi-Node Servers...`);
  console.log(`======================================================`);

  const appMain = createApp(createDatabaseManager('main'), 4000);
  appMain.listen(4000, () => {
    console.log(`🏢 Main Office Backend  : http://localhost:4000 (${mainName} · Federated HQ)`);
  });

  const appA = createApp(createDatabaseManager('fac-a'), 4001);
  appA.listen(4001, () => {
    console.log(`🏭 Factory A Backend    : http://localhost:4001 (${facAName} · F-A Only)`);
  });

  const appB = createApp(createDatabaseManager('fac-b'), 4002);
  appB.listen(4002, () => {
    console.log(`🏭 Factory B Backend    : http://localhost:4002 (${facBName} · F-B Only)`);
    console.log(`======================================================`);
    console.log(`All 3 branch servers are active and ready!\n`);
  });
}
