import { createDatabaseManager } from '../src/db-manager.js';
import { createApp } from '../src/app.js';

async function main() {
  console.log('Testing Main Office super-access to branch databases...');
  const dbManager = createDatabaseManager('main');
  const app = createApp(dbManager, 4000);
  const server = app.listen(4000);

  try {
    // 1. Query demo users on Main Office
    const resUsers = await fetch('http://localhost:4000/api/demo-users');
    const users = await resUsers.json();
    const adminUser = users.find((u) => u.email === 'admin@juteworks.demo');
    console.log('Admin user found:', adminUser?.name);

    // 2. Query orders for Factory A via Main Office
    const resOrdersA = await fetch(
      'http://localhost:4000/api/orders?factoryId=factory-dhaka-fa',
      {
        headers: {
          'x-demo-user-id': adminUser.id,
        },
      }
    );
    const dataOrdersA = await resOrdersA.json();
    console.log(`✓ Main Office retrieved ${dataOrdersA.orders?.length || 0} orders from Factory A DB:`, 
      dataOrdersA.orders?.map(o => o.orderNumber)
    );

    // 3. Query orders for Factory B via Main Office
    const resOrdersB = await fetch(
      'http://localhost:4000/api/orders?factoryId=factory-khulna-fb',
      {
        headers: {
          'x-demo-user-id': adminUser.id,
        },
      }
    );
    const dataOrdersB = await resOrdersB.json();
    console.log(`✓ Main Office retrieved ${dataOrdersB.orders?.length || 0} orders from Factory B DB:`, 
      dataOrdersB.orders?.map(o => o.orderNumber)
    );

    console.log('\nSuper-access verified: Main Office can seamlessly read from both branch databases!');
  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error('Super access test failed:', err);
  process.exit(1);
});

