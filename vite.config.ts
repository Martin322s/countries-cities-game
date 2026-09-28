/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

import {
  headersFile,
  REDIRECTS_FILE,
  securityHeaders,
  type CaptchaProviderName,
} from './deploy/security-headers.ts';

function deploymentOptions(mode: string) {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const supabaseUrl = env.VITE_SUPABASE_URL || 'https://invalid.supabase.co';
  const provider = (env.VITE_CAPTCHA_PROVIDER || '').trim().toLowerCase();
  const captcha: CaptchaProviderName =
    provider === 'turnstile' || provider === 'hcaptcha' ? provider : null;
  return { supabaseUrl, captcha, https: supabaseUrl.startsWith('https://') };
}

/** Writes the deploy headers and SPA fallback next to the build output. */
function deploymentFiles(mode: string): Plugin {
  return {
    name: 'deployment-files',
    apply: 'build',
    generateBundle() {
      const options = deploymentOptions(mode);
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(options) });
      this.emitFile({ type: 'asset', fileName: '_redirects', source: REDIRECTS_FILE });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), deploymentFiles(mode)],
  build: {
    // Source maps are not published: they would expose the full source to anyone and
    // help nobody playing. Enable locally when debugging a production build.
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache across app deploys and keep each chunk small.
        // Module ids are normalized to forward slashes on every platform.
        codeSplitting: {
          groups: [
            { name: 'react', test: /\/node_modules\/(react|react-dom|react-router|scheduler)\// },
            { name: 'supabase', test: /\/node_modules\/@supabase\// },
            { name: 'query', test: /\/node_modules\/@tanstack\// },
          ],
        },
      },
    },
  },
  // The local production preview serves the same security headers as the deploy.
  preview: {
    headers: securityHeaders({ ...deploymentOptions(mode), https: false }),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'deploy/**/*.test.ts'],
    // Integration tests need a running Supabase stack: npm run test:integration
    exclude: ['src/test/integration/**'],
    restoreMocks: true,
  },
}));
