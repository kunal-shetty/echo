import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    exclude: ['**/node_modules/**', '**/tests/e2e/**'],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
