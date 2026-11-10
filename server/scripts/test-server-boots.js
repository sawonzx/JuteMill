import { createDatabaseManager } from '../src/db-manager.js';
import { createApp } from '../src/app.js';

async function testNode(role, port) {
  console.log(`Testing Node: ${role} on port ${port}...`);
  const dbManager = createDatabaseManager(role);
  const app = createApp(dbManager, port);
  const server = app.listen(port);
  
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    const data = await res.json();
    console.log(`✓ Node ${role} health check:`, data);
  } finally {
    server.close();
  }
}

async function main() {
  await testNode('main', 4000);
  await testNode('fac-a', 4001);
  await testNode('fac-b', 4002);
  console.log('\nAll 3 node servers boots verified successfully!');
}

main().catch(err => {
  console.error('Test boot failed:', err);
  process.exit(1);
});

