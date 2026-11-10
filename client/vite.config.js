import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const nodeMode = (process.env.VITE_NODE_MODE || mode || 'main').toLowerCase();
  let port = 5173;
  let apiTarget = 'http://localhost:4000';

  if (nodeMode === 'fac-a' || nodeMode === 'fac_a') {
    port = 5174;
    apiTarget = 'http://localhost:4001';
  } else if (nodeMode === 'fac-b' || nodeMode === 'fac_b') {
    port = 5175;
    apiTarget = 'http://localhost:4002';
  }

  return {
    plugins: [react()],
    server: {
      port,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts')) return 'charts-ui';
            if (id.includes('node_modules/d3-')) return 'charts-core';
          },
        },
      },
    },
  };
});
