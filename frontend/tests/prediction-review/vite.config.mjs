// Explicit local UI test only. Never loads .env, creates a real Supabase client,
// or forwards /api elsewhere. Use only synthetic@example.test / synthetic-password.
// npm run dev --workspace frontend -- --config tests/prediction-review/vite.config.mjs --host 127.0.0.1 --port 5187 --strictPort
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import { createApi } from '../../../backend/src/app.js';
import { loadPredictionEvidence } from '../../../backend/src/modules/inventory/inventoryService.js';
import { predictionFixture } from './fixtures.mjs';

const modes = new Set(['missing', 'empty', 'short', 'valid', 'denied', 'network', 'malformed', 'bad-json']);
let scenario = 'missing', rpcCalls = 0, evidenceRequests = 0;
const fixture = predictionFixture();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fixture.asOf.slice(0, 10)}T00:00:00Z`);
const day = value => new Date(Date.parse(`${value}T00:00:00Z`) + shift).toISOString().slice(0, 10);
fixture.sales = fixture.sales.map((sale, i) => ({ ...sale, id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  date: `${day(sale.date.slice(0, 10))}T12:00:00Z`, unitPrice: 20, total: 40 }));
fixture.predictionEvidence.coverage = fixture.predictionEvidence.coverage.map(row => ({ ...row, from: day(row.from), to: day(row.to) }));
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test', user_metadata: { full_name: 'Revisión sintética' } };

const createReviewApi = () => createApi({ secure: false }, {
  clientFactory: () => ({ auth: {
    signInWithPassword: async ({ email, password }) => email === user.email && password === 'synthetic-password'
      ? { data: { user, session: { access_token: 'synthetic-unused-token' } } } : { error: { status: 401, message: 'Credenciales sintéticas incorrectas.' } },
    getUser: async () => ({ data: { user } }), signOut: async () => ({ error: null }),
  }, rpc: async (name, { p_as_of }) => {
    if (name !== 'inventory_prediction_evidence') throw Error('Only the evidence RPC is allowed');
    rpcCalls++;
    if (scenario === 'missing') return { error: { code: 'PGRST202' } };
    if (scenario === 'denied') return { error: { code: '42501' } };
    if (scenario === 'network') throw new TypeError('Synthetic fetch failed');
    if (scenario === 'malformed') return { data: { classifications: [] } };
    const sales = scenario === 'empty' ? [] : scenario === 'short' ? fixture.sales.slice(-4) : fixture.sales;
    const coverage = scenario === 'empty' ? [] : scenario === 'short' ? fixture.predictionEvidence.coverage.slice(-4) : fixture.predictionEvidence.coverage;
    return { data: {
      classifications: sales.map((sale, i) => ({ saleId: sale.id, kind: 'commercial', evidence: `sale-review:${i + 1}`, verifiedAt: p_as_of })),
      coverage: coverage.map((row, i) => ({ ...row, evidence: `day-review:${i + 1}`, verifiedAt: p_as_of })), stockouts: [],
    } };
  } }),
  inventory: { loadPredictionEvidence, loadInventory: async () => ({
    products: fixture.products.map(product => ({ ...product, category: 'Revisión', price: 20 })),
    categories: [{ id: 'c1', name: 'Revisión' }], movements: [],
    sales: ['missing', 'short'].includes(scenario) ? fixture.sales.slice(-4) : scenario === 'empty' ? [] : fixture.sales,
    salesEnabled: true, stockEnabled: false, readOnly: true,
  }) },
  vision: { info: async () => ({}), detect: async () => { throw Error('Not available in this test'); } },
});

export default defineConfig({ envDir: false, plugins: [react(), tailwindcss(), {
  name: 'isolated-prediction-read-review',
  transformIndexHtml: () => [{ tag: 'aside', attrs: { style: 'position:fixed;bottom:0;left:0;z-index:9999;background:#fff4cc;padding:4px;font-size:12px' },
    children: 'REVISIÓN AISLADA · sesión y datos sintéticos · sin Supabase', injectTo: 'body' }],
  configureServer(vite) {
    const server = createReviewApi();
    vite.httpServer.on('close', () => server.emit('close'));
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/__prediction-review') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ scenario, rpcCalls, evidenceRequests }));
      }
      if (!req.url.startsWith('/api/')) return next();
      const requested = new URL(req.headers.referer || 'http://127.0.0.1').searchParams.get('scenario');
      if (modes.has(requested)) scenario = requested;
      if (req.url === '/api/inventory/prediction-evidence') {
        evidenceRequests++;
        if (scenario === 'bad-json') { res.setHeader('Content-Type', 'text/html'); return res.end('<html>synthetic malformed response</html>'); }
      }
      if (!['/api/auth/session', '/api/auth/login', '/api/auth/logout', '/api/inventory', '/api/inventory/prediction-evidence'].includes(req.url)) {
        res.statusCode = 404; return res.end('{"error":"Ruta fuera de esta prueba aislada."}');
      }
      server.emit('request', req, res);
    });
  },
}]
});
