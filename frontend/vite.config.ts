import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { stayLocal } from './scripts/vite-plugin-stay-local';

/**
 * The FastAPI backend in development (`make dev`). Loopback only.
 * REMI_API_PORT / REMI_WEB_PORT let parallel work (and the parity harness) run several
 * backend + Vite pairs side by side; the defaults are the documented 8765 / 5173.
 */
const API_PORT = process.env.REMI_API_PORT ?? '8765';
const WEB_PORT = Number(process.env.REMI_WEB_PORT ?? '5173');
const BACKEND = `http://127.0.0.1:${API_PORT}`;

/**
 * Code splitting (no chunk over Vite's 500 kB warning). The routes split the app itself: the
 * Textbook, Setup, Settings and the dev-only Foundations pages are lazy (src/app/router.tsx),
 * while Home, the shell and the eight always-mounted app screens stay in the entry chunk. The
 * libraries go to long-lived chunks the entry preloads in parallel: React and the router, the
 * data layer, and KaTeX (only the Textbook chunk imports it, so it loads with the Textbook).
 */
function vendorChunk(id: string): string | undefined {
  const m = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
  if (!m?.[1]) return undefined;
  const pkg = m[1].replace('\\', '/');
  if (['react', 'react-dom', 'scheduler', 'react-router'].includes(pkg)) return 'react';
  if (pkg === 'katex') return 'katex';
  if (['@tanstack/query-core', '@tanstack/react-query', 'openapi-fetch', 'zustand', 'clsx'].includes(pkg)) return 'data';
  return undefined;
}

export default defineConfig({
  plugins: [react(), stayLocal()],
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': BACKEND,
      '/charts': BACKEND,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    // Never inline fonts or images as data: URIs; the CSP serves them from 'self'.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
});
