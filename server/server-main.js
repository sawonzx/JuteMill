import './src/load-env.js';
process.env.NODE_ROLE = 'main';
process.env.API_PORT = process.env.PORT || process.env.API_PORT_MAIN || '4000';

if (!process.env.DATABASE_URL_MAIN) {
  throw new Error('DATABASE_URL_MAIN is required');
}

process.env.DATABASE_URL = process.env.DATABASE_URL_MAIN;

await import('./src/index.js');