import { fileURLToPath, URL } from 'node:url';

import { defineConfig, loadEnv } from 'vite';

/**
 * Integration tests against a running local Supabase stack.
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from .env.local (or the env).
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/test/integration/**/*.integration.test.ts'],
    // Waits (bounded, with diagnostics) until Realtime delivers events — see the file.
    globalSetup: ['src/test/integration/realtimeReady.ts'],
    env: loadEnv(mode, process.cwd(), 'VITE_'),
    testTimeout: 15_000,
    // Tests share one local stack; run files serially.
    fileParallelism: false,
  },
}));
