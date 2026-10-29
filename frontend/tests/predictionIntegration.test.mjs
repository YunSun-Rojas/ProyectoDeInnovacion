import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { preparePredictionView, evaluatePredictionView, estimateStockout } from '../src/modules/inventario/pages/predictionViewData.js';
import { predictionFixture, fixtureDay } from './prediction-review/fixtures.mjs';

const evaluate = (props, horizon = 7) => evaluatePredictionView(preparePredictionView({ ...props, evidence: props.predictionEvidence }), horizon);

test('integration invokes the statistical engine for both supported horizons', () => {
  const props = predictionFixture();
  assert.equal(evaluate(props, 7).forecasts[0].estimatedDemand, 14);
  assert.equal(evaluate(props, 30).forecasts[0].estimatedDemand, 60);
  assert.equal(evaluate(props, 30).forecasts[0].horizon, 30);
  assert.equal(evaluate(props, 7).forecasts[0].cutoff, fixtureDay(219));
  assert.equal(evaluate(props, 1).forecasts[0].displayState, 'processing_error');
});

test('integration excludes test and unverified sales without fabricating coverage', () => {
  for (const kind of ['test', 'unclassified']) {
    const result = evaluate(predictionFixture({ kind }));
    assert.equal(result.forecasts[0].estimatedDemand, null);
    assert.equal(result.forecasts[0].eligible, false);
  }
  const props = predictionFixture();
  delete props.predictionEvidence;
  assert.equal(evaluate(props).forecasts[0].displayState, 'historial_no_verificado');
  assert.equal(evaluate(predictionFixture({ coverage: false })).forecasts[0].estimatedDemand, null);
});

test('coverage, new products and access states remain distinct', () => {
  assert.equal(evaluate(predictionFixture({ unknownDay: 100 })).forecasts[0].displayState, 'historial_incompleto');
  assert.equal(evaluate(predictionFixture({ length: 4 })).forecasts[0].displayState, 'historial_insuficiente');
  assert.equal(evaluate(predictionFixture({ extra: { salesEnabled: false } })).state, 'sales_disabled');
  assert.equal(evaluate(predictionFixture({ extra: { historyAccess: 'denied' } })).state, 'access_denied');
  assert.equal(evaluate(predictionFixture({ extra: { status: 'error' } })).state, 'processing_error');
  assert.equal(evaluate(predictionFixture({ extra: { asOf: 'invalid' } })).state, 'processing_error');
  assert.equal(evaluate(predictionFixture({ extra: { readOnly: true } })).forecasts[0].eligible, true);
  const props = predictionFixture();
  props.sales = [];
  props.predictionEvidence.classifications = [];
  assert.equal(evaluate(props).forecasts[0].displayState, 'sin_ventas_confirmadas');
});

test('malformed API evidence cannot silently discard stockouts or manufacture complete inputs', () => {
  for (const field of ['classifications', 'coverage', 'stockouts']) {
    for (const value of [{ error: 'incomplete_response' }, null, 'unavailable']) {
      const props = predictionFixture();
      props.predictionEvidence[field] = value;
      const result = evaluate(props);
      assert.equal(result.state, 'processing_error');
      assert.deepEqual(result.forecasts, []);
    }
  }
  for (const extra of [{ products: null }, { sales: null }]) {
    assert.equal(evaluate(predictionFixture({ extra })).state, 'processing_error');
  }
  const absent = predictionFixture();
  delete absent.predictionEvidence;
  assert.equal(evaluate(absent).forecasts[0].eligible, false);
  const partial = predictionFixture();
  partial.predictionEvidence.classifications.pop();
  assert.equal(evaluate(partial).forecasts[0].status, 'historial_no_verificado');
});

test('stock changes risk independently; invalid or zero demand never divides by zero', () => {
  const forecast = evaluate(predictionFixture()).forecasts[0];
  assert.deepEqual(estimateStockout(forecast, 10), { state: 'within_horizon', days: 5 });
  assert.deepEqual(estimateStockout(forecast, 12), { state: 'within_horizon', days: 6 });
  assert.deepEqual(estimateStockout(forecast, 100), { state: 'beyond_horizon', days: null });
  assert.equal(evaluate(predictionFixture({ stock: 100 })).forecasts[0].estimatedDemand, forecast.estimatedDemand);
  for (const value of [null, { ...forecast, eligible: false }, { ...forecast, dailyDemand: 0 },
    { ...forecast, dailyDemand: NaN }, { ...forecast, dailyDemand: Infinity }, { ...forecast, estimatedDemand: 0 }, { ...forecast, estimatedDemand: -1 }]) {
    assert.deepEqual(estimateStockout(value, 10), { state: 'not_estimable', days: null });
  }
  for (const stock of [-1, null, Infinity, 1.5]) assert.equal(estimateStockout(forecast, stock).days, null);
});

