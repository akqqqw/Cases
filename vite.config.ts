import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Dev / preview server is exposed through the Arena preview proxy
// (https://<port>-<sandbox>.e2b.app), so every host must be allowed.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
    // Phaser is one big vendor chunk on purpose: the game needs it for the
    // first screen, so splitting it would only add requests.
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
