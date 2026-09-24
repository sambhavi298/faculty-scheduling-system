import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// The real backend (services/api) has no CORS middleware configured, so a
// direct cross-origin browser call from this dev server would be blocked.
// Proxying /api keeps every request same-origin without touching backend
// code (see the migration report's "Remaining backend dependencies").
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@faculty-scheduling/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
