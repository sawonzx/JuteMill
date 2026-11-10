import './load-env.js';
import { createDatabaseManager } from './db-manager.js';
import { createApp } from './app.js';

const nodeRole = process.env.NODE_ROLE || 'main';
const port = Number(process.env.PORT || process.env.API_PORT || 4000);

const dbManager = createDatabaseManager(nodeRole);
const app = createApp(dbManager, port);

app.listen(port, () => {
  console.log(`\n======================================================`);
  console.log(`🏭 JuteWorks ERP Server [Node: ${dbManager.nodeRole.toUpperCase()}]`);
  console.log(`📡 Listening on http://localhost:${port}`);
  console.log(`======================================================\n`);
});
