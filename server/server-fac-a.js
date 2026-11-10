import './src/load-env.js';
process.env.NODE_ROLE = 'fac-a';
process.env.API_PORT = process.env.PORT || process.env.API_PORT_FAC_A || '4001';

process.env.DATABASE_URL = process.env.DATABASE_URL_FAC_A || process.env.DATABASE_URL;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_FAC_A (or DATABASE_URL) is required');
}

await import('./src/index.js');