test('edited, deleted, inactive and recreated catalog products preserve ID boundaries', () => {
  const props = predictionFixture();
  props.products[0].name = 'Nombre editado';
  props.products[0].sku = 'SKU-NUEVO';
  assert.equal(evaluate(props).forecasts[0].estimatedDemand, 14);
  const original = structuredClone(props);
  props.products = [];
  assert.equal(evaluate(props).forecasts[0].eligible, false);
  props.products = [{ ...original.products[0], isActive: false }];
  assert.equal(evaluate(props).forecasts[0].status, 'producto_inactivo');
  props.products = [{ ...original.products[0], id: 2 }];
  const recreated = evaluate(props).forecasts.find(row => row.productId === 2);
  assert.equal(recreated.status, 'historial_insuficiente');
  assert.equal(recreated.estimatedDemand, null);
});

test('prediction screen renders correct states and eligible values with the real engine', async t => {
  await build({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [react()], logLevel: 'error',
    build: { ssr: fileURLToPath(new URL('../src/modules/inventario/pages/Prediccion.jsx', import.meta.url)),
      outDir: fileURLToPath(new URL('../dist/prediction-ssr', import.meta.url)), emptyOutDir: false,
      rolldownOptions: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'lucide-react'], output: { entryFileNames: 'prediction.mjs' } } } });
  const { default: Prediccion } = await import('../dist/prediction-ssr/prediction.mjs');
  const render = props => renderToStaticMarkup(h(Prediccion, props));
  await t.test('simulated stock formulas and arbitrary four-product limit are gone', async () => {
    const source = await readFile(new URL('../src/modules/inventario/pages/Prediccion.jsx', import.meta.url), 'utf8');
    assert.ok(!source.includes('Math.floor') && !source.includes('minStock * 2') && !source.includes('slice(0, 4)'));
    const html = render(predictionFixture({ kind: 'unclassified' }));
    assert.ok(html.includes('<h1>Predicción de demanda</h1>'));
    assert.equal((html.match(/<option /g) ?? []).length, 2);
    assert.ok(html.includes('>7 días</option>') && html.includes('>30 días</option>'));
    assert.ok(html.includes('Predicciones no disponibles') && html.includes('Hay ventas pendientes de verificación comercial.'));
    assert.ok(!html.includes('<article') && !html.includes('Agotamiento orientativo') && !html.includes('Reponer'));
  });
  await t.test('cards use horizon-specific demand, current identity and separate stock risk', () => {
    const props = predictionFixture();
    props.products[0].name = 'Nombre actual';
    const week = render(props), month = render({ ...props, initialHorizon: 30 });
    assert.ok(week.includes('data-horizon="7"') && week.includes('14 <span>unidades'));
    assert.ok(month.includes('data-horizon="30"') && month.includes('60 <span>unidades'));
    assert.ok(!month.includes('data-horizon="7"'));
    assert.ok(week.includes('Nombre actual') && week.includes('Promedio diario') && week.includes('≈ 5 días'));
    assert.ok(!week.includes('MAE') && !week.includes('exactitud') && !week.includes('95 %'));
    assert.ok(render({ ...props, products: [{ ...props.products[0], stock: 12 }] }).includes('≈ 6 días'));
    assert.ok(render({ ...props, products: [{ ...props.products[0], stock: 0 }] }).includes('Sin stock'));
    assert.ok(!/NaN|Infinity/.test(week + month));
  });
  await t.test('test-only, insufficient, incomplete and missing histories never display a demand card', () => {
    for (const props of [predictionFixture({ kind: 'test' }), predictionFixture({ length: 4 }),
      predictionFixture({ unknownDay: 100 }), predictionFixture({ extra: { sales: [] } })]) {
      const html = render(props);
      assert.ok(html.includes('Predicciones no disponibles'));
      assert.ok(!html.includes('<article') && !html.includes('>0 días<') && !/NaN|Infinity/.test(html));
    }
  });
  await t.test('a zero forecast backed by historical evaluation has no invalid depletion estimate', () => {
    const props = predictionFixture();
    props.sales = props.sales.slice(0, 56); // synthetic declining demand, later days confirmed zero
    const result = evaluate(props).forecasts[0];
    assert.equal(result.eligible, true);
    assert.equal(result.estimatedDemand, 0);
    const html = render(props);
    assert.ok(html.includes('0 <span>unidades') && html.includes('No estimable'));
    assert.ok(!/NaN|Infinity/.test(html));
  });
  await t.test('shared loading, permissions and processing errors are accessible', () => {
    assert.ok(render({ status: 'loading' }).includes('Cargando predicción de demanda'));
    assert.ok(!render({ status: 'loading' }).includes('<h1>'));
    assert.ok(render({ status: 'error' }).includes('role="alert"'));
    assert.ok(render({ salesEnabled: false }).includes('El historial de ventas no está habilitado para esta sesión.'));
    assert.ok(render({ historyAccess: 'denied' }).includes('La sesión no tiene acceso al historial de ventas.'));
  });
  await t.test('large catalogs show a single empty card without a product lookup or redundant badge', () => {
    const products = Array.from({ length: 173 }, (_, index) => ({ id: index + 1, name: `Sintético ${index + 1}`, sku: `SYN-${index + 1}`, stock: 10 }));
    const html = render({ products, sales: [], salesEnabled: true });
    assert.equal((html.match(/<article/g) ?? []).length, 0);
    for (const removed of ['<details', '<table', 'type="search"', 'Consultar estado por producto', 'Buscar por nombre o SKU', 'Página', 'Historial insuficiente']) {
      assert.ok(!html.includes(removed));
    }
    assert.equal((html.match(/<section/g) ?? []).length, 1);
    assert.equal((html.match(/Predicciones no disponibles/g) ?? []).length, 1);
  });
  await t.test('empty-state explanations distinguish verification, coverage, permissions and errors without badges', () => {
    const cases = [
      [predictionFixture({ kind: 'unclassified' }), 'historial_no_verificado', 'Hay ventas pendientes de verificación comercial.'],
      [predictionFixture({ length: 4 }), 'historial_insuficiente', 'Todavía no existe historial comercial verificado suficiente'],
      [predictionFixture({ unknownDay: 100 }), 'historial_incompleto', 'La cobertura histórica no permite estimar'],
      [{ salesEnabled: false }, 'sales_disabled', 'El historial de ventas no está habilitado'],
      [{ historyAccess: 'denied' }, 'access_denied', 'La sesión no tiene acceso al historial'],
      [{ status: 'error' }, 'processing_error', 'No se pudo procesar el historial'],
    ];
    for (const [props, state, message] of cases) {
      const html = render(props);
      assert.ok(html.includes(`data-prediction-state="${state}"`) && html.includes(message));
      assert.ok(!html.includes('<span') && !html.includes('<article'));
    }
  });
  await t.test('eligible product cards retain their own pagination', () => {
    const props = predictionFixture({ length: 100 });
    const baseSales = props.sales;
    const baseCoverage = props.predictionEvidence.coverage;
    props.products = Array.from({ length: 13 }, (_, index) => ({ ...props.products[0], id: index + 1, name: `Sintético ${index + 1}` }));
    props.sales = props.products.flatMap(product => baseSales.map(sale => ({ ...sale, id: `${product.id}-${sale.id}`, productId: product.id, movementId: `${product.id}-${sale.movementId}` })));
    props.predictionEvidence = {
      classifications: props.sales.map(sale => ({ saleId: sale.id, kind: 'commercial', evidence: 'Synthetic audited fixture' })),
      coverage: props.products.flatMap(product => baseCoverage.map(day => ({ ...day, productId: product.id }))),
    };
    const html = render(props);
    assert.equal((html.match(/<article/g) ?? []).length, 12);
    assert.ok(html.includes('Página 1 de 2') && html.includes('Paginación de pronósticos'));
    assert.ok(!html.includes('<details') && !html.includes('<table'));
  });
  await t.test('evidence read states use the existing empty card and suppress previously eligible results', () => {
    const props = predictionFixture();
    for (const [evidenceState, message] of [
      ['migration_missing', 'La verificación comercial todavía no está habilitada'],
      ['access_denied', 'La sesión no tiene permiso para consultar las evidencias de predicción.'],
      ['connection_error', 'No se pudo conectar con el servicio de evidencias'],
      ['invalid_evidence', 'Las evidencias recibidas son inválidas'],
      ['evidence_error', 'No se pudieron consultar las evidencias'],
    ]) {
      const html = render({ ...props, evidenceState });
      assert.ok(html.includes(`data-prediction-state="${evidenceState}"`) && html.includes(message));
      assert.ok(html.includes('Predicciones no disponibles'));
      for (const removed of ['<article', '<table', '<details', 'type="search"', 'Consultar estado por producto']) assert.ok(!html.includes(removed));
      assert.equal((html.match(/<section/g) ?? []).length, 1);
    }
    assert.ok(render({ ...props, evidenceState: 'loading' }).includes('Cargando predicción de demanda'));
  });
});
