import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePredictionData } from '../src/modules/inventario/pages/predictionData.js';

// Synthetic fixtures only. These are not Eagle Gaming commercial records.
const product = (id = 1, extra = {}) => ({ id, sku: `SYN-${id}`, name: 'Synthetic product', stock: 10, ...extra });
const sale = (id = 'synthetic-a', extra = {}) => ({ id, productId: 1, sku: 'SYN-1',
  product: 'Historical synthetic name', quantity: 2, date: '2026-10-01T15:00:00Z', movementId: `movement-${id}`, ...extra });
const decision = (saleId = 'synthetic-a', kind = 'commercial') => ({ saleId, kind, evidence: 'Synthetic reviewed fixture' });
const coverage = (extra = {}) => ({ productId: 1, from: '2026-10-01', to: '2026-10-03', evidence: 'Synthetic closed-day audit', ...extra });
const prepare = (options = {}) => preparePredictionData({ asOf: '2026-10-10T12:00:00Z',
  products: [product()], sales: [sale()], classifications: [decision()], ...options });

test('aggregates distinct events by stable product ID and commercial day', () => {
  const data = prepare({ products: [product(), product(2)], sales: [sale(), sale('b'), sale('c', { productId: 2 })],
    classifications: [decision(), decision('b'), decision('c')] });
  assert.equal(data.products[0].series[0].units, 4);
  assert.equal(data.products[1].series[0].units, 2);
  assert.equal(data.quality.duplicateRecords, 0);
  assert.equal(data.products[0].modelingSeries[0].units, null); // day not confirmed complete
});

test('uses Lima boundaries and sorts equivalent instants chronologically', () => {
  const data = prepare({ sales: [sale('b', { date: '2026-10-02T05:00:00Z' }), sale('a', { date: '2026-10-02T04:59:59Z' })],
    classifications: [decision('a'), decision('b')] });
  assert.deepEqual(data.products[0].series.map(day => day.date), ['2026-10-01', '2026-10-02']);
  assert.equal(data.products[0].records[0].saleId, 'a');
  assert.deepEqual(prepare({ sales: [sale('a', { date: '2026-10-01T23:59:59-05:00' })], classifications: [decision('a')] })
    .products[0].series.map(day => day.date), ['2026-10-01']);
  const mixed = prepare({ sales: [sale('later', { date: '2026-10-01T10:00:00-05:00' }),
    sale('earlier', { date: '2026-10-01T14:00:00Z' })] });
  assert.equal(mixed.products[0].records[0].saleId, 'earlier');
  assert.equal(prepare({ sales: [sale('synthetic-a', { date: '2026-10-01T12:00:00.123456+00:00' })] })
    .records[0].validation, 'valid'); // Supabase timestamps can include microseconds
});

