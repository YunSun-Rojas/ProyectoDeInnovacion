import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('../../dist/catalog-review', import.meta.url)), emptyOutDir: false },
  plugins: [react(), {
    name: 'deny-api-in-catalog-review',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/api')) return next();
        res.statusCode = 403;
        res.end('Revisión aislada: API deshabilitada.');
      });
    },
  }],
  server: { host: '127.0.0.1', fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } },
});
