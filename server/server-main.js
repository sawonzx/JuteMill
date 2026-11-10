import './src/load-env.js';
process.env.NODE_ROLE = 'main';
process.env.API_PORT = process.env.PORT || process.env.API_PORT_MAIN || '4000';

process.env.DATABASE_URL = process.env.DATABASE_URL_MAIN || process.env.DATABASE_URL;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_MAIN (or DATABASE_URL) is required');
}

await import('./src/index.js');