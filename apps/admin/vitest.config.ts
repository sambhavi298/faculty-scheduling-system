import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Component tests for this app, run with Vitest against a real DOM
 * (jsdom) via @testing-library/react — never a snapshot/shallow-render
 * approach. Mirrors vite.config.ts's alias so these tests resolve
 * @faculty-scheduling/ui to the shared package's real TypeScript source,
 * exactly like the dev server and the production build do; no test-only
 * module mocking of our own code.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@faculty-scheduling/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    css: false,
  },
});