test('confirmed zero differs from unknown; output range is not coverage', () => {
  const data = prepare({ coverage: [coverage()], range: { from: '2026-10-01', to: '2026-10-04' } });
  const series = data.products[0].series;
  assert.deepEqual(series.map(day => day.state), ['recorded_sales', 'confirmed_zero', 'confirmed_zero', 'unknown']);
  assert.deepEqual(series.map(day => day.units), [2, 0, 0, null]);
  assert.deepEqual(data.summary.coveredDates, ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(data.products[0].modelingSeries[3].units, null);
});

test('coverage is explicit, per product, closed, valid and evidenced', () => {
  const data = prepare({ products: [product(), product(2)], sales: [], coverage: [coverage(),
    coverage({ evidence: '' }), coverage({ to: '2026-10-10' }), coverage({ from: '2026-02-30' })] });
  assert.equal(data.quality.rejectedCoverage, 3);
  assert.equal(data.products[0].status, 'sin_ventas_confirmadas');
  assert.deepEqual(data.products[1].series, []);
});

test('stockout evidence blocks modeling; current zero stock alone does not invent stockouts', () => {
  const data = prepare({ products: [product(1, { stock: 0 })], coverage: [coverage()],
    stockouts: [coverage({ from: '2026-10-02', to: '2026-10-02' }), coverage({ evidence: '' })] });
  assert.equal(data.products[0].series[0].state, 'recorded_sales');
  assert.equal(data.products[0].series[1].state, 'possible_stockout');
  assert.equal(data.products[0].series[1].units, null);
  assert.equal(data.quality.rejectedStockouts, 1);
});

test('new product is identifiable and insufficient regardless of stock', () => {
  const data = prepare({ sales: [], products: [product(1, { stock: 1000 })] });
  assert.equal(data.products[0].active, true);
  assert.equal(data.products[0].status, 'historial_insuficiente');
  assert.equal(data.products[0].horizons[7].canEvaluate, false);
});

test('edits preserve association and historical names; inventory entries cannot change demand', () => {
  const before = prepare();
  const after = prepare({ products: [product(1, { name: 'Edited', sku: 'CHANGED', price: 999, stock: 500,
    category: 'Changed', minStock: 20, description: 'Changed' })], movements: [{ type: 'Entrada', quantity: 490 }] });
  assert.deepEqual(after.products[0].series, before.products[0].series);
  assert.deepEqual(after.products[0].historicalIdentity, before.products[0].historicalIdentity);
  assert.equal(after.products[0].catalog.name, 'Edited');
});

test('deleted and recreated products with identical SKU stay separate', () => {
  const data = prepare({ products: [product(2, { sku: 'SYN-1' })] });
  assert.equal(data.products[0].catalog, null);
  assert.equal(data.products[0].records[0].catalogRelation, 'missing');
  assert.equal(data.products[0].commercialSales.length, 1);
  assert.equal(data.products[0].horizons[7].canEvaluate, false);
  assert.equal(data.products[1].commercialSales.length, 0);
  assert.equal(data.quality.missingCatalogRecords, 1);
});

test('test and unclassified sales never become modeling quantities', () => {
  const data = prepare({ sales: [sale('test'), sale('new')], classifications: [decision('test', 'test')], coverage: [coverage()] });
  assert.equal(data.quality.testRecords, 1);
  assert.equal(data.quality.unclassifiedRecords, 1);
  assert.equal(data.products[0].commercialSales.length, 0);
  assert.equal(data.products[0].series[0].units, null);
  assert.equal(data.products[0].status, 'historial_no_verificado');
  assert.equal(prepare({ classifications: [decision('synthetic-a', 'test')] }).products[0].historyKind, 'test');
});

test('classification requires evidence; conflicting assertions fail closed in either order', () => {
  for (const classifications of [[{ saleId: 'synthetic-a', kind: 'commercial' }],
    [decision(), decision('synthetic-a', 'test')], [decision('synthetic-a', 'test'), decision()]]) {
    assert.equal(prepare({ classifications }).records[0].eligibleForModeling, false);
  }
  assert.equal(prepare({ sales: [sale('synthetic-a', { product: 'PRUEBA', unitPrice: 0 })] })
    .records[0].classification, 'commercial'); // names and prices are not classifiers
});

test('four synthetic test events and a new unreviewed sale do not become commercial history', () => {
  const ids = ['test-a', 'test-b', 'test-c', 'test-d'];
  const data = prepare({ sales: [...ids.map(id => sale(id)), sale('new')],
    classifications: ids.map(id => decision(id, 'test')) });
  assert.equal(data.quality.testRecords, 4);
  assert.equal(data.quality.unclassifiedRecords, 1);
  assert.equal(data.summary.productsWithValidatedCommercialHistory, 0);
  assert.deepEqual(data.products[0].commercialSales, []);
});

test('all copies of repeated IDs are rejected, including conflicting duplicates', () => {
  const data = prepare({ sales: [sale(), sale('synthetic-a', { quantity: 9 })], coverage: [coverage()] });
  assert.equal(data.quality.duplicateRecords, 2);
  assert.equal(data.quality.invalidRecords, 2);
  assert.equal(data.products[0].commercialSales.length, 0);
  assert.equal(data.products[0].modelingSeries[0].units, null);
});

test('invalid quantities, missing fields, product identifiers and dates are rejected', () => {
  for (const extra of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.5 }, { quantity: '2' },
    { quantity: Number.MAX_SAFE_INTEGER + 1 }, { productId: null }, { productId: '1' }, { productId: -1 },
    { product: '' }, { sku: '' }, { movementId: undefined }, { id: '' }, { date: null },
    { date: '2026-02-30T12:00:00Z' }, { date: '2026-10-01T24:00:00Z' },
    { date: '2026-10-01T12:00:00' }, { date: '2026-10-11T00:00:00Z' }]) {
    const data = prepare({ sales: [sale('synthetic-a', extra)] });
    assert.equal(data.quality.invalidRecords, 1, JSON.stringify(extra));
    assert.equal(data.records[0].eligibleForModeling, false);
  }
});

test('movements are not an alternate source of sales', () => {
  const data = prepare({ sales: [{ id: 'entry', productId: 1, type: 'Entrada', quantity: 100, date: '2026-10-01T12:00:00Z' }],
    classifications: [decision('entry')] });
  assert.equal(data.quality.commercialRecords, 0);
  assert.equal(data.quality.invalidRecords, 1);
});

test('empty, null and incomplete arrays are tolerated without fabricating records', () => {
  assert.deepEqual(prepare({ products: null, sales: null }).products, []);
  assert.equal(prepare({ sales: [null, {}] }).quality.invalidRecords, 2);
  assert.throws(() => preparePredictionData(), /asOf/);
  assert.throws(() => prepare({ range: { from: '2026-10-03', to: '2026-10-01' } }), /Rango/);
});

test('horizons need an explicit policy and sufficient consecutive complete days', () => {
  const options = { coverage: [coverage()], requirements: {
    7: { minCoveredDays: 3, minSaleDays: 1 }, 30: { minCoveredDays: 4, minSaleDays: 1 } } }; // test-only policy
  const row = prepare(options).products[0];
  assert.equal(row.horizons[7].status, 'datos_preparados');
  assert.equal(row.horizons[30].status, 'historial_insuficiente');
  assert.equal(prepare({ coverage: [coverage()] }).products[0].horizons[7].policyProvided, false);
  for (const products of [[], [product(1, { isActive: false })]]) {
    assert.equal(prepare({ ...options, products }).products[0].horizons[7].canEvaluate, false);
  }
});

test('safe daily aggregation refuses integer overflow', () => {
  const data = prepare({ sales: [sale('a', { quantity: Number.MAX_SAFE_INTEGER }), sale('b')],
    classifications: [decision('a'), decision('b')], coverage: [coverage()] });
  assert.equal(data.products[0].series[0].overflow, true);
  assert.equal(data.products[0].modelingSeries[0].units, null);
});

test('processing is deterministic, does not mutate inputs and omits sensitive fields', () => {
  const options = { products: [product()], sales: [sale('synthetic-a', { user: 'sensitive', total: 100 })] };
  const snapshot = structuredClone(options);
  const first = prepare(options);
  assert.deepEqual(prepare(options), first);
  assert.deepEqual(options, snapshot);
  assert.equal(JSON.stringify(first).includes('sensitive'), false);
  assert.equal(first.summary.productsWithValidatedCommercialHistory, 1);
});
