import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import react from '@vitejs/plugin-react';
import { createPredictionDemo, DEMO_AS_OF, DEMO_DAYS, DEMO_LABEL } from './prediction-review/demoData.mjs';
import { validatePredictionEvidence } from '../../shared/predictionEvidence.js';
import { preparePredictionView, evaluatePredictionView, estimateStockout } from '../src/modules/inventario/pages/predictionViewData.js';

const prepare = data => preparePredictionView({ ...data, evidence: data.predictionEvidence });
const forecast = (data, horizon) => evaluatePredictionView(prepare(data), horizon).forecasts;

test('demo: datos deterministas, IDs ficticios y 240 días completos con evidencia estricta por producto', () => {
  const data = createPredictionDemo();
  assert.deepEqual(data, createPredictionDemo());
  assert.equal(data.asOf, DEMO_AS_OF);
  assert.equal(data.sales.length, 2 * DEMO_DAYS);
  assert.equal(new Set(data.sales.map(sale => sale.id)).size, data.sales.length);
  assert.ok(data.products.every(product => product.id > 9_000_000_000_000 && product.sku.startsWith('SIM-') && product.name.includes('ficticio')));
  assert.deepEqual(validatePredictionEvidence(data.predictionEvidence, data.asOf), data.predictionEvidence);
  const prepared = prepare(data).prepared;
  assert.equal(prepared.quality.invalidRecords, 0);
  assert.equal(prepared.quality.unclassifiedRecords, 0);
  assert.equal(prepared.quality.rejectedCoverage, 0);
  for (const product of prepared.products) {
    assert.equal(product.series.length, DEMO_DAYS);
    assert.equal(product.trailingCoveredDays, DEMO_DAYS);
    assert.ok(product.series.every(day => day.complete && day.units > 0));
    for (let i = 1; i < product.series.length; i++) {
      assert.equal(Date.parse(product.series[i].date) - Date.parse(product.series[i - 1].date), 86400000);
    }
  }
});

test('demo: ambos horizontes calculan demanda y agotamiento usando los algoritmos aprobados', () => {
  const data = createPredictionDemo();
  for (const horizon of [7, 30]) {
    const values = forecast(data, horizon);
    assert.deepEqual(values.map(row => row.estimatedDemand), horizon === 7 ? [21, 14] : [90, 60]);
    assert.ok(values.every(row => row.eligible && row.method === 'daily_mean'));
    assert.deepEqual(estimateStockout(values[0], data.products[0].stock), { state: 'within_horizon', days: 4 });
    assert.deepEqual(estimateStockout(values[1], data.products[1].stock), horizon === 7
      ? { state: 'beyond_horizon', days: null } : { state: 'within_horizon', days: 14 });
  }
});

test('demo: el resultado cambia con las observaciones, no con valores fijos de presentación', () => {
  const data = createPredictionDemo();
  data.sales = data.sales.map(sale => ({ ...sale, quantity: sale.quantity * 2 }));
  assert.deepEqual(forecast(data, 7).map(row => row.estimatedDemand), [42, 28]);
  assert.deepEqual(forecast(data, 30).map(row => row.estimatedDemand), [180, 120]);
});

