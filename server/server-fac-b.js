import './src/load-env.js';
process.env.NODE_ROLE = 'fac-b';
process.env.API_PORT = process.env.PORT || process.env.API_PORT_FAC_B || '4002';

process.env.DATABASE_URL = process.env.DATABASE_URL_FAC_B || process.env.DATABASE_URL;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL_FAC_B (or DATABASE_URL) is required');
}

await import('./src/index.js');