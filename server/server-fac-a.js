import './src/load-env.js';
process.env.NODE_ROLE = 'fac-a';
process.env.API_PORT = process.env.API_PORT_FAC_A || '4001';

if (!process.env.DATABASE_URL_FAC_A) {
  throw new Error('DATABASE_URL_FAC_A is required');
}

process.env.DATABASE_URL = process.env.DATABASE_URL_FAC_A;

await import('./src/index.js');