test('demo: quitar clasificación o cobertura mantiene el bloqueo real sin relajar las reglas', () => {
  for (const field of ['classifications', 'coverage']) {
    const data = createPredictionDemo();
    data.predictionEvidence[field] = [];
    for (const horizon of [7, 30]) assert.ok(forecast(data, horizon).every(row => !row.eligible && row.estimatedDemand === null));
  }
});

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = '../src/modules/inventario/pages/';
async function compile(entry, name, dev) {
  return build({ configFile: false, root, plugins: [react()], logLevel: 'error',
    define: { 'import.meta.env.DEV': String(dev) },
    build: { ssr: fileURLToPath(new URL(pages + entry, import.meta.url)),
      outDir: fileURLToPath(new URL('../dist/' + name, import.meta.url)), emptyOutDir: true,
      rolldownOptions: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'], output: { entryFileNames: 'entry.mjs' } } } });
}
let Controller;
async function controller() {
  if (!Controller) {
    await compile('PrediccionDemoLocal.jsx', 'prediction-local-ssr', true);
    Controller = (await import('../dist/prediction-local-ssr/entry.mjs')).default;
  }
  return Controller;
}

// Controller event tests use React elements and a synchronous state updater;
// they do not claim to exercise browser mounting or native DOM events.
function instance(Type, props = {}) {
  const screen = new Type(props);
  screen.setState = patch => { screen.state = { ...screen.state, ...patch }; };
  return screen;
}

test('demo integrada: real por defecto, entrada sin mezclar props y regreso sin estado sintético', async t => {
  const Type = await controller();
  const realProps = { products: [{ id: 25, name: 'Real' }], sales: [], salesEnabled: true, status: 'ready',
    onSale: () => { throw Error('No writes'); }, evidenceState: 'access_denied' };
  const screen = instance(Type, realProps);
  const before = structuredClone(realProps.products);
  const real = screen.render();
  assert.equal(real.key, 'real');
  assert.equal(real.props.products, realProps.products);
  assert.equal(real.props.predictionControls.props.children, 'Ver demostración');
  t.mock.method(globalThis, 'fetch', () => { throw Error('Demo must not request any API'); });
  real.props.predictionControls.props.onClick();
  const demo = screen.render();
  assert.equal(demo.key, 'simulated');
  assert.notEqual(demo.type, real.type); // React unmounts/aborts the real reader.
  assert.equal(demo.props.onSale, undefined);
  assert.equal(demo.props.evidenceState, 'available');
  assert.ok(demo.props.products.every(product => product.id !== 25));
  assert.deepEqual(realProps.products, before);
  const firstDemo = screen.state.demo;
  demo.props.predictionControls.props.onClick();
  assert.deepEqual(screen.state, { demo: null });
  const returned = screen.render();
  assert.equal(returned.type, real.type);
  assert.equal(returned.props.products, realProps.products);
  assert.equal(returned.props.predictionNotice, undefined);
  assert.equal(returned.props.evidenceState, 'access_denied');
  returned.props.predictionControls.props.onClick();
  assert.notEqual(screen.state.demo, firstDemo); // No reused synthetic state.
  assert.equal(instance(Type, realProps).state.demo, null);
});

test('demo integrada: mismas tarjetas, aviso permanente y ambos horizontes calculados sin API', async t => {
  const Type = await controller();
  t.mock.method(globalThis, 'fetch', () => { throw Error('Demo must not request any API'); });
  const screen = instance(Type);
  screen.render().props.predictionControls.props.onClick();
  const element = screen.render();
  for (const horizon of [7, 30]) {
    const html = renderToStaticMarkup(createElement(element.type, { ...element.props, initialHorizon: horizon }));
    assert.ok(html.includes(DEMO_LABEL) && html.includes('Volver a datos reales'));
    assert.ok(html.includes('<h1>Predicción de demanda</h1>') && html.includes('Predicciones disponibles'));
    assert.equal((html.match(/<article/g) ?? []).length, 2);
    assert.equal((html.match(/<option /g) ?? []).length, 2);
    assert.ok(html.includes('value="' + horizon + '" selected=""'));
    for (const value of forecast(createPredictionDemo(), horizon)) assert.ok(html.includes(value.estimatedDemand + ' <span>unidades'));
    assert.ok(html.includes('≈ 4 días'));
    assert.ok(html.includes(horizon === 7 ? 'Fuera del horizonte' : '≈ 14 días'));
    for (const forbidden of ['<table', 'type="search"', 'Consultar estado por producto', 'MAE', 'exactitud', 'NaN', 'Infinity']) assert.ok(!html.includes(forbidden));
  }
  element.props.predictionControls.props.onClick();
  const realHtml = renderToStaticMarkup(screen.render());
  assert.ok(!realHtml.includes(DEMO_LABEL) && !realHtml.includes('SIM-AURORA') && !realHtml.includes('<article'));
});

test('demo integrada: producción excluye controlador, datos ficticios y controles incluso en localhost', async t => {
  await compile('PrediccionConDemoLocal.jsx', 'prediction-production-ssr', false);
  const directory = new URL('../dist/prediction-production-ssr/', import.meta.url);
  const files = await readdir(directory, { recursive: true });
  for (const file of files.filter(file => file.endsWith('.mjs') || file.endsWith('.js'))) {
    const source = await readFile(new URL(file.replaceAll('\\', '/'), directory), 'utf8');
    for (const marker of [DEMO_LABEL, 'SIM-AURORA', 'SIM-NEBULA', 'Ver demostración', 'Volver a datos reales', 'demoData', 'PrediccionDemoLocal']) assert.ok(!source.includes(marker), marker);
  }
  const { default: Production } = await import('../dist/prediction-production-ssr/entry.mjs');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: 'localhost' } } });
  t.after(() => previousWindow ? Object.defineProperty(globalThis, 'window', previousWindow) : delete globalThis.window);
  const html = renderToStaticMarkup(createElement(Production, { salesEnabled: false }));
  assert.ok(!html.includes('Ver demostración') && !html.includes(DEMO_LABEL));
});

test('demo integrada: se conserva la ruta y se retiran la página y el servidor independientes', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.ok(app.includes('<PrediccionConDemoLocal {...useOutletContext()} />'));
  assert.ok(app.includes('path="prediccion"'));
  const gate = await readFile(new URL(pages + 'PrediccionConDemoLocal.jsx', import.meta.url), 'utf8');
  assert.ok(gate.includes('import.meta.env.DEV') && gate.includes("['localhost', '127.0.0.1', '[::1]', '::1']"));
  for (const file of ['Demo.jsx', 'demoEntry.jsx', 'demo.html']) await assert.rejects(readFile(new URL('./prediction-review/' + file, import.meta.url)), { code: 'ENOENT' });
  const config = await readFile(new URL('./prediction-review/vite.config.mjs', import.meta.url), 'utf8');
  assert.ok(!config.includes('5188') && !config.includes("mode === 'demo'"));
});
