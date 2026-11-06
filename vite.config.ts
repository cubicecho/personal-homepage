import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Every cubicecho app is served here, so it is at the same address on every device. */
const WEB_SERVER = { host: '0.0.0.0', port: 3000, strictPort: true };
const API_ORIGIN = 'http://localhost:8787';

export default defineConfig({
  root: 'web',
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: fileURLToPath(new URL('./web/src/routes', import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL('./web/src/route-tree.gen.ts', import.meta.url)),
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) },
  },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    ...WEB_SERVER,
    // The API runs beside Vite in dev; the regex keeps /graphql-ish asset paths out of the proxy.
    proxy: {
      '^/graphql(\\?|$)': API_ORIGIN,
      '/healthz': API_ORIGIN,
      '/icons/': API_ORIGIN,
      // The OIDC sign-in's start and callback (server/http/sso.ts).
      '/sso/': API_ORIGIN,
      '/api/auth/': API_ORIGIN,
    },
  },
  preview: WEB_SERVER,
});
