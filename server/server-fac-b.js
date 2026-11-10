import './src/load-env.js';
process.env.NODE_ROLE = 'fac-b';
process.env.API_PORT = process.env.API_PORT_FAC_B || '4002';

if (!process.env.DATABASE_URL_FAC_B) {
  throw new Error('DATABASE_URL_FAC_B is required');
}

process.env.DATABASE_URL = process.env.DATABASE_URL_FAC_B;

await import('./src/index.js');