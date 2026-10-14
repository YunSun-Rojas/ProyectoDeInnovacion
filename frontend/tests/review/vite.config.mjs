// Entorno de revisión aislado: intercepta TODAS las rutas /api, sin Supabase.
// npm run dev --workspace frontend -- --config tests/review/vite.config.mjs --port 5176 --strictPort
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { kardexReview } from '../kardex-review/fixtures.mjs';

const session = { user: { id: 'review-user', email: 'revision@example.test', user_metadata: { full_name: 'Revisión aislada' } } };
let signedIn = true;
let products = [
  { id: 1, name: 'Mouse de revisión', sku: 'REV-M01', category: 'Periféricos', stock: 8, minStock: 3, price: 80, version: 1 },
  { id: 2, name: 'Teclado de revisión', sku: 'REV-T01', category: 'Periféricos', stock: 3, minStock: 3, price: 120, version: 1 },
  { id: 3, name: 'Monitor de revisión', sku: 'REV-P01', category: 'Pantallas', stock: 0, minStock: 2, price: 500, version: 1 },
];
const categories = [{ id: 'c1', name: 'Periféricos' }, { id: 'c2', name: 'Pantallas' }];
let movements = [
  { id: 'm1', date: '2026-10-13T16:00:00Z', product: products[0].name, sku: products[0].sku, type: 'Entrada', before: 3, after: 8, quantity: 5, user: 'revision@example.test', reason: 'Recepción de prueba aislada' },
  { id: 'm2', date: '2026-10-13T17:00:00Z', product: products[1].name, sku: products[1].sku, type: 'Venta', before: 5, after: 3, quantity: -2, user: 'revision@example.test', saleId: 's1', total: 240, unitPrice: 120 },
];
const sales = [{ id: 's1', productId: 2, product: products[1].name, sku: products[1].sku, quantity: 2, unitPrice: 120, total: 240, date: '2026-10-13T17:00:00Z', movementId: 'm2' }];

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'isolated-phase-one-review',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const send = (code, data) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
        const mode = new URL(req.headers.referer || 'http://localhost').searchParams.get('review');
        if (req.url === '/api/auth/session') return send(200, { session: signedIn ? session : null });
        if (req.url === '/api/auth/login') { signedIn = true; return send(200, { session }); }
        if (req.url === '/api/auth/logout') { signedIn = false; return send(200, { ok: true }); }
        if (!signedIn) return send(401, { error: 'Inicia sesión.' });
        if (req.url === '/api/inventory') {
          if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1800));
          if (mode === 'kardex') return send(200, kardexReview);
          if (mode === 'error') return send(503, { error: 'Error de conexión simulado para revisión aislada.' });
          return send(200, { products: mode === 'empty' ? [] : products, categories, movements, sales, salesEnabled: true, stockEnabled: true, readOnly: mode === 'readonly' });
        }
        if (req.url === '/api/inventory/changes') {
          if (mode === 'readonly') return send(403, { error: 'Sesión de solo lectura.' });
          let raw = ''; for await (const chunk of req) raw += chunk;
          const request = JSON.parse(raw);
          if (!['add', 'edit', 'catalog_edit'].includes(request.action)) return send(400, { error: 'Este entorno de revisión solo admite altas y ediciones en memoria.' });
          const previous = products.find(product => product.id === request.productId);
          if (request.action === 'catalog_edit' && (!previous || request.version !== previous.version)) return send(400, { error: 'Versión obsoleta.' });
          if (request.action === 'catalog_edit' && ['stock', 'delta', 'catalog_only'].some(key => Object.hasOwn(request.data, key))) return send(400, { error: 'La ficha no admite cantidades.' });
          const product = { ...previous, ...request.data, id: previous?.id ?? Math.max(...products.map(product => product.id)) + 1, version: (previous?.version ?? 0) + 1 };
          const movement = { id: request.requestId, date: new Date().toISOString(), product: product.name, sku: product.sku, type: previous ? 'Ajuste' : 'Alta', before: previous?.stock ?? 0, after: product.stock, quantity: product.stock - (previous?.stock ?? 0), user: 'revision@example.test', reason: 'Revisión aislada' };
          products = [...products.filter(item => item.id !== product.id), product];
          movements = [movement, ...movements];
          return send(200, { product, movement });
        }
        return send(404, { error: 'API no disponible en la revisión aislada.' });
      });
    },
  }],
});
